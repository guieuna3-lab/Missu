import type { DatabaseService } from '../database/database.service';
import type { Prisma, AgencyCountSnapshot } from '../generated/prisma/client';
import {
  koreaDay,
  sinceFound,
  policePage,
  clean,
  governmentItem,
} from './institution-records';

export const feeds = ['포털기관', '경찰'] as const;
type Feed = (typeof feeds)[number];
type Tx = Prisma.TransactionClient;
type Read = (
  source: Feed,
  operation: string,
  params: Record<string, string>,
) => Promise<ReturnType<typeof policePage> & { observedAt: Date }>;
type Save = (
  row: Record<string, string>,
  source: Feed,
  at: Date,
  tx: Tx,
) => Promise<unknown>;
export class DailyPortalLimit extends Error {}
export const nextPortalDay = () =>
  Date.parse(koreaDay() + 'T00:00:00+09:00') + 86400000;
const prefix = (feed: Feed) => 'catalog/' + feed + '/';
const control = (feed: Feed) => 'catalog-pause/' + feed;
const budgetKey = (feed: Feed) => koreaDay() + '/' + feed;
const poolSize = 8;
// 운영계정 포털기관 상세 100만 회 중 20%는 실시간 요청용입니다. 경찰은 별도 계정 한도입니다.
const budgets: Record<Feed, number> = { 포털기관: 800000, 경찰: 8000 };

// 기간의 모든 날짜에서 상세 확인을 한 번 마쳐야 그 기간의 전체 건수를 표시합니다.
export async function catalogCoverage(
  db: DatabaseService,
  from: string,
  through: string,
) {
  const rows = await db.agencyCountSnapshot.findMany({
    where: {
      OR: feeds.map((feed) => ({
        query: {
          gte: prefix(feed) + sinceFound(),
          lte: prefix(feed) + through,
        },
      })),
    },
    select: { query: true, listTotal: true, completedAt: true },
  });
  const expectedDays =
    Math.round((Date.parse(through) - Date.parse(from)) / 86400000) + 1;
  const policeIncluded = rows.some(
    (row) =>
      row.query.startsWith(prefix('경찰')) &&
      (row.listTotal !== null || row.completedAt !== null),
  );
  const complete = feeds
    .filter((feed) => feed !== '경찰' || policeIncluded)
    .every(
      (feed) =>
        rows.filter(
          (row) =>
            row.query.startsWith(prefix(feed)) &&
            row.query.slice(-10) >= from &&
            row.completedAt !== null,
        ).length === expectedDays,
    );
  return { complete, policeIncluded };
}

