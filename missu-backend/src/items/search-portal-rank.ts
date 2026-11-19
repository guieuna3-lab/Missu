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

/** 전체 후보를 빠짐없이 읽되, 메모리에는 한 묶음과 상위 26건만 유지합니다. */
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
      ? await db.$queryRaw<(Point & { storage: string })[]>`
    SELECT storage,lat,lng FROM institution_place_points
    WHERE located_at <= ${new Date(at)} AND lat IS NOT NULL AND lng IS NOT NULL`
      : [];
  const scores = new Map(
    locations.map((p) => [
      p.storage,
      -Math.round(distance(point!, { lat: p.lat!, lng: p.lng! })),
    ]),
  );
  return db.$transaction(
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
}
