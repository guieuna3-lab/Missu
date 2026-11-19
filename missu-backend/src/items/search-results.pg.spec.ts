import { DatabaseService } from '../database/database.service';
import { ItemsService } from './items.service';
import { InstitutionItemsService } from './institution-items.service';
import { SearchResultsService } from './search-results.service';
import { SearchResultsDto } from './search-results.controller';
import { koreaDay } from './institution-records';
import type { UploadsService } from '../uploads/uploads.service';
import type { IdempotencyService } from '../common/idempotency.service';
import { ExternalHttpService } from '../integrations/external-http.service';

// 명시적으로 만든 로컬 시험 DB에서만 실행합니다. 운영 DB에는 연결하지 않습니다.
const url = process.env.SEARCH_ORDER_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('PostgreSQL 전체 정렬과 페이지 연결', () => {
  let db: DatabaseService;
  let service: SearchResultsService;
  const owner = '00000000-0000-4000-8000-000000000001';
  const day = (ago: number) => koreaDay(Date.now() - ago * 86400000);
  const query = (sort: 'recent' | 'relevance', cursor?: string, q = '이어폰') =>
    Object.assign(new SearchResultsDto(), { q, sort, cursor });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '55439' ||
      parsed.pathname !== '/sort_test'
    )
      throw Error('Only isolated sort_test DB allowed');
    process.env.DATABASE_URL = url;
    process.env.PII_KEY = '1'.repeat(64);
    process.env.SIGNING_KEY = '2'.repeat(64);
    db = new DatabaseService();
    await db.$connect();
    await db.user.upsert({
      where: { id: owner },
      create: {
        id: owner,
        email: 'sort-test@example.test',
        nickname: '시험계정',
        passwordHash: 'test-only',
        emailVerifiedAt: new Date(),
      },
      update: {},
    });
    await db.foundItem.deleteMany({ where: { keeperId: owner } });
    await db.verifiedPortalItem.deleteMany({
      where: { id: { startsWith: 'lost112:QA' } },
    });
    for (let i = 0; i < 40; i++) {
      await db.foundItem.create({
        data: {
          id: '00000000-0000-4000-8000-' + String(i + 100).padStart(12, '0'),
          keeperId: owner,
          name: '무선 이어폰 ' + i,
          publicFeatures: '검정',
          foundAt: new Date(day(i % 9) + 'T10:00:00+09:00'),
          foundLabel: '강남역',
          storagePlace: '다른 보관센터',
          lat: 37.5,
          lng: 127,
          // 등록 시각의 순서는 습득일과 반대입니다.
          createdAt: new Date(Date.now() - (40 - i) * 1000),
        },
      });
    }
    await db.$executeRaw`
      INSERT INTO verified_portal_items(id,name,source,storage,place_key,day,category,stored,checked_at,kind_name,found_place)
      SELECT 'lost112:QA' || lpad(i::text,4,'0') || ':1','무선 이어폰','포털기관','반환센터','반환센터',
        ${day(0)}::date - (i % 9), 'ELECTRONICS',true,now(),'이어폰','강남역'
      FROM generate_series(1,240) AS s(i)`;
    await db.verifiedPortalItem.createMany({
      data: [
        {
          id: 'lost112:QAEXACT:1',
          name: '이어폰',
          day: day(100),
          stored: true,
        },
        {
          id: 'lost112:QAALIAS:1',
          name: '에어팟',
          day: day(100),
          stored: true,
        },
        {
          id: 'lost112:QARETURNED:1',
          name: '이어폰',
          day: day(0),
          stored: false,
        },
        { id: 'lost112:QAOLD:1', name: '이어폰', day: day(250), stored: true },
        {
          id: 'lost112:QACASE:1',
          name: '이어폰 케이스',
          day: day(0),
          stored: true,
        },
        { id: 'lost112:QAPHONE:1', name: '아이폰', day: day(0), stored: true },
      ].map((i) => ({
        ...i,
        source: '포털기관',
        storage: '반환센터',
        placeKey: '반환센터',
        category: 'ELECTRONICS',
        checkedAt: new Date(),
        foundPlace: '강남역',
        kindName: i.name,
      })),
    });
    const institution = new InstitutionItemsService(
      new ExternalHttpService(),
      db,
    );
    jest.spyOn(institution, 'schoolForMatching').mockResolvedValue([
      {
        id: 'hansung:99991',
        name: '이어폰',
        date: day(20),
        dateLabel: '습득일',
        source: '한성대',
        storage: '한성대',
        category: 'ELECTRONICS',
        reference: '99991',
        url: 'https://www.hansung.ac.kr/',
      },
      {
        id: 'hansung:99992',
        name: '이어폰',
        date: day(30),
        dateLabel: '게시일',
        source: '한성대',
        storage: '한성대',
        category: 'ELECTRONICS',
        reference: '99992',
        url: 'https://www.hansung.ac.kr/',
      },
    ]);
    const members = new ItemsService(
      db,
      { url: (id: string) => '/photos/' + id } as UploadsService,
      {} as IdempotencyService,
    );
    service = new SearchResultsService(db, members, institution);
  }, 120000);
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('최근 100건 밖의 완전 일치와 동의어도 첫 페이지에 포함한다', async () => {
    const result = await service.search(query('relevance'));
    expect(result.items).toHaveLength(25);
    expect(result.items.slice(0, 4).map((i) => i.id)).toEqual([
      'hansung:99991',
      'hansung:99992',
      'lost112:QAEXACT:1',
      'lost112:QAALIAS:1',
    ]);
    expect(result.memberTotal).toBe(40);
  });
  it.each(['recent', 'relevance'] as const)(
    '%s에서 끝까지 25건씩 연결되고 누락·중복이 없다',
    async (sort) => {
      let cursor: string | undefined;
      const items: Awaited<
        ReturnType<SearchResultsService['search']>
      >['items'] = [];
      do {
        const result = await service.search(query(sort, cursor));
        if (result.nextCursor) expect(result.items).toHaveLength(25);
        items.push(...result.items);
        cursor = result.nextCursor ?? undefined;
      } while (cursor);
      expect(items).toHaveLength(284);
      expect(new Set(items.map((i) => i.id)).size).toBe(284);
      expect(items.some((i) => /QARETURNED|QAOLD|QACASE/.test(i.id))).toBe(
        false,
      );
      if (sort === 'recent') {
        const dates = items.map((i) =>
          'source' in i ? i.date : koreaDay(i.foundAt.getTime()),
        );
        expect(dates).toEqual([...dates].sort().reverse());
      }
    },
    60000,
  );
  it('습득 장소와 옮겨진 보관처 양쪽에서 검색되고 기간도 페이지 전에 적용한다', async () => {
    const byFound = await service.search(
      Object.assign(query('relevance'), { place: '강남역' }),
    );
    const byStored = await service.search(
      Object.assign(query('relevance'), { place: '반환센터' }),
    );
    expect(byFound.items[0].id).toBe('lost112:QAEXACT:1');
    expect(byStored.items[0].id).toBe('lost112:QAEXACT:1');
    const range = await service.search(
      Object.assign(query('relevance'), { from: day(8), to: day(8) }),
    );
    expect(
      range.items.every(
        (i) =>
          ('source' in i ? i.date : koreaDay(i.foundAt.getTime())) === day(8),
      ),
    ).toBe(true);
    const phone = await service.search(query('relevance', undefined, '핸드폰'));
    expect(phone.items.map((i) => i.name)).toEqual(['아이폰']);
  });
});
