import { DatabaseService } from '../src/database/database.service';
import { ExternalHttpService } from '../src/integrations/external-http.service';
import { InstitutionItemsService } from '../src/items/institution-items.service';
import {
  CatalogSync,
  DailyPortalLimit,
  nextPortalDay,
} from '../src/items/catalog-sync';
import { koreaDay } from '../src/items/institution-records';
import { harness } from './mvp-support';
import { randomUUID, createHash } from 'node:crypto';
import { itemSearch, likeLiteral } from '../src/items/item-search';

describe('기관 전 품목 자동 수집', () => {
  it('검색 없이 여러 종류를 저장하고 한도 소진 후 다음 한국 날짜에 남은 후보부터 재개한다', async () => {
    if (
      process.env.MISSU_TEST_DATABASE !== '1' ||
      new URL(process.env.DATABASE_URL!).pathname !== '/missu_test'
    )
      throw Error('전용 시험 DB 필요');
    const db = new DatabaseService();
    const service = new InstitutionItemsService({} as ExternalHttpService, db);
    const realNow = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(realNow + 5000);
    const day = koreaDay(),
      ids = ['VQC001', 'VQC002', 'VQC003'];
    const fixtures = ids.map((atcId, i) => ({
      atcId,
      fdSn: '1',
      fdYmd: day,
      fdPrdtNm: ['검정 기기', '지갑', '우산'][i],
      prdtClNm: ['휴대폰', '지갑', '우산'][i],
      depPlace: '시청역(2호선)',
      fdPlace: '강남역',
      csteSteNm: '보관중',
    }));
    const pausedUntil = nextPortalDay();
    let block = true;
    const read: ConstructorParameters<typeof CatalogSync>[1] = async (
      feed,
      operation,
      params,
    ) => {
      if (feed === '경찰') throw Error('승인 대기');
      const page = (records: Record<string, string>[]) => ({
        records,
        total: records.length,
        page: 1,
        size: 500,
        limited: false,
        observedAt: new Date(Date.now()),
      });
      if (operation === 'DetailInfo') {
        if (block && params.ATC_ID === ids[1]) throw new DailyPortalLimit();
        return page(fixtures.filter((row) => row.atcId === params.ATC_ID));
      }
      expect(params.PRDT_NM).toBeUndefined();
      expect(params.PRDT_CL_CD_01).toBeUndefined();
      return page(params.START_YMD === day.replaceAll('-', '') ? fixtures : []);
    };
    const save: ConstructorParameters<typeof CatalogSync>[2] = (
      row,
      feed,
      at,
      tx,
    ) => service['verifiedItem'](row, feed, at, tx);
    const sync = new CatalogSync(db, read, save);
    try {
      await sync.run();
      const status = (await sync.status())[0];
      expect(status.nextAttemptAt?.getTime()).toBe(pausedUntil);
      expect(status.detailAttempts).toBe(3);
      const where = {
        id: { in: ids.map((id) => 'lost112:' + id + ':1') },
        stored: true,
      };
      expect(await db.verifiedPortalItem.count({ where })).toBe(2);
      expect(
        await db.verifiedPortalItem.count({
          where: service['portalWhere']('핸드폰', '강남역', 'all'),
        }),
      ).toBe(1);
      const restarted = new CatalogSync(db, read, save);
      await restarted.run();
      expect((await restarted.status())[0].detailAttempts).toBe(3);
      block = false;
      now.mockReturnValue(pausedUntil + 2000);
      // 다음 날짜의 초기 작업이 같은 시험에서 끝없이 돌지 않게, 재개 대상의 기한만 앞당깁니다.
      await db.agencyCountSnapshot.updateMany({
        where: {
          query: { startsWith: 'catalog/포털기관/' },
          NOT: { query: 'catalog/포털기관/' + day },
        },
        data: { retryAt: new Date(pausedUntil + 86400000) },
      });
      await restarted.run();
      expect(await db.verifiedPortalItem.count({ where })).toBe(3);
      fixtures[0].csteSteNm = '반환완료';
      await db.agencyCountSnapshot.update({
        where: { query: 'catalog/포털기관/' + day },
        data: { retryAt: new Date(0) },
      });
      now.mockReturnValue(pausedUntil + 3000);
      await restarted.run();
      expect(await db.verifiedPortalItem.count({ where })).toBe(2);
      expect(
        await db.verifiedPortalItem.count({
          where: service['portalWhere']('핸드폰', '', 'all'),
        }),
      ).toBe(0);
    } finally {
      now.mockRestore();
      await db.$disconnect();
    }
  }, 60000);
});

