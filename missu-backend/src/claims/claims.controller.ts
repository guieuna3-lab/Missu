import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { SessionRequest } from '../auth/session.service';
import { fail } from '../common/http';
import { ClaimsService } from './claims.service';
import {
  CreateClaimDto,
  DecisionDto,
  EmptyDto,
  MessageDto,
  MessagesQueryDto,
  ReportDto,
} from './claims.dto';

@Controller('api/v1')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}
  @Post('items/:id/claims')
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateClaimDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: SessionRequest,
  ) {
    return {
      data: await this.claims.create(
        id,
        req.authSession!.userId!,
        dto,
        key,
        String(req.headers['x-request-id']),
      ),
    };
  }
  @Get('claims/:id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
  ) {
    return { data: await this.claims.detail(id, req.authSession!.userId!) };
  }
  @Post('claims/:id/decision')
  @HttpCode(200)
  async decision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: SessionRequest,
  ) {
    return {
      data: await this.claims.decision(
        id,
        req.authSession!.userId!,
        dto,
        key,
        String(req.headers['x-request-id']),
      ),
    };
  }
  @Get('claims/:id/messages')
  async messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
    @Req() req: SessionRequest,
  ) {
    return {
      data: await this.claims.messages(id, req.authSession!.userId!, query),
    };
  }
  @Post('claims/:id/messages')
  async message(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MessageDto,
    @Req() req: SessionRequest,
  ) {
    return {
      data: await this.claims.sendMessage(id, req.authSession!.userId!, dto),
    };
  }
  private empty(dto: EmptyDto) {
    if (
      !dto ||
      typeof dto !== 'object' ||
      Array.isArray(dto) ||
      Object.keys(dto).length
    )
      fail(400, 'VALIDATION_ERROR', '빈 JSON 객체를 보내세요.');
  }
  @Post('claims/:id/handover')
  @HttpCode(200)
  async handover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmptyDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: SessionRequest,
  ) {
    this.empty(dto);
    return {
      data: await this.claims.transition(
        id,
        req.authSession!.userId!,
        'handover',
        key,
        String(req.headers['x-request-id']),
      ),
    };
  }
  @Post('claims/:id/receipt')
  @HttpCode(200)
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmptyDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: SessionRequest,
  ) {
    this.empty(dto);
    return {
      data: await this.claims.transition(
        id,
        req.authSession!.userId!,
        'receipt',
        key,
        String(req.headers['x-request-id']),
      ),
    };
  }
  @Post('claims/:id/reports')
  async report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: SessionRequest,
  ) {
    return {
      data: await this.claims.report(
        id,
        req.authSession!.userId!,
        dto,
        key,
        String(req.headers['x-request-id']),
      ),
    };
  }
  @Get('reports/:id')
  async reportDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
  ) {
    return {
      data: await this.claims.reportDetail(id, req.authSession!.userId!),
    };
  }
}
