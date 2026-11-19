import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { digest, equal, sign } from '../common/crypto';
import { fail } from '../common/http';
import { ItemsService, publicSelect } from './items.service';
import { InstitutionItemsService } from './institution-items.service';
import {
  itemSearch,
  matchesName,
  matchesPlace,
  publicFoundWhere,
} from './item-search';
import { koreaDay, sinceFound } from './institution-records';
import {
  afterSql,
  compareRank,
  relevanceScore,
  relevanceSql,
  normalizedSql,
  searchWhereSql,
  type RankedKey,
} from './search-order';
import type { SearchResultsDto } from './search-results.controller';

type Position = RankedKey & { scope: string; at: number; withoutSchool?: true };
/** 재시작 직후 학교의 일시 실패는 한 번 재시도하고, 누락된 결과를 정상 결과로 내보내지 않습니다. */
export async function completeSchool<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    try {
      return await read();
    } catch {
      return fail(503, 'EXTERNAL_UNAVAILABLE', '학교 목록을 잠시 불러올 수 없어요.');
    }
  }
}
export function readSearchPosition(
  cursor: string | undefined,
  scope: string,
  now: number,
): Position | undefined {
  if (!cursor) return;
  try {
    const [body, signature, extra] = cursor.split('.');
    if (extra || !signature || !equal(sign(body), signature)) throw Error();
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Position;
    if (
      p.scope !== scope ||
      (p.withoutSchool !== undefined && p.withoutSchool !== true) ||
      !Number.isInteger(p.score) ||
      p.score < 0 ||
      p.score > 1000 ||
      !/^(?:[0-9a-f-]{36}|lost112:[a-zA-Z0-9]{1,32}:\d{1,6}|hansung:\d{1,12})$/.test(
        p.id,
      ) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.day) ||
      !Number.isFinite(p.at) ||
      p.at > now ||
      now - p.at > 3600000
    )
      throw Error();
    return p;
  } catch {
    return fail(
      400,
      'VALIDATION_ERROR',
      '검색 조건이 변경되었거나 검색 시간이 지났어요. 다시 검색해 주세요.',
    );
  }
}
export function searchCursor(p: Position) {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return body + '.' + sign(body);
}

