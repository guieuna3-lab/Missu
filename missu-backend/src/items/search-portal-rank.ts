import { Prisma } from '../generated/prisma/client';
import type { DatabaseService } from '../database/database.service';
import type { ItemSearch } from './item-search';
import { distance } from './institution-records';
import {
  compareRank,
  relevanceScorer,
  searchWhereSql,
  type RankedKey,
} from './search-order';

type Candidate = {
  id: string;
  day: string;
  name: string;
  features: string;
  storage: string;
};
type Point = { lat: number; lng: number };
type RankedCache = { revision: string; until: number; keys: RankedKey[] };
const caches = new WeakMap<DatabaseService, Map<string, RankedCache>>();
const MAX_KEYS = 100000;
const MAX_TOTAL_KEYS = 120000;

async function revision(db: DatabaseService, from: string, through: string) {
  const [row] = await db.$queryRaw<{ value: string }[]>`
    SELECT md5(coalesce(string_agg(day || ':' || revision::text,',' ORDER BY day),'')) AS value
    FROM verified_search_day_versions WHERE day BETWEEN ${from} AND ${through} OR day='*'`;
  return row.value;
}
function page(keys: RankedKey[], after?: RankedKey) {
  let low = 0,
    high = keys.length;
  if (after)
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareRank(keys[mid], after) <= 0) low = mid + 1;
      else high = mid;
    }
  return keys.slice(low, low + 26);
}

/** 전체 후보를 작은 묶음으로 읽고, 변경이 없으면 다음 페이지에서 정렬 키를 재사용합니다. */
export async function portalRanked(
  db: DatabaseService,
  search: ItemSearch,
  from: string,
  through: string,
  sort: 'relevance' | 'distance',
  at: number,
  after?: RankedKey,
  point?: Point,
): Promise<RankedKey[]> {
  const relevance = relevanceScorer(search);
  const locations =
    sort === 'distance'
      ? await db.$queryRaw<(Point & { storage: string; located_at: Date })[]>`
    SELECT storage,lat,lng,located_at FROM institution_place_points
    WHERE located_at <= ${new Date(at)} AND lat IS NOT NULL AND lng IS NOT NULL`
      : [];
  const version = await revision(db, from, through);
  const geoVersion = locations.reduce(
    (latest, p) => Math.max(latest, new Date(p.located_at).getTime()),
    0,
  );
  const cacheKey = JSON.stringify([
    search,
    from,
    through,
    sort,
    point,
    geoVersion,
    locations.length,
  ]);
  let cache = caches.get(db);
  if (!cache) {
    cache = new Map();
    caches.set(db, cache);
  }
  for (const [key, value] of cache)
    if (value.until <= Date.now()) cache.delete(key);
  const saved = cache.get(cacheKey);
  if (saved?.revision === version) return page(saved.keys, after);
  cache.delete(cacheKey);
  const scores = new Map(
    locations.map((p) => [
      p.storage,
      -Math.round(distance(point!, { lat: p.lat!, lng: p.lng! })),
    ]),
  );
  let all: RankedKey[] | undefined = [];
  const result = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL jit = off`;
      await tx.$executeRaw`SET LOCAL work_mem = '16MB'`;
      await tx.$executeRaw`SET LOCAL cursor_tuple_fraction = 1.0`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '20s'`;
      // 정렬을 위해 DB가 큰 중간 표를 여러 번 만들지 않도록 좁은 공개 필드만 읽습니다.
      // 커서는 이 트랜잭션 안에서만 존재하며 취소·실패 시에도 자동으로 닫힙니다.
      await tx.$executeRaw(Prisma.sql`DECLARE missu_rank_rows NO SCROLL CURSOR FOR
      SELECT id,day,name,coalesce(kind_name,'') AS features,storage
      FROM verified_portal_items
      WHERE stored AND day BETWEEN ${from} AND ${through} AND ${searchWhereSql(search, true)}`);
      const best: RankedKey[] = [];
      for (;;) {
        const batch = await tx.$queryRaw<
          Candidate[]
        >`FETCH FORWARD 2000 FROM missu_rank_rows`;
        for (const row of batch) {
          const key = {
            id: row.id,
            day: row.day,
            score:
              sort === 'relevance'
                ? relevance(row.name, row.features)
                : (scores.get(row.storage) ?? -2147483647),
          };
          if (all) {
            if (all.length < MAX_KEYS) all.push(key);
            else all = undefined;
          }
          if (after && compareRank(key, after) <= 0) continue;
          if (best.length === 26 && compareRank(key, best[25]) >= 0) continue;
          best.push(key);
          best.sort(compareRank);
          if (best.length > 26) best.pop();
        }
        if (batch.length < 2000) break;
      }
      await tx.$executeRaw`CLOSE missu_rank_rows`;
      return best;
    },
    { timeout: 30000 },
  );
  // 읽는 중 이름이나 보관 상태가 바뀌었다면 이전 정렬을 저장하지 않습니다.
  // 저장량을 제한하고 사진·개인정보 없이 공개 관리번호·날짜·점수만 잠시 보관합니다.
  if (all && (await revision(db, from, through)) === version) {
    all.sort(compareRank);
    while (
      cache.size &&
      (cache.size >= 4 ||
        [...cache.values()].reduce((sum, c) => sum + c.keys.length, 0) +
          all.length >
          MAX_TOTAL_KEYS)
    ) {
      cache.delete(cache.keys().next().value!);
    }
    cache.set(cacheKey, {
      revision: version,
      until: Date.now() + 300000,
      keys: all,
    });
  }
  return result;
}