export class CatalogSync {
  private prepared = '';
  private turn = 0;
  private running?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly db: DatabaseService,
    private readonly read: Read,
    private readonly save: Save,
  ) {}
  stop() {
    this.stopped = true;
  }
  run() {
    if (!this.running && !this.stopped)
      this.running = this.collect().finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async prepare(today: string) {
    if (this.prepared === today) return;
    const from = sinceFound();
    const dates: string[] = [];
    for (
      let ms = Date.parse(from + 'T00:00:00Z');
      ms <= Date.parse(today + 'T00:00:00Z');
      ms += 86400000
    )
      dates.push(new Date(ms).toISOString().slice(0, 10));
    await this.db.$transaction(async (tx) => {
      for (const feed of feeds) {
        await tx.agencyCountSnapshot.createMany({
          data: [
            { query: control(feed) },
            ...dates.map((day) => ({ query: prefix(feed) + day })),
          ],
          skipDuplicates: true,
        });
        // 날짜별 작업과 후보만 정리합니다. 기존 검색용 보관 기록은 이어서 사용합니다.
        await tx.agencyCountSnapshot.deleteMany({
          where: {
            query: { startsWith: prefix(feed), lt: prefix(feed) + from },
          },
        });
      }
      await tx.verifiedPortalItem.deleteMany({
        where: {
          OR: [
            { day: { gt: '', lt: from } },
            { day: '', checkedAt: { lt: new Date(from + 'T00:00:00+09:00') } },
          ],
        },
      });
    });
    this.prepared = today;
  }
  private async collect() {
    await this.prepare(koreaDay());
    // 한 차례가 끝나면 서버 타이머가 이어받습니다. 한 작업이 무한히 실행되지 않습니다.
    for (let batch = 0; batch < 80 && !this.stopped; batch++) {
      if (this.prepared !== koreaDay()) return;
      let progress = false;
      for (const feed of feeds) {
        if (this.stopped) return;
        if (await this.step(feed, this.turn)) progress = true;
      }
      this.turn++;
      if (!progress) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  async status() {
    const day = koreaDay();
    return Promise.all(
      feeds.map(async (source) => {
        const [gate, budget, latest, finished, stored] = await Promise.all([
          this.db.agencyCountSnapshot.findUnique({
            where: { query: control(source) },
            select: { retryAt: true },
          }),
          this.db.agencyCountBudget.findUnique({
            where: { day: budgetKey(source) },
            select: { calls: true },
          }),
          this.db.agencyCountSnapshot.findFirst({
            where: {
              query: { startsWith: prefix(source) },
              completedAt: { not: null },
            },
            orderBy: { completedAt: 'desc' },
            select: { completedAt: true },
          }),
          this.db.agencyCountSnapshot.count({
            where: {
              query: { startsWith: prefix(source) },
              completedAt: { not: null },
            },
          }),
          this.db.verifiedPortalItem.count({
            where: {
              stored: true,
              source: source === '경찰' ? '경찰' : { not: '경찰' },
              day: { gte: sinceFound(), lte: day },
            },
          }),
        ]);
        return {
          source,
          day,
          stored,
          detailAttempts: budget?.calls ?? 0,
          completedDays: finished,
          lastCompletedAt: latest?.completedAt ?? null,
          nextAttemptAt:
            gate && +gate.retryAt > Date.now() ? gate.retryAt : null,
        };
      }),
    );
  }
  private async step(feed: Feed, turn: number) {
    return this.db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtext(${control(feed)})::bigint) AS locked`;
        if (!lock.locked) return false;
        const now = new Date(Date.now());
        const gate = await tx.agencyCountSnapshot.findUniqueOrThrow({
          where: { query: control(feed) },
        });
        if (gate.retryAt > now) return false;
        const due = {
          query: { startsWith: prefix(feed) },
          retryAt: { lte: now },
        };
        // 최신 접수, 누적된 과거 날짜, 이미 본 날짜의 반환 재확인을 번갈아 처리합니다.
        const first =
          turn % 4 === 0
            ? { ...due, query: prefix(feed) + koreaDay() }
            : turn % 4 === 1
              ? { ...due, completedAt: { not: null } }
              : { ...due, completedAt: null };
        const orderBy = [
          { retryAt: 'asc' as const },
          { query: 'desc' as const },
        ];
        const job =
          (await tx.agencyCountSnapshot.findFirst({ where: first, orderBy })) ??
          (await tx.agencyCountSnapshot.findFirst({ where: due, orderBy }));
        if (!job) return false;
        const pauseFeed = async (until: number) => {
          await tx.agencyCountSnapshot.update({
            where: { query: control(feed) },
            data: { retryAt: new Date(until) },
          });
          return false;
        };
        if (!job.listed) {
          try {
            await this.listDay(tx, feed, job);
          } catch (error) {
            return pauseFeed(
              error instanceof DailyPortalLimit
                ? nextPortalDay()
                : Date.now() + 15 * 60000,
            );
          }
          return true;
        }
        const scope = { query: job.query, generation: job.generation };
        const pending = await tx.agencyCountCandidate.findMany({
          where: {
            ...scope,
            stored: null,
            OR: [{ retryAfter: null }, { retryAfter: { lte: now } }],
          },
          orderBy: [{ atcId: 'asc' }, { fdSn: 'asc' }],
          take: poolSize,
          select: { atcId: true, fdSn: true },
        });
        if (!pending.length) {
          const delayed = await tx.agencyCountCandidate.findFirst({
            where: { ...scope, stored: null },
            orderBy: { retryAfter: 'asc' },
          });
          if (delayed) {
            await tx.agencyCountSnapshot.update({
              where: { query: job.query },
              data: {
                retryAt: delayed.retryAfter ?? new Date(+now + 60000),
                listed: false,
                page: 1,
                listTotal: null,
              },
            });
          } else {
            await tx.agencyCountCandidate.deleteMany({ where: scope });
            const recent =
              job.query.slice(-10) >= koreaDay(Date.now() - 86400000);
            await tx.agencyCountSnapshot.update({
              where: { query: job.query },
              data: {
                generation: { increment: 1 },
                page: 1,
                listTotal: null,
                listed: false,
                completedAt: now,
                retryAt: new Date(+now + (recent ? 6 : 72) * 3600000),
              },
            });
          }
          return true;
        }
        const day = budgetKey(feed);
        const budget = await tx.agencyCountBudget.upsert({
          where: { day },
          create: { day, calls: 0 },
          update: {},
        });
        const batch = pending.slice(
          0,
          Math.max(0, budgets[feed] - budget.calls),
        );
        if (!batch.length) return pauseFeed(nextPortalDay());
        await tx.agencyCountBudget.update({
          where: { day },
          data: { calls: { increment: batch.length } },
        });
        const checks = await Promise.allSettled(
          batch.map(async (id) => {
            const response = await this.read(feed, 'DetailInfo', {
              ATC_ID: id.atcId,
              FD_SN: id.fdSn,
            });
            const row = response.records.find(
              (r) => r.atcId === id.atcId && r.fdSn === id.fdSn,
            );
            if (!row?.csteSteNm?.trim()) throw Error('Missing custody status');
            if (clean(row.csteSteNm) === '보관중' && !governmentItem(row, feed))
              throw Error('Incomplete custody details');
            return { id, row, at: response.observedAt };
          }),
        );
        let quota = false;
        for (const [i, check] of checks.entries()) {
          const id = batch[i];
          if (check.status === 'fulfilled') {
            const { row, at } = check.value;
            const saved = await this.save(row, feed, at, tx);
            await tx.agencyCountCandidate.update({
              where: { query_generation_atcId_fdSn: { ...scope, ...id } },
              data: { stored: !!saved, retryAfter: null },
            });
          } else if (check.reason instanceof DailyPortalLimit) {
            quota = true;
          } else {
            await tx.agencyCountCandidate.update({
              where: { query_generation_atcId_fdSn: { ...scope, ...id } },
              data: { retryAfter: new Date(+now + 3600000) },
            });
          }
        }
        if (quota) return pauseFeed(nextPortalDay());
        if (checks.every((c) => c.status === 'rejected'))
          return pauseFeed(+now + 60000);
        return true;
      },
      { timeout: 45000 },
    );
  }
  private async listDay(tx: Tx, feed: Feed, job: AgencyCountSnapshot) {
    const day = job.query.slice(-10);
    const compact = day.replaceAll('-', '');
    const result = await this.read(feed, 'InfoAccToClAreaPd', {
      START_YMD: compact,
      END_YMD: compact,
      numOfRows: '500',
      pageNo: String(job.page),
    });
    if (
      result.total === null ||
      result.page !== job.page ||
      (result.total > 0 &&
        (result.size < 1 ||
          result.records.length !==
            Math.max(
              0,
              Math.min(
                result.size,
                result.total - (job.page - 1) * result.size,
              ),
            )))
    )
      throw Error('Incomplete date page');
    const scope = { query: job.query, generation: job.generation };
    const ids = result.records.map((r) => {
      if (!r.atcId || !r.fdSn || r.fdYmd?.replaceAll('-', '') !== compact)
        throw Error('Invalid date record');
      return { ...scope, atcId: r.atcId, fdSn: r.fdSn };
    });
    if (job.page === 1) {
      // 목록에서 빠진 기존 보관품도 상세에서 반환 여부를 확인합니다.
      const previous = await tx.verifiedPortalItem.findMany({
        where: {
          day,
          stored: true,
          source: feed === '경찰' ? '경찰' : { not: '경찰' },
        },
        select: { id: true },
      });
      for (const row of previous) {
        const [, atcId, fdSn] = row.id.split(':');
        if (atcId && fdSn) ids.push({ ...scope, atcId, fdSn });
      }
    }
    if (ids.length)
      await tx.agencyCountCandidate.createMany({
        data: ids,
        skipDuplicates: true,
      });
    const moved = job.page > 1 && job.listTotal !== result.total;
    await tx.agencyCountSnapshot.update({
      where: { query: job.query },
      data: {
        listTotal: result.total,
        page: moved ? 1 : job.page + 1,
        listed: !moved && !result.limited,
      },
    });
  }
}