@Injectable()
export class SearchResultsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly members: ItemsService,
    private readonly institutions: InstitutionItemsService,
  ) {}

  async search(query: SearchResultsDto) {
    const now = Date.now();
    const search = itemSearch(query.q, query.place);
    const scope = digest(
      JSON.stringify([
        1,
        search,
        query.period,
        query.from,
        query.to,
        query.sort,
      ]),
    );
    const after = readSearchPosition(query.cursor, scope, now);
    const at = after?.at ?? now;
    for (const day of [query.from, query.to]) {
      if (
        day &&
        (!Number.isFinite(Date.parse(day)) ||
          new Date(day).toISOString().slice(0, 10) !== day)
      )
        fail(400, 'VALIDATION_ERROR', '날짜를 확인해 주세요.');
    }
    if (query.from && query.to && query.from > query.to)
      fail(400, 'VALIDATION_ERROR', '시작일은 끝일보다 늦을 수 없어요.');
    const from = [
      sinceFound('all', at),
      query.from ?? sinceFound(query.period, at),
    ]
      .sort()
      .at(-1)!;
    const through = [koreaDay(at), query.to ?? koreaDay(at)].sort()[0];
    const fromTime = new Date(from + 'T00:00:00+09:00');
    const toTime = new Date(
      Math.min(at, Date.parse(through + 'T23:59:59.999+09:00')),
    );
    const rank =
      query.sort === 'relevance'
        ? relevanceSql(
            Prisma.sql`normalized_name`,
            Prisma.sql`normalized_features`,
            search,
            true,
          )
        : Prisma.sql`0`;
    const normalize = (column: Prisma.Sql) =>
      query.sort === 'relevance' ? normalizedSql(column) : Prisma.sql`''`;
    // 각 출처에서 전체 후보를 먼저 정렬합니다. 출처별 상위 26건이면
    // 세 출처를 합친 상위 25건과 다음 페이지 유무를 정확하게 결정할 수 있습니다.
    const [memberKeys, portalKeys, school, memberTotal] = await Promise.all([
      // MATERIALIZED는 점수/정규화를 한 번만 계산하게 합니다. 다음 페이지 조건에서
      // 같은 식을 반복 실행하면 대량 자료의 정확도순 조회가 크게 느려집니다.
      this.db.$queryRaw<RankedKey[]>(Prisma.sql`
        WITH candidates AS MATERIALIZED (
          SELECT id::text AS id, to_char(found_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
            ${normalize(Prisma.sql`name`)} AS normalized_name,
            ${normalize(Prisma.sql`public_features`)} AS normalized_features
          FROM found_items WHERE NOT archived AND status IN ('AVAILABLE', 'RESERVED')
            AND created_at <= ${new Date(at)} AND found_at BETWEEN ${fromTime} AND ${toTime}
            AND ${searchWhereSql(search, false)}
        ), ranked AS MATERIALIZED (SELECT id, day, ${rank} AS score FROM candidates)
        SELECT * FROM ranked WHERE ${afterSql(after)}
        ORDER BY score DESC, day DESC, id COLLATE "C" ASC LIMIT 26`),
      this.db.$queryRaw<RankedKey[]>(Prisma.sql`
        WITH candidates AS MATERIALIZED (
          SELECT id, day, ${normalize(Prisma.sql`name`)} AS normalized_name,
            ${normalize(Prisma.sql`kind_name`)} AS normalized_features FROM verified_portal_items
          WHERE stored AND day BETWEEN ${from} AND ${through} AND ${searchWhereSql(search, true)}
        ), ranked AS MATERIALIZED (SELECT id, day, ${rank} AS score FROM candidates)
        SELECT * FROM ranked WHERE ${afterSql(after)}
        ORDER BY score DESC, day DESC, id COLLATE "C" ASC LIMIT 26`),
      // 학교 원본 장애가 DB에 저장된 다른 물품의 검색까지 막지 않게 합니다.
      // 첫 페이지에서 빠진 출처는 커서에 고정하고, 새 검색에서 다시 확인합니다.
      after?.withoutSchool
        ? { items: [], unavailable: true }
        : completeSchool(() => this.institutions.schoolForMatching())
            .then((items) => ({ items, unavailable: false }))
            .catch((error: unknown) => {
              if (after) throw error;
              return { items: [], unavailable: true };
            }),
      !after
        ? this.db.foundItem.count({
            where: {
              ...publicFoundWhere(search, fromTime, toTime, at),
              createdAt: { lte: new Date(at) },
            },
          })
        : undefined,
    ]);
    const schoolItems = school.items.filter(
      (i) =>
        i.date >= from &&
        i.date <= through &&
        matchesName(search, i.name) &&
        matchesPlace(search.place, i.storage, i.foundPlace),
    );
    const schoolKeys = schoolItems
      .map((i) => ({
        id: i.id,
        day: i.date,
        score:
          query.sort === 'relevance' ? relevanceScore(i.name, '', search) : 0,
      }))
      .filter((i) => !after || compareRank(i, after) > 0);
    const keys = [...memberKeys, ...portalKeys, ...schoolKeys].sort(
      compareRank,
    );
    const page = keys.slice(0, 25);
    const ids = new Set(page.map((i) => i.id));
    const [memberRows, portalRows] = await Promise.all([
      this.db.foundItem.findMany({
        where: {
          id: { in: memberKeys.filter((i) => ids.has(i.id)).map((i) => i.id) },
        },
        select: publicSelect,
      }),
      this.db.verifiedPortalItem.findMany({
        where: {
          id: { in: portalKeys.filter((i) => ids.has(i.id)).map((i) => i.id) },
        },
        omit: { searchFragments: true },
      }),
    ]);
    const rows = new Map<
      string,
      ReturnType<ItemsService['publicDto']> | (typeof school.items)[number]
    >([
      ...memberRows.map((i) => [i.id, this.members.publicDto(i)] as const),
      ...portalRows.map((i) => [i.id, this.institutions.savedItem(i)] as const),
      ...schoolItems
        .filter((i) => ids.has(i.id))
        .map((i) => [i.id, i] as const),
    ]);
    const last = page.at(-1);
    return {
      items: page.map((i) => rows.get(i.id)).filter((i) => i !== undefined),
      nextCursor:
        keys.length > 25 && last
          ? searchCursor({ ...last, scope, at, ...(school.unavailable && { withoutSchool: true as const }) })
          : null,
      memberTotal,
      notices: school.unavailable
        ? ['한성대 자료를 일시적으로 불러오지 못했어요. 다른 기관과 회원 물품을 먼저 표시합니다. 다시 검색하면 한성대 자료도 재확인해요.']
        : [],
      sort: query.sort,
    };
  }
}
