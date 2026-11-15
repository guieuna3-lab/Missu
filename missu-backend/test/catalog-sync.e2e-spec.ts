import { DatabaseService } from '../src/database/database.service';
import { ExternalHttpService } from '../src/integrations/external-http.service';
import { InstitutionItemsService } from '../src/items/institution-items.service';
import {
  CatalogSync,
  DailyPortalLimit,
  nextPortalDay,
} from '../src/items/catalog-sync';
import { koreaDay } from '../src/items/institution-records';

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
