/**
 * 본인 프로필과 내역을 제공합니다. 전화번호 원문이나 비밀번호 해시는 응답하지 않습니다.
 * 분실 신고·내 요청·등록 물품·받은 요청을 로그인한 회원의 관계로만 필터링합니다.
 */
import { Body, Controller, Get, Patch, Query, Req } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { publicUser } from '../auth/auth.controller';
import type { SessionRequest } from '../auth/session.service';
import { cursorFor, olderThan, readCursor } from '../common/cursor';

import { HistoryDto, ProfileDto } from './users.dto';
@Controller('api/v1/me')
export class UsersController {
  constructor(private readonly db: DatabaseService) {}
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
            where: { keeperId: userId, AND: olderThan(cursor) },
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
