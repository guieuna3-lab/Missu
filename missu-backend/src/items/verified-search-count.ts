import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import type { DatabaseService } from '../database/database.service';

type Summary = { epoch: string; days: Record<string, [string, number]> };
type State = { revisions: Record<string, string>; summary: Summary | null };

// 재시작 후에도 같은 날짜의 정확한 집계를 재사용한다. 해시가 같은 칸을 쓰는
// 서로 다른 검색은 전체 키까지 비교하므로, 충돌하면 다시 계산할 뿐이다.
export async function countVerifiedDays(
  db: DatabaseService,
  period: string,
  from: string,
  through: string,
  filters: Prisma.VerifiedPortalItemWhereInput,
): Promise<number> {
  const key = createHash('sha256')
    .update(JSON.stringify([1, period, { ...filters, day: undefined }]))
    .digest('hex');
  const slot = parseInt(key.slice(0, 4), 16) % 1024;
  const result = await db.$transaction(
    async (tx) => {
      // 버전과 집계가 같은 시점의 자료를 읽어야 중간에 반환된 물품이 고정되지 않는다.
      const [state] = await tx.$queryRaw<State[]>`
      SELECT (SELECT COALESCE(jsonb_object_agg(day, revision::text), '{}'::jsonb)
              FROM verified_search_day_versions WHERE day BETWEEN ${from} AND ${through} OR day = '*') AS revisions,
             (SELECT summary FROM verified_search_count_cache WHERE slot = ${slot} AND query_key = ${key}) AS summary`;
      const epoch = state.revisions['*'] ?? '0';
      const known = state.summary?.epoch === epoch ? state.summary.days : {};
      const days: Summary['days'] = {};
      const dirty: string[] = [];
      for (let t = Date.parse(from); t <= Date.parse(through); t += 86400000) {
        const day = new Date(t).toISOString().slice(0, 10);
        const version = state.revisions[day] ?? '0';
        if (known[day]?.[0] === version) days[day] = known[day];
        else {
          dirty.push(day);
          days[day] = [version, 0];
        }
      }
      if (dirty.length) {
        const day =
          dirty.length === Object.keys(days).length
            ? { gte: from, lte: through }
            : { in: dirty };
        const groups = await tx.verifiedPortalItem.groupBy({
          by: ['day'],
          where: { ...filters, day },
          _count: { _all: true },
        });
        for (const row of groups) days[row.day][1] = row._count._all;
      }
      return {
        total: Object.values(days).reduce((sum, entry) => sum + entry[1], 0),
        update: dirty.length ? JSON.stringify({ epoch, days }) : undefined,
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 90000, maxWait: 10000 },
  );
  // 늦게 끝난 계산도 해당 시점의 버전을 함께 저장하므로 다음 조회에서 검증된다.
  if (result.update)
    await db.$executeRaw`
    INSERT INTO verified_search_count_cache (slot, query_key, summary)
    VALUES (${slot}, ${key}, ${result.update}::jsonb)
    ON CONFLICT (slot) DO UPDATE SET query_key=EXCLUDED.query_key, summary=EXCLUDED.summary`;
  return result.total;
}
