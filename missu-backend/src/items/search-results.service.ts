import { Injectable, Logger } from '@nestjs/common';
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
import { distance } from './institution-records';
import { searchPoint, searchRange } from './search-range';
import { portalRanked } from './search-portal-rank';
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
      return fail(
        503,
        'EXTERNAL_UNAVAILABLE',
        '학교 목록을 잠시 불러올 수 없어요.',
      );
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
      p.score < -2147483647 ||
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
  private readonly logger = new Logger(SearchResultsService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly members: ItemsService,
    private readonly institutions: InstitutionItemsService,
  ) {}

  private readonly replies = new Map<
    string,
    { until: number; value: Promise<unknown> }
  >();
  private memo<T>(key: string, read: () => Promise<T>): Promise<T> {
    const saved = this.replies.get(key);
    if (saved && saved.until > Date.now()) return saved.value as Promise<T>;
    if (this.replies.size >= 32)
      this.replies.delete(this.replies.keys().next().value!);
    const value = read();
    this.replies.set(key, { until: Date.now() + 20000, value });
    void value.then(
      (reply) => {
        const entry = this.replies.get(key);
        if (entry?.value !== value) return;
        if (
          reply &&
          typeof reply === 'object' &&
          'notices' in reply &&
          Array.isArray(reply.notices) &&
          reply.notices.some(
            (notice: unknown) =>
              typeof notice === 'string' && notice.includes('불러오지 못'),
          )
        )
          this.replies.delete(key);
        else entry.until = Date.now() + 20000;
      },
      () => undefined,
    );
    void value.catch(() => {
      if (this.replies.get(key)?.value === value) this.replies.delete(key);
    });
    return value;
  }
  invalidCursor() {
    return fail(400, 'VALIDATION_ERROR', '다시 검색해 주세요.');
  }
  search(query: SearchResultsDto) {
    return query.cursor
      ? this.read(query)
      : this.memo('list:' + JSON.stringify(query), () => this.read(query));
  }
  recent(cursor?: string) {
    const query = {
      q: '',
      place: '',
      period: 'all',
      sort: 'recent',
      cursor,
    } as SearchResultsDto;
    return cursor
      ? this.read(query, true)
      : this.memo('home', () => this.read(query, true));
  }
  count(query: SearchResultsDto) {
    const now = Date.now();
    const range = searchRange(query, now);
    const search = itemSearch(query.q, query.place);
    // 정렬과 기준 좌표는 합계에 영향을 주지 않습니다. 기간·장소가 같은 합계를 공유합니다.
    return this.memo(
      'count:' + JSON.stringify([search, range.from, range.through]),
      async () => {
        const [members, portal, school] = await Promise.all([
          this.db.foundItem.count({
            where: publicFoundWhere(search, range.fromTime, range.toTime, now),
          }),
          range.from > range.through
            ? 0
            : this.institutions.countForMatching(
                search.q,
                search.place,
                range.from,
                range.through,
              ),
          this.institutions.schoolForMatching().catch(() => null),
        ]);
        const schoolTotal =
          school?.filter(
            (item) =>
              item.date >= range.from &&
              item.date <= range.through &&
              matchesName(search, item.name) &&
              matchesPlace(search.place, item.storage, item.foundPlace),
          ).length ?? 0;
        return {
          total: members + portal + schoolTotal,
          checkedAt: new Date(now).toISOString(),
          notices: !school
            ? ['한성대 자료를 불러오지 못해 확인 가능한 자료만 집계했어요.']
            : this.institutions.schoolSnapshotStale()
              ? ['학교 목록을 갱신 중이에요. 마지막 확인 자료를 표시해요.']
              : [],
        };
      },
    );
  }

  private async ranked(query: Prisma.Sql) {
    const started = Date.now();
    const source = query.sql.includes('verified_portal_items')
      ? 'institution'
      : 'member';
    try {
      return await this.db.$transaction(
        async (tx) => {
          // 짧은 동적 검색에 LLVM 컴파일 비용이 발생하지 않도록 이 조회에만 적용합니다.
          await tx.$executeRaw`SET LOCAL jit = off`;
          // 검색 중간 자료가 작은 기본 작업 메모리를 넘어 임시 파일로 반복
          // 기록되지 않게 합니다. 서버 전역 설정이 아닌 이 읽기에만 적용합니다.
          await tx.$executeRaw`SET LOCAL work_mem = '16MB'`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '20s'`;
          return tx.$queryRaw<RankedKey[]>(query);
        },
        { timeout: 30000 },
      );
    } catch (error: unknown) {
      const code =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : 'unknown';
      this.logger.warn(`search-order ${source} failed code=${code}`);
      throw error;
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed > 1000)
        this.logger.warn(`search-order ${source} elapsed_ms=${elapsed}`);
    }
  }

  private async read(query: SearchResultsDto, feed = false) {
    const now = Date.now();
    const search = itemSearch(query.q, query.place);
    const point = searchPoint(query.near);
    if (query.sort === 'distance' && !point)
      fail(400, 'VALIDATION_ERROR', '가까운순의 기준 장소를 선택해 주세요.');
    const scope = digest(
      JSON.stringify([
        2,
        search,
        query.period,
        query.from,
        query.to,
        query.sort,
        point,
        feed,
      ]),
    );
    const after = readSearchPosition(query.cursor, scope, now);
    const at = after?.at ?? now;
    const { from, through, fromTime, toTime } = searchRange(query, at);
    const rank =
      query.sort === 'relevance'
        ? relevanceSql(
            Prisma.sql`normalized_name`,
            Prisma.sql`normalized_features`,
            search,
            true,
          )
        : query.sort === 'distance' && point
          ? Prisma.sql`CASE WHEN lat IS NULL OR lng IS NULL THEN -2147483647 ELSE
            -round(6371000 * acos(least(1.0, greatest(-1.0,
              sin(radians(lat::float8)) * sin(radians(${point.lat}::float8)) +
              cos(radians(lat::float8)) * cos(radians(${point.lat}::float8)) *
              cos(radians(lng::float8 - ${point.lng}::float8))))))::int END`
          : Prisma.sql`0`;
    const normalize = (column: Prisma.Sql) =>
      query.sort === 'relevance' ? normalizedSql(column) : Prisma.sql`''`;
    // 각 출처에서 전체 후보를 먼저 정렬합니다. 출처별 상위 26건이면
    // 세 출처를 합친 상위 25건과 다음 페이지 유무를 정확하게 결정할 수 있습니다.
    const [memberKeys, portalKeys, school, memberTotal] = await Promise.all([
      // MATERIALIZED는 점수/정규화를 한 번만 계산하게 합니다. 다음 페이지 조건에서
      // 같은 식을 반복 실행하면 대량 자료의 정확도순 조회가 크게 느려집니다.
      this.ranked(Prisma.sql`
        WITH candidates AS MATERIALIZED (
          SELECT id::text AS id, to_char(${feed ? Prisma.sql`created_at` : Prisma.sql`found_at`} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day, lat, lng,
            ${normalize(Prisma.sql`name`)} AS normalized_name,
            ${normalize(Prisma.sql`public_features`)} AS normalized_features
          FROM found_items WHERE NOT archived AND status IN ('AVAILABLE', 'RESERVED')
            AND created_at <= ${new Date(at)} AND found_at BETWEEN ${fromTime} AND ${toTime}
            AND ${searchWhereSql(search, false)}
        ), ranked AS MATERIALIZED (SELECT id, day, ${rank} AS score FROM candidates)
        SELECT * FROM ranked WHERE ${afterSql(after)}
        ORDER BY score DESC, day DESC, id COLLATE "C" ASC LIMIT 26`),
      query.sort === 'recent'
        ? this.ranked(Prisma.sql`
        SELECT * FROM (
          SELECT id, day, 0 AS score FROM verified_portal_items
          WHERE stored AND day BETWEEN ${from} AND ${through} AND ${searchWhereSql(search, true)}
        ) AS ranked WHERE ${afterSql(after)}
        ORDER BY day DESC, id COLLATE "C" ASC LIMIT 26`)
        : portalRanked(
            this.db,
            search,
            from,
            through,
            query.sort,
            at,
            after,
            point,
          ),
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
    const schoolPoint =
      query.sort === 'distance'
        ? (
            await this.db.$queryRaw<{ lat: number; lng: number }[]>`
          SELECT lat,lng FROM institution_place_points WHERE storage='한성대학교 상상관 글로벌원스톱센터'
            AND lat IS NOT NULL AND located_at <= ${new Date(at)}`
          )[0]
        : undefined;
    const schoolKeys = schoolItems
      .map((i) => ({
        id: i.id,
        day: i.date,
        score:
          query.sort === 'relevance'
            ? relevanceScore(i.name, '', search)
            : query.sort === 'distance'
              ? schoolPoint && point
                ? -Math.round(distance(point, schoolPoint))
                : -2147483647
              : 0,
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
      items: page
        .map((i) => {
          const item = rows.get(i.id);
          if (!item) return;
          return query.sort === 'distance' && i.score !== -2147483647
            ? { ...item, distanceM: -i.score }
            : item;
        })
        .filter((i) => i !== undefined),
      nextCursor:
        keys.length > 25 && last
          ? searchCursor({
              ...last,
              scope,
              at,
              ...(school.unavailable && { withoutSchool: true as const }),
            })
          : null,
      memberTotal,
      notices: [
        ...(school.unavailable
          ? [
              '한성대 자료를 일시적으로 불러오지 못했어요. 다른 기관과 회원 물품을 먼저 표시합니다. 다시 검색하면 한성대 자료도 재확인해요.',
            ]
          : this.institutions.schoolSnapshotStale()
            ? ['학교 목록을 갱신 중이에요. 마지막 확인 자료를 표시해요.']
            : []),
        ...(query.sort === 'distance'
          ? [
              '회원 물품은 습득 위치, 기관 물품은 보관처 기준이에요. 위치를 확인하지 못한 물품은 뒤에 표시해요.',
            ]
          : []),
      ],
      sort: query.sort,
    };
  }
}
