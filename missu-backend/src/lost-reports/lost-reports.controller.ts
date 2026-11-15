import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Post,
  Req,
} from '@nestjs/common';
import type { SessionRequest } from '../auth/session.service';
import type { LostReport } from '../generated/prisma/client';
import { CreateLostReportDto } from '../items/items.dto';
import { DatabaseService } from '../database/database.service';
import { IdempotencyService } from '../common/idempotency.service';
import { lostTimes } from '../common/dto';
import { cursorFor, olderThan, readCursor } from '../common/cursor';
import { fail } from '../common/http';
import { InstitutionItemsService } from '../items/institution-items.service';
import { reportMatches } from './lost-report-matches';

function fields(dto: CreateLostReportDto) {
  return {
    name: dto.name,
    category: dto.category ?? 'OTHER',
    features: dto.features || null,
    ...lostTimes(dto.lostTime),
    placeName: dto.placeName ?? null,
    lostLabel: dto.lostLocation.label,
    lat: dto.lostLocation.lat,
    lng: dto.lostLocation.lng,
  };
}
function view(r: LostReport) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    features: r.features,
    placeName: r.placeName ?? r.lostLabel,
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
  };
}
@Controller('api/v1/lost-reports')
export class LostReportsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly idem: IdempotencyService,
    private readonly institutions: InstitutionItemsService,
  ) {}
  @Post()
  async create(
    @Body() dto: CreateLostReportDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: SessionRequest,
  ) {
    const userId = req.authSession!.userId!,
      data = fields(dto);
    return {
      data: await this.idem.run(
        userId,
        'POST /lost-reports',
        key,
        dto,
        async (tx) => {
          const row = await tx.lostReport.create({ data: { userId, ...data } });
          await tx.auditEvent.create({
            data: {
              actorId: userId,
              entityType: 'lost_reports',
              entityId: row.id,
              action: 'LOST_REPORT_CREATED',
              requestId: String(req.headers['x-request-id']),
            },
          });
          return { id: row.id };
        },
      ),
    };
  }
  // 내 신고 목록과 상세는 로그인한 회원의 행만 조회합니다.
  @Get()
  async list(@Req() req: SessionRequest, @Query('cursor') cursor?: string) {
    const userId = req.authSession!.userId!,
      scope = 'lost-reports:' + userId;
    const rows = await this.db.lostReport.findMany({
      where: { userId, AND: olderThan(readCursor(cursor, scope)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
    const page = rows.slice(0, 50),
      last = page.at(-1);
    return {
      data: page.map(view),
      meta: {
        nextCursor:
          rows.length > 50 && last
            ? cursorFor(last.id, last.createdAt, scope)
            : null,
      },
    };
  }
  @Get(':id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
  ) {
    const row = await this.db.lostReport.findFirst({
      where: { id, userId: req.authSession!.userId! },
    });
    if (!row) fail(404, 'RESOURCE_NOT_FOUND', '분실 신고를 찾을 수 없습니다.');
    return { data: view(row) };
  }
  @Get(':id/matches')
  async matches(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
  ) {
    const report = await this.db.lostReport.findFirst({
      where: { id, userId: req.authSession!.userId! },
    });
    if (!report)
      fail(404, 'RESOURCE_NOT_FOUND', '분실 신고를 찾을 수 없습니다.');
    const school = await this.institutions
      .schoolForMatching()
      .catch(() => null);
    return {
      data: await reportMatches(this.db, report, school ?? []),
      meta: { schoolAvailable: school !== null },
    };
  }
  @Put(':id')
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
    @Body() dto: CreateLostReportDto,
  ) {
    const userId = req.authSession!.userId!;
    return this.db.$transaction(async (tx) => {
      const [row] = await tx.lostReport.updateManyAndReturn({
        where: { id, userId },
        data: fields(dto),
      });
      if (!row)
        fail(404, 'RESOURCE_NOT_FOUND', '분실 신고를 찾을 수 없습니다.');
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          entityType: 'lost_reports',
          entityId: id,
          action: 'LOST_REPORT_UPDATED',
          requestId: String(req.headers['x-request-id']),
        },
      });
      return { data: view(row) };
    });
  }
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
  ) {
    const userId = req.authSession!.userId!;
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.lostReport.deleteMany({
        where: { id, userId },
      });
      if (!count)
        fail(404, 'RESOURCE_NOT_FOUND', '분실 신고를 찾을 수 없습니다.');
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          entityType: 'lost_reports',
          entityId: id,
          action: 'LOST_REPORT_DELETED',
          requestId: String(req.headers['x-request-id']),
        },
      });
    });
  }
}
