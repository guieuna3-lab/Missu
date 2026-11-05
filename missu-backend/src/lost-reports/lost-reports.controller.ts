/**
 * 분실 신고는 습득물 검색 목록에 공개하지 않습니다.
 * 등록자만 상세와 본인 내역에서 볼 수 있도록 로그인 사용자 ID로 조회 범위를 제한합니다.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { SessionRequest } from '../auth/session.service';
import { CreateLostReportDto } from '../items/items.dto';
import { DatabaseService } from '../database/database.service';
import { IdempotencyService } from '../common/idempotency.service';
import { lostTimes } from '../common/dto';
import { fail } from '../common/http';

@Controller('api/v1/lost-reports')
export class LostReportsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly idem: IdempotencyService,
  ) {}
  @Post()
  async create(
    @Body() dto: CreateLostReportDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: SessionRequest,
  ) {
    const times = lostTimes(dto.lostTime),
      userId = req.authSession!.userId!;
    return {
      data: await this.idem.run(
        userId,
        'POST /lost-reports',
        key,
        dto,
        async (tx) => {
          const report = await tx.lostReport.create({
            data: {
              userId,
              name: dto.name,
              features: dto.features,
              ...times,
              lostLabel: dto.lostLocation.label,
              lat: dto.lostLocation.lat,
              lng: dto.lostLocation.lng,
            },
          });
          await tx.auditEvent.create({
            data: {
              actorId: userId,
              action: 'LOST_REPORT_CREATED',
              entityType: 'lost_reports',
              entityId: report.id,
              requestId: String(req.headers['x-request-id']),
            },
          });
          return { id: report.id };
        },
      ),
    };
  }
  @Get(':id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
  ) {
    const r = await this.db.lostReport.findFirst({
      where: { id, userId: req.authSession!.userId! },
    });
    if (!r) fail(404, 'RESOURCE_NOT_FOUND', '분실 신고를 찾을 수 없습니다.');
    return {
      data: {
        id: r.id,
        name: r.name,
        features: r.features,
        lostTime: {
          start: r.lostStart,
          end: r.lostEnd,
          precision: r.timePrecision,
        },
        lostLocation: {
          label: r.lostLabel,
          lat: Number(r.lat),
          lng: Number(r.lng),
        },
        createdAt: r.createdAt,
      },
    };
  }
}
