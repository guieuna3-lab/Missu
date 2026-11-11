/** 반환 업무 규칙입니다. 모든 변경은 물품→요청 순서로 잠가 동시 승인·반환 충돌을 막습니다. */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '../generated/prisma/client';
import { IdempotencyService } from '../common/idempotency.service';
import { fail } from '../common/http';
import { lostTimes } from '../common/dto';
import { cursorFor, olderThan, readCursor } from '../common/cursor';
import { transaction } from '../common/transaction';
import {
  CreateClaimDto,
  DecisionDto,
  MessageDto,
  MessagesQueryDto,
  ReportDto,
} from './claims.dto';
type Tx = Prisma.TransactionClient;
const relations = {
  item: { select: { id: true, keeperId: true, status: true } },
  requester: { select: { nickname: true } },
} satisfies Prisma.ClaimInclude;
type ClaimRow = Prisma.ClaimGetPayload<{ include: typeof relations }>;

@Injectable()
export class ClaimsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly idem: IdempotencyService,
  ) {}
  private member(
    row: ClaimRow | null,
    userId: string,
  ): asserts row is ClaimRow {
    if (!row || (row.requesterId !== userId && row.item.keeperId !== userId))
      fail(404, 'RESOURCE_NOT_FOUND', '요청을 찾을 수 없습니다.');
  }
  private keeper(row: ClaimRow, userId: string) {
    if (row.item.keeperId !== userId)
      fail(404, 'RESOURCE_NOT_FOUND', '요청을 찾을 수 없습니다.');
  }
  private async locked(tx: Tx, id: string, userId: string) {
    const initial = await tx.claim.findUnique({
      where: { id },
      include: relations,
    });
    this.member(initial, userId);
    await tx.$queryRawUnsafe(
      'SELECT id FROM found_items WHERE id=$1::uuid FOR UPDATE',
      initial.itemId,
    );
    await tx.$queryRawUnsafe(
      'SELECT id FROM claims WHERE id=$1::uuid FOR UPDATE',
      id,
    );
    const value = await tx.claim.findUnique({
      where: { id },
      include: relations,
    });
    this.member(value, userId);
    return value;
  }
  private async audit(
    tx: Tx,
    actorId: string,
    id: string,
    from: string | null,
    to: string,
    requestId: string,
  ) {
    await tx.auditEvent.create({
      data: {
        actorId,
        entityType: 'claims',
        entityId: id,
        action: 'CLAIM_' + to,
        fromState: from,
        toState: to,
        requestId,
      },
    });
  }
  create(
    itemId: string,
    userId: string,
    dto: CreateClaimDto,
    key: string | undefined,
    requestId: string,
  ) {
    const times = lostTimes(dto.lostTime);
    return this.idem.run(
      userId,
      'POST /items/' + itemId + '/claims',
      key,
      dto,
      async (tx) => {
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          'claim-rate:' + userId,
        );
        await tx.$queryRawUnsafe(
          'SELECT id FROM found_items WHERE id=$1::uuid FOR UPDATE',
          itemId,
        );
        const item = await tx.foundItem.findUnique({ where: { id: itemId } });
        if (!item) fail(404, 'RESOURCE_NOT_FOUND', '물품을 찾을 수 없습니다.');
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (!user.phoneVerifiedAt)
          fail(
            403,
            'PHONE_VERIFICATION_REQUIRED',
            '전화번호 인증이 필요합니다.',
          );
        if (item.keeperId === userId)
          fail(
            409,
            'SELF_CLAIM_FORBIDDEN',
            '본인이 보관한 물품에는 요청할 수 없습니다.',
          );
        if (item.status !== 'AVAILABLE')
          fail(
            409,
            'ITEM_ALREADY_RESERVED',
            '이미 진행 중이거나 반환된 물품입니다.',
          );
        if (
          await tx.claim.findFirst({
            where: {
              itemId,
              requesterId: userId,
              status: { in: ['PENDING', 'APPROVED', 'HANDED_OVER'] },
            },
          })
        )
          fail(409, 'ACTIVE_CLAIM_EXISTS', '진행 중인 요청이 있습니다.');
        const recent = await tx.claim.count({
          where: {
            requesterId: userId,
            createdAt: { gt: new Date(Date.now() - 900000) },
          },
        });
        if (recent >= 10)
          fail(
            429,
            'RATE_LIMITED',
            '요청이 많습니다. 잠시 후 다시 시도하세요.',
          );
        const claim = await tx.claim.create({
          data: {
            itemId,
            requesterId: userId,
            features: dto.features,
            ...times,
            lostLabel: dto.lostLocation.label,
            lat: dto.lostLocation.lat,
            lng: dto.lostLocation.lng,
          },
        });
        await this.audit(tx, userId, claim.id, null, 'PENDING', requestId);
        return { claimId: claim.id, status: claim.status };
      },
    );
  }
  async detail(id: string, userId: string) {
    const row = await this.db.claim.findUnique({
      where: { id },
      include: relations,
    });
    this.member(row, userId);
    return {
      id: row.id,
      itemId: row.itemId,
      requesterNickname: row.requester.nickname,
      features: row.features,
      lostTime: {
        start: row.lostStart,
        end: row.lostEnd,
        precision: row.timePrecision,
      },
      lostLocation: {
        label: row.lostLabel,
        lat: Number(row.lat),
        lng: Number(row.lng),
      },
      status: row.status,
      decisionReason: row.decisionReason,
      approvedAt: row.approvedAt,
      handedOverAt: row.handedOverAt,
      receivedAt: row.receivedAt,
      updatedAt: row.updatedAt,
    };
  }
  decision(
    id: string,
    userId: string,
    dto: DecisionDto,
    key: string | undefined,
    requestId: string,
  ) {
    if (dto.decision === 'REJECT' && !dto.reason)
      fail(400, 'VALIDATION_ERROR', '거절 사유를 입력하세요.');
    return this.idem.run(
      userId,
      'POST /claims/' + id + '/decision',
      key,
      dto,
      async (tx) => {
        const row = await this.locked(tx, id, userId);
        this.keeper(row, userId);
        if (row.status !== 'PENDING' || row.item.status !== 'AVAILABLE')
          fail(
            409,
            'STATE_CONFLICT',
            '현재 상태에서 승인하거나 거절할 수 없습니다.',
          );
        const next = dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        await tx.claim.update({
          where: { id },
          data: {
            status: next,
            decisionReason: dto.decision === 'REJECT' ? dto.reason : null,
            approvedAt: next === 'APPROVED' ? new Date() : null,
          },
        });
        if (next === 'APPROVED') {
          const pending = await tx.claim.findMany({
            where: { itemId: row.itemId, status: 'PENDING', id: { not: id } },
            select: { id: true },
          });
          await tx.claim.updateMany({
            where: { id: { in: pending.map((x) => x.id) } },
            data: { status: 'CLOSED' },
          });
          await tx.foundItem.update({
            where: { id: row.itemId },
            data: { status: 'RESERVED' },
          });
          for (const closed of pending)
            await this.audit(
              tx,
              userId,
              closed.id,
              'PENDING',
              'CLOSED',
              requestId,
            );
        }
        await this.audit(tx, userId, id, row.status, next, requestId);
        return {
          claimId: id,
          status: next,
          itemStatus: next === 'APPROVED' ? 'RESERVED' : row.item.status,
        };
      },
    );
  }
  transition(
    id: string,
    userId: string,
    kind: 'handover' | 'receipt',
    key: string | undefined,
    requestId: string,
  ) {
    return this.idem.run(
      userId,
      'POST /claims/' + id + '/' + kind,
      key,
      {},
      async (tx) => {
        const row = await this.locked(tx, id, userId);
        if (kind === 'handover') this.keeper(row, userId);
        else if (row.requesterId !== userId)
          fail(404, 'RESOURCE_NOT_FOUND', '요청을 찾을 수 없습니다.');
        const next = kind === 'handover' ? 'HANDED_OVER' : 'RETURNED';
        const previous = kind === 'handover' ? 'APPROVED' : 'HANDED_OVER';
        if (row.status === next)
          return {
            claimId: id,
            status: row.status,
            itemStatus: row.item.status,
            updatedAt: row.updatedAt.toISOString(),
          };
        if (row.status !== previous || row.item.status !== 'RESERVED')
          fail(409, 'STATE_CONFLICT', '현재 상태에서 처리할 수 없습니다.');
        const now = new Date();
        const changed = await tx.claim.update({
          where: { id },
          data: {
            status: next,
            ...(kind === 'handover'
              ? { handedOverAt: now }
              : { receivedAt: now }),
          },
        });
        if (kind === 'receipt')
          await tx.foundItem.update({
            where: { id: row.itemId },
            data: { status: 'RETURNED' },
          });
        await this.audit(tx, userId, id, row.status, next, requestId);
        return {
          claimId: id,
          status: next,
          itemStatus: kind === 'receipt' ? 'RETURNED' : 'RESERVED',
          updatedAt: changed.updatedAt.toISOString(),
        };
      },
    );
  }
  async messages(id: string, userId: string, query: MessagesQueryDto) {
    const row = await this.db.claim.findUnique({
      where: { id },
      include: relations,
    });
    this.member(row, userId);
    if (!['APPROVED', 'HANDED_OVER', 'RETURNED'].includes(row.status))
      fail(409, 'CHAT_NOT_AVAILABLE', '승인된 요청의 대화만 볼 수 있습니다.');
    if (query.after && query.before)
      fail(400, 'VALIDATION_ERROR', 'after와 before 중 하나만 사용하세요.');
    const scope = JSON.stringify(['messages', id, userId]),
      cursor = readCursor(query.after ?? query.before, scope);
    const ascending = !!query.after;
    const direction: Prisma.MessageWhereInput =
      ascending && cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : olderThan(cursor);
    const rows = await this.db.message.findMany({
      where: { claimId: id, AND: direction },
      orderBy: [
        { createdAt: ascending ? 'asc' : 'desc' },
        { id: ascending ? 'asc' : 'desc' },
      ],
      take: query.limit + 1,
      select: { id: true, senderId: true, body: true, createdAt: true },
    });
    const page = rows.slice(0, query.limit);
    if (!ascending) page.reverse();
    const first = page[0],
      last = page.at(-1);
    return {
      messages: page.map((x) => ({
        id: x.id,
        senderId: x.senderId,
        body: x.body,
        sentAt: x.createdAt,
      })),
      nextCursor: last
        ? cursorFor(last.id, last.createdAt, scope)
        : (query.after ?? null),
      previousCursor:
        first && !ascending && rows.length > query.limit
          ? cursorFor(first.id, first.createdAt, scope)
          : null,
      hasMore: rows.length > query.limit,
    };
  }
  sendMessage(id: string, userId: string, dto: MessageDto) {
    return transaction(this.db, async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        'message:' + userId + ':' + dto.clientMessageId,
      );
      const row = await this.locked(tx, id, userId);
      const existing = await tx.message.findUnique({
        where: {
          senderId_clientMessageId: {
            senderId: userId,
            clientMessageId: dto.clientMessageId,
          },
        },
      });
      if (existing) {
        if (existing.claimId !== id || existing.body !== dto.body)
          fail(
            409,
            'IDEMPOTENCY_MISMATCH',
            '같은 메시지 키에 다른 내용을 사용할 수 없습니다.',
          );
        return {
          id: existing.id,
          senderId: userId,
          body: existing.body,
          sentAt: existing.createdAt,
        };
      }
      if (!['APPROVED', 'HANDED_OVER'].includes(row.status))
        fail(409, 'CHAT_READ_ONLY', '현재 상태에서는 대화를 보낼 수 없습니다.');
      const message = await tx.message.create({
        data: {
          claimId: id,
          senderId: userId,
          body: dto.body,
          clientMessageId: dto.clientMessageId,
        },
      });
      return {
        id: message.id,
        senderId: userId,
        body: message.body,
        sentAt: message.createdAt,
      };
    });
  }
  report(
    id: string,
    userId: string,
    dto: ReportDto,
    key: string | undefined,
    requestId: string,
  ) {
    return this.idem.run(
      userId,
      'POST /claims/' + id + '/reports',
      key,
      dto,
      async (tx) => {
        const row = await this.locked(tx, id, userId);
        this.keeper(row, userId);
        const report = await tx.abuseReport.upsert({
          where: { claimId_reporterId: { claimId: id, reporterId: userId } },
          create: { claimId: id, reporterId: userId, reason: dto.reason },
          update: {},
        });
        await tx.auditEvent.create({
          data: {
            actorId: userId,
            action: 'REPORT_RECEIVED',
            entityType: 'abuse_reports',
            entityId: report.id,
            requestId,
          },
        });
        return {
          reportId: report.id,
          status: report.status,
          receivedAt: report.createdAt.toISOString(),
        };
      },
    );
  }
  async reportDetail(id: string, userId: string) {
    const row = await this.db.abuseReport.findFirst({
      where: { id, reporterId: userId },
    });
    if (!row) fail(404, 'RESOURCE_NOT_FOUND', '접수 정보를 찾을 수 없습니다.');
    return {
      reportId: row.id,
      status: row.status,
      receivedAt: row.createdAt,
      reason: row.reason,
    };
  }
}
