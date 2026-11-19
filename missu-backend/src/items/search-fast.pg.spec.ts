import { DatabaseService } from '../database/database.service';
import { itemSearch } from './item-search';
import { exactPortalPage } from './search-portal-rank';
import { SavedNearby } from './nearby-saved';
import { NearbyDto } from './nearby.dto';
import { koreaDay, type InstitutionItem } from './institution-records';
import { InstitutionItemsService } from './institution-items.service';
import { ExternalHttpService } from '../integrations/external-http.service';

const url = process.env.SEARCH_ORDER_TEST_DATABASE_URL;
(url ? describe : describe.skip)('첫 검색 색인과 저장된 주변 목록', () => {
  let db: DatabaseService;
  const today = koreaDay(),
    yesterday = koreaDay(Date.now() - 86400000);
  beforeAll(async () => {
    const p = new URL(url!);
    if (
      p.hostname !== '127.0.0.1' ||
      p.port !== '55439' ||
      p.pathname !== '/sort_test'
    )
      throw Error('isolated DB only');
    process.env.DATABASE_URL = url;
    process.env.PII_KEY = '1'.repeat(64);
    process.env.SIGNING_KEY = '2'.repeat(64);
    db = new DatabaseService();
    await db.$connect();
    await db.verifiedPortalItem.deleteMany({
      where: { id: { startsWith: 'lost112:FASTQA' } },
    });
    await db.$executeRaw`INSERT INTO institution_place_points(storage,lat,lng,located_at,retry_at)
      VALUES ('FASTQA센터',37.5824,127.0102,now()-interval '1 day',now()),('FASTQA먼센터',35.1,129.0,now(),now())
      ON CONFLICT(storage) DO UPDATE SET lat=EXCLUDED.lat,lng=EXCLUDED.lng`;
    await db.verifiedPortalItem.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({
        id: 'lost112:FASTQA' + String(i).padStart(3, '0') + ':1',
        name: i < 30 ? '이어폰' : i < 45 ? '에어팟' : '무선 이어폰',
        source: '포털기관',
        storage: i === 64 ? 'FASTQA먼센터' : 'FASTQA센터',
        placeKey: 'fastqa센터',
        day: i % 2 ? today : yesterday,
        category: 'ELECTRONICS',
        stored: i !== 63,
        checkedAt: new Date(),
        kindName: '이어폰',
        foundPlace: 'FASTQA역',
      })),
    });
  });
  afterAll(async () => {
    await db?.verifiedPortalItem.deleteMany({
      where: { id: { startsWith: 'lost112:FASTQA' } },
    });
    await db.$executeRaw`DELETE FROM institution_place_points WHERE storage IN ('FASTQA센터','FASTQA먼센터')`;
    await db?.$disconnect();
  });
  it('최고 점수 26건을 전체 점수와 같은 순서로 읽고 커서 뒤를 빠짐없이 잇는다', async () => {
    const search = itemSearch('이어폰', 'FASTQA역');
    const first = await exactPortalPage(db, search, yesterday, today);
    expect(first).toHaveLength(26);
    expect(first.every((k) => k.score === 1000)).toBe(true);
    const second = await exactPortalPage(
      db,
      search,
      yesterday,
      today,
      first[24],
    );
    expect(second).toHaveLength(20);
    expect(second[0]).toEqual(first[25]);
    expect(
      new Set([...first.slice(0, 25), ...second].map((k) => k.id)).size,
    ).toBe(45);
    expect(second.filter((k) => k.score === 960)).toHaveLength(15);
    expect(
      await exactPortalPage(
        db,
        itemSearch('이어폰', '없는시험장소'),
        yesterday,
        today,
      ),
    ).toEqual([]);
  });
  it('학교 40건과 기관 63건을 같은 반경에서 세고 더보기로 모두 읽는다', async () => {
    const school: InstitutionItem[] = Array.from({ length: 40 }, (_, i) => ({
      id: 'hansung:' + String(990000 + i),
      name: 'FASTQA 이어폰',
      category: 'ELECTRONICS',
      source: '한성대',
      date: today,
      dateLabel: '습득일',
      storage: '한성대학교 상상관 글로벌원스톱센터',
      reference: String(i),
      url: 'https://www.hansung.ac.kr/',
    }));
    const institutions = new InstitutionItemsService(
      new ExternalHttpService(),
      db,
    );
    const reader = new SavedNearby(
      db,
      async () => school,
      (row) => institutions.savedItem(row),
    );
    const q = Object.assign(new NearbyDto(), {
      lat: 37.5824,
      lng: 127.0102,
      q: '이어폰',
      radiusM: 500,
      category: 'ALL',
      registeredDays: 'ALL',
    });
    const total = await reader.total(q);
    const items: string[] = [];
    let cursor: string | null = 'verified';
    let calls = 0;
    do {
      const page = await reader.page({ ...q, cursor: cursor ?? undefined });
      expect(page.refreshing).toBe(false);
      items.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      if (++calls > 30) throw Error('cursor loop');
    } while (cursor);
    // 이전 정렬 시험의 보관처가 반경에 있더라도 전체 건수와 목록은 같아야 합니다.
    expect(items.length).toBe(total.total);
    expect(new Set(items).size).toBe(items.length);
    expect(items.filter((id) => id.startsWith('lost112:FASTQA'))).toHaveLength(
      63,
    );
    expect(items.filter((id) => id.startsWith('hansung:99'))).toHaveLength(40);
    expect(items).not.toContain('lost112:FASTQA063:1');
    expect(items).not.toContain('lost112:FASTQA064:1');
    const first = await reader.page(q);
    await expect(
      reader.page({ ...q, lat: 35.1, cursor: first.nextCursor! }),
    ).rejects.toThrow();
  });
  it('학교와 먼 새 장소는 학교 원본 조회 없이 0건을 확정한다', async () => {
    const school = jest.fn().mockRejectedValue(Error('network must not run'));
    const institutions = new InstitutionItemsService(
      new ExternalHttpService(),
      db,
    );
    const reader = new SavedNearby(db, school, (row) =>
      institutions.savedItem(row),
    );
    const q = Object.assign(new NearbyDto(), { lat: 1, lng: 1 });
    expect((await reader.total(q)).total).toBe(0);
    expect((await reader.page(q)).nextCursor).toBeNull();
    expect(school).not.toHaveBeenCalled();
  });
});
