/**
 * 본인 프로필과 내역을 제공합니다. 전화번호 원문이나 비밀번호 해시는 응답하지 않습니다.
 * 분실 신고·내 요청·등록 물품·받은 요청을 로그인한 회원의 관계로만 필터링합니다.
 */
import {
  Body,
  Controller,
  Get,
  Patch,
  Delete,
  HttpCode,
  Query,
  Req,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { publicUser } from '../auth/auth.controller';
import type { SessionRequest } from '../auth/session.service';
import { cursorFor, olderThan, readCursor } from '../common/cursor';

import { randomUUID, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { fail } from '../common/http';
import { transaction } from '../common/transaction';
import { RateLimitService } from '../common/rate-limit.service';
import { ChangePasswordDto, HistoryDto, ProfileDto } from './users.dto';
@Controller('api/v1/me')
export class UsersController {
  constructor(
    private readonly db: DatabaseService,
    private readonly rates: RateLimitService,
  ) {}
  @Get()
  me(@Req() req: SessionRequest) {
    return { data: publicUser(req.authSession!.user!) };
  }
  @Patch()
  async profile(@Req() req: SessionRequest, @Body() dto: ProfileDto) {
    return {
      data: publicUser(
        await this.db.user.update({
          where: { id: req.authSession!.userId! },
          data: { nickname: dto.nickname },
        }),
      ),
    };
  }
  @Patch('password')
  @HttpCode(204)
  async password(@Req() req: SessionRequest, @Body() dto: ChangePasswordDto) {
    const user = req.authSession!.user!;
    await this.rates.consume('change-password:' + user.id, 10, 900000);
    if (!(await verify(user.passwordHash, dto.currentPassword)))
      fail(400, 'PASSWORD_INVALID', '현재 비밀번호를 확인해 주세요.');
    const passwordHash = await hash(dto.newPassword, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          withdrawnAt: null,
        },
        data: { passwordHash },
      });
      if (!count) fail(409, 'STATE_CONFLICT', '로그인 후 다시 시도해 주세요.');
      await tx.session.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date() },
      });
      await tx.authChallenge.updateMany({
        where: { userId: user.id, purpose: 'RESET', consumedAt: null },
        data: { consumedAt: new Date() },
      });
    });
  }
  @Delete('phone')
  @HttpCode(204)
  async clearPhone(@Req() req: SessionRequest) {
    const userId = req.authSession!.userId!;
    await transaction(this.db, async (tx) => {
      await tx.authChallenge.updateMany({
        where: { userId, purpose: 'PHONE', consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: userId },
        data: { phoneCiphertext: null, phoneVerifiedAt: null },
      });
    });
  }
  @Delete()
  @HttpCode(204)
  async withdraw(@Req() req: SessionRequest) {
    const userId = req.authSession!.userId!;
    const disabledHash = await hash(randomBytes(32), {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await transaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
      // 물품을 먼저 잠가 반환 작업과 같은 순서로 종료하고, 상대방의 다른 신고·물품은 보존합니다.
      await tx.$queryRaw`SELECT id FROM found_items WHERE keeper_id=${userId}::uuid OR id IN
        (SELECT item_id FROM claims WHERE requester_id=${userId}::uuid AND status IN ('APPROVED','HANDED_OVER')) ORDER BY id FOR UPDATE`;
      const active = await tx.claim.findMany({
        where: {
          requesterId: userId,
          status: { in: ['APPROVED', 'HANDED_OVER'] },
        },
        select: { itemId: true },
      });
      await tx.claim.updateMany({
        where: {
          OR: [{ requesterId: userId }, { item: { keeperId: userId } }],
          status: { in: ['PENDING', 'APPROVED', 'HANDED_OVER'] },
        },
        data: {
          status: 'CLOSED',
          decisionReason: '회원 탈퇴로 요청이 종료되었어요.',
        },
      });
      await tx.foundItem.updateMany({
        where: { id: { in: active.map((r) => r.itemId) }, status: 'RESERVED' },
        data: { status: 'AVAILABLE' },
      });
      await tx.foundItem.updateMany({
        where: { keeperId: userId },
        data: { archived: true },
      });
      await tx.foundItemSecret.deleteMany({
        where: { item: { keeperId: userId } },
      });
      await tx.itemPhoto.updateMany({
        where: { uploaderId: userId },
        data: { state: 'READY', sortOrder: null, itemId: null, reportId: null },
      });
      await tx.routeRecording.deleteMany({ where: { userId } });
      await tx.lostReport.deleteMany({ where: { userId } });
      await tx.authChallenge.deleteMany({
        where: { OR: [{ userId }, { session: { userId } }] },
      });
      await tx.idempotencyRecord.deleteMany({ where: { userId } });
      await tx.consent.deleteMany({ where: { userId } });
      await tx.session.updateMany({
        where: { userId },
        data: { expiresAt: new Date() },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          withdrawnAt: new Date(),
          email: 'withdrawn-' + randomUUID() + '@example.invalid',
          nickname: '탈퇴회원',
          phoneCiphertext: null,
          phoneVerifiedAt: null,
          passwordHash: disabledHash,
        },
      });
    });
  }
  @Get('history')
  async history(@Req() req: SessionRequest, @Query() query: HistoryDto) {
    const userId = req.authSession!.userId!,
      scope = JSON.stringify(['history', userId, query.type]),
      cursor = readCursor(query.cursor, scope);
    const options = {
      take: query.limit + 1,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    };
    const rows =
      query.type === 'MY_ITEMS'
        ? await this.db.foundItem.findMany({
            ...options,
            where: {
              keeperId: userId,
              archived: false,
              AND: olderThan(cursor),
            },
            select: {
              id: true,
              name: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : query.type === 'LOST_REPORTS'
          ? await this.db.lostReport.findMany({
              ...options,
              where: { userId, AND: olderThan(cursor) },
              select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
              },
            })
          : (
              await this.db.claim.findMany({
                ...options,
                where: {
                  ...(query.type === 'MY_CLAIMS'
                    ? { requesterId: userId }
                    : { item: { keeperId: userId } }),
                  AND: olderThan(cursor),
                },
                select: {
                  id: true,
                  itemId: true,
                  status: true,
                  createdAt: true,
                  updatedAt: true,
                  item: { select: { name: true } },
                },
              })
            ).map(({ item, ...row }) => ({ ...row, name: item.name }));
    const page = rows.slice(0, query.limit),
      last = page.at(-1);
    return {
      data: page,
      meta: {
        nextCursor:
          rows.length > query.limit && last
            ? cursorFor(last.id, last.createdAt, scope)
            : null,
      },
    };
  }
}