describe('확인된 습득물 합계', () => {
  it('색인 검색의 물품 ID가 기존 부분 일치·별칭 검색과 같다', async () => {
    const h = await harness();
    const api = new InstitutionItemsService({} as ExternalHttpService, h.db);
    const prefix = randomUUID();
    const fixtures = [
      ['분홍 카드지갑', '기타'],
      ['검정 WALLET', ''],
      ['머니클립', ''],
      ['에도', '카드 홀더'],
      ['삼성휴대폰', '아이폰'],
      ['AIRPODS PRO', ''],
      ['에어팟 케이스', ''],
      ['미니폰', '휴대전화'],
      ['USB', ''],
      ['100%_기기', ''],
      ['wall 달력', ''],
      ['지', '갑'],
      ['빨간 월렛', ''],
    ];
    try {
      await h.db.verifiedPortalItem.createMany({
        data: fixtures.map(([name, kindName], i) => ({
          id: prefix + i,
          name,
          kindName,
          stored: i !== fixtures.length - 1,
          source: '포털기관',
          storage: '강남역',
          placeKey: '강남역',
          day: koreaDay(),
          category: 'OTHER',
          checkedAt: new Date(),
        })),
      });
      for (const q of [
        '지갑',
        '월렛',
        '핸드폰',
        '이어폰',
        '아이폰',
        'USB',
        '100%_',
        'wall',
        '지',
        '검정 지갑',
      ]) {
        const indexed = api['portalWhere'](q, '강남역', '7');
        const { terms, brand } = itemSearch(q);
        const unchangedBrand = brand
          ? (indexed.AND as object[]).slice(0, 1)
          : [];
        const original = {
          ...indexed,
          AND: [
            ...unchangedBrand,
            ...terms.map((group) => ({
              OR: group.flatMap((word) => {
                const match = {
                  contains: likeLiteral(word),
                  mode: 'insensitive' as const,
                };
                return [{ name: match }, { kindName: match }];
              }),
            })),
          ],
        };
        const ids = (where: typeof indexed) =>
          h.db.verifiedPortalItem.findMany({
            where: { ...where, id: { startsWith: prefix } },
            select: { id: true },
            orderBy: { id: 'asc' },
          });
        expect(await ids(indexed)).toEqual(await ids(original));
      }
    } finally {
      await h.db.verifiedPortalItem.deleteMany({
        where: { id: { startsWith: prefix } },
      });
      await h.close();
    }
  });
  it('자정을 넘겨도 직전 회원·기관 합계와 0건을 보존하고 오늘치 확인 후 다음 요청에서 갱신한다', async () => {
    const h = await harness();
    const keeper = await h.user('published');
    const day = '2040-03-20';
    const end = Date.parse(day + 'T23:59:55+09:00');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(end);
    const q = '이어폰' + randomUUID().slice(0, 8),
      zero = q + 'x';
    const snapshots = Array.from(
      { length: 8 },
      (_, i) => 'catalog/포털기관/' + koreaDay(end + (i - 6) * 86400000),
    );
    const storedKeys = [q, zero].map((word) =>
      createHash('sha256')
        .update(JSON.stringify(['7', word, '']))
        .digest('hex'),
    );
    const instance = () =>
      new InstitutionItemsService({} as ExternalHttpService, h.db);
    try {
      await h.db.agencyCountSnapshot.createMany({
        data: snapshots
          .slice(0, 7)
          .map((query) => ({ query, completedAt: new Date(end) })),
      });
      await h.item(keeper, { name: q });
      const before = instance();
      jest
        .spyOn(
          before as unknown as {
            schoolInventory(word: string): Promise<Map<string, unknown>>;
          },
          'schoolInventory',
        )
        .mockImplementation(
          async (word) =>
            new Map(word === q ? [['school', { storage: '한성대' }]] : []),
        );
      const first = await before.searchTotal(q, '', '7');
      expect(first).toMatchObject({
        status: 'complete',
        total: 1,
        lastComplete: { total: 2, checkedAt: new Date(end) },
      });
      expect(
        (await before.searchTotal(zero, '', '7')).lastComplete?.total,
      ).toBe(0);
      clock.mockReturnValue(end + 10000);
      await h.item(keeper, { name: q });
      const after = instance();
      const school = jest
        .spyOn(
          after as unknown as {
            schoolInventory(): Promise<Map<string, unknown>>;
          },
          'schoolInventory',
        )
        .mockResolvedValue(new Map([['school', { storage: '한성대' }]]));
      const during = await after.searchTotal(q, '', '7');
      expect(during).toMatchObject({
        status: 'counting',
        total: null,
        lastComplete: first.lastComplete,
      });
      expect((await after.searchTotal(zero, '', '7')).lastComplete?.total).toBe(
        0,
      );
      expect(school).toHaveBeenCalled();
      expect(during.confirmedTotal).toBe(1);
      for (const [word, place, period] of [
        [q, '서울역', '7'],
        [q, '', '30'],
        [q + 'a', '', '7'],
      ]) {
        expect(
          (await after.searchTotal(word, place, period)).lastComplete,
        ).toBeUndefined();
      }
      await h.db.agencyCountSnapshot.create({
        data: { query: snapshots[7], completedAt: new Date(Date.now()) },
      });
      const next = await after.searchTotal(q, '', '7');
      expect(next).toMatchObject({
        status: 'complete',
        lastComplete: { total: 3, checkedAt: new Date(Date.now()) },
      });
      expect(during.lastComplete?.total).toBe(2);
      // 늦게 도착한 과거 요청이 이미 저장한 최신 합계를 되돌리지 않습니다.
      clock.mockReturnValue(end);
      expect((await before.searchTotal(q, '', '7')).lastComplete).toEqual(
        next.lastComplete,
      );
    } finally {
      clock.mockRestore();
      await h.db.lastSearchCount.deleteMany({
        where: { queryKey: { in: storedKeys } },
      });
      await h.db.agencyCountSnapshot.deleteMany({
        where: { query: { in: snapshots } },
      });
      await h.close();
    }
  }, 30000);
});
