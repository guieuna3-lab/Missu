import { itemSearch, matchesName } from './item-search';
import {
  custodianPhone,
  sinceFound,
  schoolFoundDay,
  schoolDetail,
  schoolPage,
} from './institution-records';
import { InstitutionItemsService } from './institution-items.service';
import { periodOf } from './institution-items.controller';
import type { InstitutionItem } from './institution-records';
import { ExternalHttpService } from '../integrations/external-http.service';
import { NearbyDto } from './nearby.dto';
import type { DatabaseService } from '../database/database.service';

// 서비스 단위 시험은 저장된 요약이 없는 첫 조회를 사용한다. 실제 변경 감지와
// 재사용은 PostgreSQL 통합 시험에서 검증한다.
function firstCountDatabase(
  count: (args: { where: object }) => Promise<number>,
) {
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ revisions: {}, summary: null }],
    verifiedPortalItem: {
      groupBy: async ({ where }: { where: { day: { gte: string } } }) => [
        { day: where.day.gte, _count: { _all: await count({ where }) } },
      ],
    },
  };
  return {
    $transaction: (read: (db: typeof tx) => unknown) => read(tx),
    $executeRaw: async () => 1,
  };
}

const school =
  '<table><th>작성일</th><tr><td><a href="/bbs/hansung/2175/1/artclView.do"><span class="cate-name">접수</span><strong>학교에서 습득한 (이어폰) 보관중</strong></a></td><td class="td-date">2026.11.22</td></tr><tr><td><a href="/bbs/hansung/2175/2/artclView.do">이어폰 반환완료</a></td><td class="td-date">2026.11.22</td></tr></table>';
function xml(rows: Record<string, string>[]) {
  return (
    '<response><resultCode>00</resultCode><items>' +
    rows
      .map(
        (r) =>
          '<item>' +
          Object.entries(r)
            .map(([k, v]) => '<' + k + '>' + v + '</' + k + '>')
            .join('') +
          '</item>',
      )
      .join('') +
    '</items></response>'
  );
}
const row = {
  atcId: 'F0001',
  fdSn: '1',
  fdPrdtNm: '이어폰',
  fdYmd: '20261113',
  depPlace: '미슈지구대',
  addr: '서울 테스트로 15',
  csteSteNm: '보관중',
};
describe('기관 습득물', () => {
  const key = process.env.DATA_GO_KR_SERVICE_KEY,
    kakao = process.env.KAKAO_REST_API_KEY;
  beforeEach(() => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-11-14T12:00:00+09:00'));
    process.env.DATA_GO_KR_SERVICE_KEY = 'test';
    process.env.KAKAO_REST_API_KEY = 'test';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [k, v] of [
      ['DATA_GO_KR_SERVICE_KEY', key],
      ['KAKAO_REST_API_KEY', kakao],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const service = (read: (u: URL) => string) =>
    new InstitutionItemsService({
      request: async (url: string) => {
        if (
          url.startsWith('https://www.hansung.ac.kr/') &&
          url.endsWith('/artclView.do')
        ) {
          const id = Number(url.split('/').at(-2));
          return new Response(
            '<div class="title"><span class="cate-name">접수</span><strong>학교에서 습득한 (이어폰) 보관중</strong><li>작성일 : 2026.11.13</li></div><div class="txt">습득일: 2026.11.' +
              String(id).padStart(2, '0') +
              '</div>',
          );
        }
        return new Response(read(new URL(url)));
      },
    } as ExternalHttpService);
  it('이미 준비한 보관처는 재시작과 매분 처리에서 전체 물품을 다시 읽지 않는다', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ storage: '기존 보관처' }])
      .mockResolvedValue([]);
    const transaction = jest.fn();
    const s = new InstitutionItemsService(
      {} as ExternalHttpService,
      {
        $queryRaw: query,
        $transaction: transaction,
      } as unknown as DatabaseService,
    );
    const warm = () =>
      (
        s as unknown as { warmStoragePoints(): Promise<void> }
      ).warmStoragePoints();
    await warm();
    await warm();
    expect(transaction).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql] of query.mock.calls)
      expect(String(sql)).not.toContain('verified_portal_items');
  });
  it('상세에서 기관이 확인한 반환과 조회되지 않는 관리번호를 구분한다', async () => {
    const returned = service(() => xml([{ ...row, csteSteNm: '반환완료' }]));
    await expect(returned.detail('lost112:F0001:1')).rejects.toThrow(
      '반환을 완료',
    );
    const missing = service(() => xml([]));
    await expect(missing.detail('lost112:F0001:1')).rejects.toThrow(
      '관리번호의 물품 정보를 찾을 수 없어요',
    );
  });
  it('한성대 게시글의 본문 사진과 실제 이미지 첨부만 중복 없이 노출한다', () => {
    const html =
      '<div class="title"><span class="cate-name">접수</span><strong>충전기</strong>작성일 : 2026.11.13</div>' +
      '<img src="/logo.png"><div class="txt"><img src="/uploads/item.jpg"><img src="https://example.org/x.png"></div>' +
      '<a href="/bbs/hansung/2175/33/download.do">충전기.JPG</a>'.repeat(2) +
      '<a href="/bbs/hansung/2175/34/download.do">목록.pdf</a>';
    expect(schoolDetail(html, '55')?.photoUrls).toEqual([
      'https://www.hansung.ac.kr/uploads/item.jpg',
      'https://www.hansung.ac.kr/bbs/hansung/2175/33/download.do',
    ]);
  });
  it('다른 물품 사진·기본 이미지·반환품을 빼고 요청한 관리번호의 공개 첨부만 읽는다', async () => {
    const address =
      '/lost112Minwon/selectLostInfoAttachFile.do?pkupCmdtyMngId=F0001&fileId=C123';
    const page =
      '<table><tr><th>관리번호</th><td>F0001-1</td></tr><tr><th>유실물 상태</th><td>보관중</td></tr></table>' +
      '<div id="imgDiv"><img src="/img/error/lostNonImg_2.png"></div><script>if (el) el.src = "' +
      address +
      '";</script>';
    const read = (html: string) =>
      service(() => html).publicPhotos('lost112:F0001:1');
    await expect(read(page)).resolves.toEqual([
      'https://minwon24.police.go.kr' + address,
    ]);
    await expect(
      read(page.replace('fileId=C123', 'fileId=N')),
    ).resolves.toEqual([]);
    await expect(
      read(page.replace('pkupCmdtyMngId=F0001', 'pkupCmdtyMngId=F0002')),
    ).resolves.toEqual([]);
    await expect(read(page.replace('보관중', '반환완료'))).resolves.toEqual([]);
    await expect(read(page.replace('F0001-1', 'F0001-2'))).rejects.toThrow(
      '기관 사진',
    );
  });
  it('센터의 잘못 표기된 대표번호를 바로잡고 일반 전화번호는 유지한다', () => {
    expect(custodianPhone('핸드폰찾기 콜센터', '02-1566-4300')).toBe(
      '1566-4300',
    );
    expect(custodianPhone('핸드폰찾기콜센터', '02-3471-1155')).toBe(
      '02-3471-1155',
    );
    expect(custodianPhone('역무실', '02-1234-5678')).toBe('02-1234-5678');
    expect(custodianPhone('역무실', '미기재')).toBeUndefined();
  });
  it('물품명과 기관 세부 분류의 기종이 달라도 포괄 검색은 유지하고 기종 검색은 실물 이름을 따른다', () => {
    const fields = ['삼성휴대폰', '휴대폰', '아이폰'];
    expect(matchesName(itemSearch('핸드폰'), ...fields)).toBe(true);
    expect(matchesName(itemSearch('아이폰'), ...fields)).toBe(false);
    expect(matchesName(itemSearch('아이폰'), '휴대폰', '아이폰')).toBe(true);
    expect(matchesName(itemSearch('갤럭시폰'), '아이폰', '삼성휴대폰')).toBe(
      false,
    );
  });
  it.each([
    ['휴대폰', '검정 아이폰', true],
    ['아이폰', '삼성휴대폰', false],
    ['핸드폰', '아이폰 케이스', false],
    ['이어폰', '갤럭시 버즈', true],
    ['자동차 키', '스마트키', true],
    ['가방', '백팩', true],
    ['월렛', '반지갑', true],
    ['가새', '문구용 가위', true],
    ['가위', '가시개', true],
    ['바굼지', '대나무 바구니', true],
    ['필름카메라', '디지털카메라', false],
  ])('%s 검색의 등록명 %s 일치 여부', (q, name, expected) => {
    expect(matchesName(itemSearch(String(q)), String(name))).toBe(expected);
  });
  it('물품명과 장소를 따로 입력하거나 순서를 바꿔도 습득지와 보관처에서 같은 보관품을 찾는다', async () => {
    const sources = [
      {
        id: 'F101',
        name: '검정 아이폰',
        found: '강남역 근처 골목',
        region: '서울',
        store: '콜센터',
        state: '보관중',
      },
      {
        id: 'F102',
        name: '핸드폰',
        found: '지하상가',
        region: '강남역 2호선 방재',
        store: '콜센터',
        state: '보관중',
      },
      {
        id: 'V103',
        name: '스마트폰',
        found: '공원',
        region: '서울',
        store: '강남역(2호선)',
        state: '보관중',
      },
      {
        id: 'F104',
        name: '아이폰',
        found: '강남역',
        region: '강남역',
        store: '콜센터',
        state: '반환',
      },
      {
        id: 'F105',
        name: '갤럭시폰',
        found: '역삼역',
        region: '역삼역',
        store: '역삼역',
        state: '보관중',
      },
    ];
    const api = service((url) => {
      if (url.hostname === 'www.hansung.ac.kr')
        return '<table><th>작성일</th></table>';
      if (url.pathname.includes('wisenut'))
        return JSON.stringify({
          result: {
            outputs: {
              FOUND: {
                totalCount: sources.length,
                documents: sources.map((r) => ({
                  fields: {
                    PKUP_CMDTY_MNG_ID: r.id,
                    SORT_SN: '1',
                    ITEM_CN: r.name,
                    SGG_NM: r.region,
                    PKUP_CMDTY_LCLSF_NM: '휴대폰',
                  },
                })),
              },
            },
          },
        });
      if (!url.pathname.includes('selectFindListDetail'))
        return xml([]).replace('<items>', '<totalCount>0</totalCount><items>');
      const r = sources.find(
        (r) => r.id === url.searchParams.get('pkupCmdtyMngId'),
      )!;
      const fields = {
        관리번호: r.id + '-1',
        '유실물 상태': r.state,
        '물품 분류': '휴대폰',
        습득일: '2026-11-12',
        '습득 장소': r.found,
        보관장소: r.store,
      };
      return (
        '<h4 class="box-tit1">' +
        r.name +
        '</h4><table>' +
        Object.entries(fields)
          .map(([k, v]) => '<tr><th>' + k + '</th><td>' + v + '</td></tr>')
          .join('') +
        '</table>'
      );
    });
    for (const [q, place] of [
      ['핸드폰', '강남역'],
      ['강남역 휴대폰', ''],
      ['핸드폰 강남역', ''],
    ]) {
      const res = await api.search(q, place, 'all');
      expect(res.items.map((i) => i.id).sort()).toEqual([
        'lost112:F101:1',
        'lost112:F102:1',
        'lost112:V103:1',
      ]);
      expect((await api.searchTotal(q, place, 'all')).total).toBe(3);
    }
    expect((await api.detail('lost112:F101:1')).storage).toBe('콜센터');
  });
  it.each(['이어폰', '핸드폰', '지갑', '우산'])(
    '전국 %s 검색은 별도 수집 요청 없이 DB와 학교의 전체 건수를 읽는다',
    async (q) => {
      const count = jest
        .fn()
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(108);
      const api = new InstitutionItemsService(
        {} as ExternalHttpService,
        {
          ...firstCountDatabase(count),
          agencyCountSnapshot: { findMany: async () => [] },
          lastSearchCount: { findUnique: async () => null },
        } as unknown as DatabaseService,
      );
      jest
        .spyOn(
          api as unknown as {
            schoolInventory(
              q: string,
              days: string,
            ): Promise<Map<string, unknown>>;
          },
          'schoolInventory',
        )
        .mockResolvedValue(new Map([['hansung:1', {}]]));
      expect((await api.searchTotal(q, '', 'all')).confirmedTotal).toBe(101);
      expect((await api.searchTotal(q, '', 'all')).confirmedTotal).toBe(109);
      expect(count.mock.calls[0][0].where.stored).toBe(true);
    },
  );
  it('이어폰 전체 건수는 선택 기간의 각 날짜가 확인된 뒤에만 확정하고 승인된 경찰도 포함한다', async () => {
    const days = Array.from(
      { length: 7 },
      (_, i) => '2026-11-' + String(8 + i).padStart(2, '0'),
    );
    const completedAt = new Date();
    const jobs = days.map((day) => ({
      query: 'catalog/포털기관/' + day,
      completedAt: completedAt as Date | null,
      listTotal: null as number | null,
    }));
    const db = {
      ...firstCountDatabase(async () => 87),
      foundItem: { count: async () => 2 },
      $executeRaw: async () => 1,
      agencyCountSnapshot: { findMany: async () => jobs },
      lastSearchCount: { findUnique: async () => null },
    } as unknown as DatabaseService;
    const api = new InstitutionItemsService({} as ExternalHttpService, db);
    const school = jest
      .spyOn(
        api as unknown as { schoolInventory(): Promise<Map<string, unknown>> },
        'schoolInventory',
      )
      .mockResolvedValue(new Map([['hansung:1', {}]]));
    const query = () => api.searchTotal('이어폰', '', '7');
    jobs[0].completedAt = null;
    expect(await query()).toMatchObject({
      status: 'counting',
      total: null,
      confirmedTotal: 88,
    });
    jobs[0].completedAt = completedAt;
    expect(await query()).toMatchObject({
      status: 'complete',
      total: 88,
      policeIncluded: false,
    });
    jobs.push({
      query: 'catalog/경찰/' + days[0],
      completedAt: null,
      listTotal: 1,
    });
    expect(await query()).toMatchObject({
      status: 'counting',
      total: null,
      policeIncluded: true,
    });
    jobs.pop();
    jobs.push(
      ...days.map((day) => ({
        query: 'catalog/경찰/' + day,
        completedAt,
        listTotal: 0,
      })),
    );
    expect(await query()).toMatchObject({
      status: 'complete',
      total: 88,
      policeIncluded: true,
    });
    school.mockRejectedValueOnce(Error('학교 응답 없음'));
    expect(await query()).toMatchObject({ total: null });
  });
  it('제목이 그대로여도 반환은 제외하고 습득일이 없으면 게시일로 표시한다', () => {
    const head =
      '<div class="title"><span class="cate-name">접수</span><strong>연구실에서 습득한 (충전기) 보관중</strong><li>작성일 : 2026.11.13</li></div>';
    expect(schoolDetail(head, '226051')).toMatchObject({
      name: '충전기',
      date: '2026-11-13',
      dateLabel: '게시일',
    });
    expect(
      schoolDetail(head.replace('접수', '반환'), '226051'),
    ).toBeUndefined();
    expect(schoolPage(school.replace('접수', '반환')).items).toEqual([]);
  });
  it('한국 달력의 최근 6개월과 학교 원문의 실제 습득일을 적용한다', () => {
    expect(sinceFound('all', Date.parse('2024-08-31T00:00:00+09:00'))).toBe(
      '2024-02-29',
    );
    expect(sinceFound('all', Date.parse('2026-11-14T00:00:00+09:00'))).toBe(
      '2026-05-14',
    );
    expect(
      schoolFoundDay('<div class="txt">작성일: 2026.11.12</div>'),
    ).toBeUndefined();
    expect(
      schoolFoundDay('<div class="txt">습득일: 2026.02.31</div>'),
    ).toBeUndefined();
  });
  it('포털이 닫혀도 이름·기간·장소가 일치한 저장 보관품을 날짜와 함께 바로 전달한다', async () => {
    const checkedAt = new Date('2026-11-13T23:00:00+09:00');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'lost112:V111:2',
        source: '지하철',
        name: '카드지갑',
        storage: '가상역(2호선)',
        day: '2026-05-14',
        category: 'WALLET_BAG',
        checkedAt,
      },
    ]);
    const api = new InstitutionItemsService(
      {
        request: async () => {
          throw Error('offline');
        },
      } as unknown as ExternalHttpService,
      { verifiedPortalItem: { findMany } } as unknown as DatabaseService,
    );
    const cursor = Buffer.from(JSON.stringify([null, null, [0, 0]])).toString(
      'base64url',
    );
    const result = await api.search('지갑', '가상역 2호선', 'all', cursor);
    expect(result.items[0]).toMatchObject({
      reference: 'V111 / 2',
      lastVerifiedOn: '2026-11-13',
    });
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      stored: true,
      AND: [
        {
          OR: expect.arrayContaining([
            {
              searchFragments: {
                hasSome: expect.arrayContaining(['지갑', '월렛']),
              },
            },
          ]),
        },
      ],
      day: { gte: '2026-05-14', lte: '2026-11-14' },
      OR: expect.arrayContaining([{ placeKey: { contains: '가상역2호선' } }]),
    });
  });
  it('기관 재조회 중에도 학교와 보관 확인 목록을 날짜·관리번호순으로 함께 넘긴다', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({
      id: 'lost112:V' + (100 + i) + ':1',
      name: '카드지갑',
      storage: '가상역',
      source: '지하철',
      category: 'WALLET_BAG',
      day: '2026-11-13',
      checkedAt: new Date(Date.now()),
    }));
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(rows.slice(24));
    const api = new InstitutionItemsService(service(() => xml([]))['http'], {
      verifiedPortalItem: { findMany },
    } as unknown as DatabaseService);
    const internals = api as unknown as PickMethods;
    type PickMethods = {
      schoolInventory: (typeof api)['schoolInventory'];
      records: (typeof api)['records'];
    };
    jest
      .spyOn(internals, 'records')
      .mockImplementation(() => new Promise(() => {}));
    jest.spyOn(internals, 'schoolInventory').mockResolvedValue(
      new Map([
        [
          'hansung:2',
          {
            id: 'hansung:2',
            name: '지갑',
            source: '한성대',
            storage: '한성대',
            date: '2026-11-13',
            dateLabel: '습득일',
            category: 'WALLET_BAG',
            url: '',
            reference: '2',
          },
        ],
      ]),
    );
    const first = await api.search('지갑', '', 'all');
    expect(first).toMatchObject({ verifiedPage: true });
    expect(first.items.map((i) => i.id)).toEqual([
      'hansung:2',
      ...rows.slice(0, 24).map((r) => r.id),
    ]);
    const next = await api.search('지갑', '', 'all', first.nextCursor!);
    expect(next.items.map((i) => i.id)).toEqual(
      rows.slice(24).map((r) => r.id),
    );
    expect(findMany.mock.calls[1][0].where.AND[1].OR).toEqual([
      { day: { lt: '2026-11-13' } },
      { day: '2026-11-13', id: { gt: rows[23].id } },
    ]);
    await expect(
      api.search('핸드폰', '', 'all', first.nextCursor!),
    ).rejects.toThrow();
  });
  it('학교 저장 목록은 기관 네트워크를 기다리지 않고 건수와 더보기를 함께 준다', async () => {
    process.env.SIGNING_KEY = '2'.repeat(64);
    process.env.PII_KEY = '1'.repeat(64);
    process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:55439/sort_test';
    const http = {
      request: jest.fn().mockRejectedValue(Error('network must not run')),
    };
    const db = {
      $queryRaw: jest.fn().mockImplementation(async () => []),
      verifiedPortalItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const api = new InstitutionItemsService(
      http as unknown as ExternalHttpService,
      db as unknown as DatabaseService,
    );
    const day = new Date(Date.now()).toISOString().slice(0, 10);
    jest.spyOn(api, 'schoolForMatching').mockResolvedValue(
      Array.from({ length: 41 }, (_, i) => ({
        id: 'hansung:' + i,
        name: '지갑',
        category: 'WALLET_BAG',
        source: '한성대',
        storage: '한성대학교',
        date: day,
        dateLabel: '습득일',
        reference: String(i),
        url: '',
      })),
    );
    const query = Object.assign(new NearbyDto(), {
      lat: 37.5824,
      lng: 127.0102,
      cursor: 'verified',
    });
    const [page, total] = await Promise.all([
      api.nearby(query),
      api.nearbyTotal(query),
    ]);
    expect(page.items).toHaveLength(25);
    expect(page.nextCursor).toBeTruthy();
    expect(page).toMatchObject({ refreshing: false });
    expect(total).toMatchObject({ status: 'complete', total: 41 });
    const next = await api.nearby(
      Object.assign(new NearbyDto(), query, { cursor: page.nextCursor! }),
    );
    expect(next.items).toHaveLength(16);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...page.items, ...next.items].map((i) => i.id)).size).toBe(
      41,
    );
    expect(http.request).not.toHaveBeenCalled();
  });
  it('전국 첫 집계 중에도 현재 보관 중인 지갑 전체 건수를 페이지 제한 없이 제공한다', async () => {
    const count = jest.fn().mockResolvedValue(327);
    const db = {
      ...firstCountDatabase(count),
      agencyCountSnapshot: { findMany: async () => [] },
      lastSearchCount: { findUnique: async () => null },
    } as unknown as DatabaseService;
    const api = new InstitutionItemsService({} as ExternalHttpService, db);
    jest
      .spyOn(
        api as unknown as { schoolInventory(): Promise<Map<string, unknown>> },
        'schoolInventory',
      )
      .mockResolvedValue(new Map());
    expect(await api.searchTotal('지갑', '', 'all')).toEqual({
      status: 'counting',
      total: null,
      confirmedPortal: 327,
      confirmedTotal: 327,
      policeIncluded: false,
      refreshAfterMs: 60000,
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        stored: true,
        AND: [
          {
            OR: expect.arrayContaining([
              {
                searchFragments: {
                  hasSome: expect.arrayContaining(['지갑', '월렛']),
                },
              },
            ]),
          },
        ],
        day: { gte: '2026-05-14', lte: '2026-11-14' },
      },
    });
  });
  it('학교 게시판을 한 번 읽어 동시에 요청한 여러 품목과 기간에 사용한다', async () => {
    const read = jest.fn(() => school);
    const api = service(read);
    const [earphones, wallet] = await Promise.all([
      api['schoolInventory']('이어폰', 'all'),
      api['schoolInventory']('지갑', '7'),
    ]);
    expect([...earphones.keys()]).toEqual(['hansung:1']);
    expect(wallet.size).toBe(0);
    await api['schoolInventory']('에어팟', '30');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('키가 없어도 학교 보관 공고와 불러오지 못한 기관을 구분한다', async () => {
    delete process.env.DATA_GO_KR_SERVICE_KEY;
    const result = await service(() => school).search('이어폰', '', 'all');
    expect(result.items.map((x) => x.id)).toEqual(['hansung:1']);
    expect(result.notices).toEqual([
      '경찰 자료를 현재 조회할 수 없어요.',
      '포털기관 자료를 현재 조회할 수 없어요.',
    ]);
  });
  it('포털 일일 한도는 같은 기능만 중단하고 한국 날짜가 바뀌면 조회를 재개한다', async () => {
    let quota = true;
    let portalCalls = 0;
    const api = service((url) => {
      if (url.host === 'www.hansung.ac.kr') return school;
      if (!url.pathname.includes('LosPtfund')) return xml([]);
      if (url.pathname.endsWith('DetailInfo')) return xml([row]);
      portalCalls++;
      if (quota)
        return '<OpenAPI_ServiceResponse><returnReasonCode>22</returnReasonCode></OpenAPI_ServiceResponse>';
      return xml([row]).replace('<items>', '<totalCount>1</totalCount><items>');
    });
    const clock = jest.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(Date.parse('2026-11-14T23:59:50+09:00'));
      expect(await api.portalRegistrations('지갑', '')).toBeNull();
      quota = false;
      expect(await api.portalRegistrations('가방', '')).toBeNull();
      expect(portalCalls).toBe(1);
      clock.mockReturnValue(Date.parse('2026-11-15T00:00:01+09:00'));
      expect(await api.portalRegistrations('지갑', '')).toBe(1);
      expect(portalCalls).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });
  it('포털 전체 등록 수는 상세 카드 수나 역별 합계가 아닌 원본 totalCount로 읽는다', async () => {
    let calls = 0;
    const api = service((url) => {
      calls++;
      expect(url.searchParams.get('PRDT_NM')).toBe('지갑');
      expect(url.searchParams.has('DEP_PLACE')).toBe(false);
      return xml([row]).replace(
        '<items>',
        '<totalCount>2700</totalCount><items>',
      );
    });
    expect(await api.portalRegistrations('지갑', '')).toBe(2700);
    expect(calls).toBe(1);
    expect(
      await service(() => xml([])).portalRegistrations('지갑', ''),
    ).toBeNull();
  });
  it('먼저 표시할 검색 결과에는 장소·날짜가 맞는 보관품만 담고 전국 기관을 기다리지 않는다', async () => {
    const api = service((url) => {
      expect(url.host).toBe('www.hansung.ac.kr');
      return school;
    });
    expect(
      (await api.preview('이어폰', '', 'all')).items.map((i) => i.id),
    ).toEqual(['hansung:1']);
    expect((await api.preview('이어폰', '강남역', 'all')).items).toEqual([]);
  });
  it('끝 페이지까지 확인하고 페이지·기관 간 같은 관리번호를 한 번만 센다', async () => {
    const api = service(() => school);
    const item = (id: string, source: '한성대' | '경찰' | '지하철') =>
      ({ id, source }) as Awaited<
        ReturnType<typeof api.search>
      >['items'][number];
    const search = jest
      .spyOn(api, 'search')
      .mockResolvedValueOnce({
        items: [item('hansung:1', '한성대'), item('lost112:1:1', '경찰')],
        nextCursor: 'second',
        unavailableSources: [],
        notices: [],
      })
      .mockResolvedValueOnce({
        items: [item('lost112:1:1', '지하철'), item('lost112:2:1', '경찰')],
        nextCursor: null,
        unavailableSources: [],
        notices: [],
      });
    const first = await Promise.all([
      api.searchTotal('지갑', '', 'all'),
      api.searchTotal('지갑', '', 'all'),
    ]);
    expect(first).toEqual(
      Array(2).fill({ status: 'counting', total: null, confirmedTotal: 2 }),
    );
    expect(await api.searchTotal('지갑', '', 'all')).toEqual({
      status: 'complete',
      total: 3,
      policeIncluded: true,
    });
    expect(await api.searchTotal('지갑', '', 'all')).toEqual({
      status: 'complete',
      total: 3,
      policeIncluded: true,
    });
    expect(search).toHaveBeenCalledTimes(2);
  });
  it.each(['한성대', '포털기관'] as const)(
    '%s 조회 실패를 0건으로 계산하지 않는다',
    async (source) => {
      const api = service(() => school);
      jest.spyOn(api, 'search').mockResolvedValue({
        items: [],
        nextCursor: null,
        notices: [],
        unavailableSources: [source, '경찰'],
      });
      expect(await api.searchTotal('지갑', '', 'all')).toEqual({
        status: 'unavailable',
        total: null,
      });
    },
  );
  it('경찰 승인 전에는 학교와 지하철 전체를 세고, 승인 후에는 경찰만 다시 읽어 합산한다', async () => {
    let approved = false;
    const rail = { ...row, depPlace: '강남역(2호선)' };
    let schoolReads = 0;
    const api = service((url) => {
      if (url.hostname === 'www.hansung.ac.kr') {
        schoolReads++;
        return school;
      }
      const police = url.pathname.includes('/LosfundInfo');
      if (police && !approved) throw Error('pending');
      const rows = police ? [rail, { ...row, atcId: 'F0002' }] : [rail];
      return xml(rows).replace(
        '<items>',
        '<totalCount>' + rows.length + '</totalCount><items>',
      );
    });
    const clock = jest.spyOn(Date, 'now');
    try {
      const now = Date.now();
      clock.mockReturnValue(now);
      const total = () => api.searchTotal('이어폰', '', 'all');
      expect(await total()).toEqual({
        status: 'complete',
        total: 2,
        policeIncluded: false,
      });
      approved = true;
      expect((await total()).total).toBe(2);
      clock.mockReturnValue(now + 120001);
      expect(await total()).toEqual({
        status: 'complete',
        total: 3,
        policeIncluded: true,
      });
      expect(schoolReads).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('경찰 후속 페이지가 실패하면 앞서 본 경찰 단독 물품만 합계에서 뺀다', async () => {
    const api = service(() => school);
    const item = (id: string, source: '경찰' | '지하철') =>
      ({ id, source }) as Awaited<
        ReturnType<typeof api.search>
      >['items'][number];
    jest
      .spyOn(api, 'search')
      .mockResolvedValueOnce({
        items: [item('shared', '경찰'), item('police-only', '경찰')],
        nextCursor: 'later',
        unavailableSources: [],
        notices: [],
      })
      .mockResolvedValueOnce({
        items: [item('shared', '지하철')],
        nextCursor: null,
        unavailableSources: ['경찰'],
        notices: [],
      });
    expect((await api.searchTotal('지갑', '', 'all')).total).toBeNull();
    expect(await api.searchTotal('지갑', '', 'all')).toEqual({
      status: 'complete',
      total: 1,
      policeIncluded: false,
    });
  });
  it('지도에는 반경 안의 일치하는 보관처와 현재 보관 중인 물품만 담는다', async () => {
    const api = service((u) => {
      if (u.host === 'dapi.kakao.com')
        return JSON.stringify({
          documents:
            u.searchParams.get('query') === '지구대'
              ? [
                  {
                    place_name: '미슈지구대',
                    road_address_name: row.addr,
                    x: '127',
                    y: '37.5',
                  },
                  {
                    place_name: '먼지구대',
                    road_address_name: '타지로 1',
                    x: '129',
                    y: '37.5',
                  },
                ]
              : [],
        });
      if (u.pathname.includes('DetailInfo'))
        return xml([
          {
            ...row,
            fdSn: u.searchParams.get('FD_SN')!,
            csteSteNm:
              u.searchParams.get('FD_SN') === '1' ? '보관중' : '반환완료',
          },
        ]);
      expect(u.searchParams.get('ADDR')).toBe('테스트로 15');
      return xml([
        row,
        { ...row, fdSn: '2' },
        { ...row, fdSn: '3', addr: '다른로 3' },
      ]);
    });
    const result = await api.nearby(
      Object.assign(new NearbyDto(), { lat: 37.5, lng: 127, radiusM: 500 }),
    );
    expect(result.items.map((i) => [i.id, i.source, i.distanceM])).toEqual([
      ['lost112:F0001:1', '경찰', 0],
    ]);
  });
  it('근처 더보기는 반환 페이지를 건너뛰고 6개월 경계까지 학교 접수품만 이어서 읽는다', async () => {
    const fetched: number[] = [];
    const site = { place_name: '한성대학교 상상관', x: '127', y: '37.5' };
    const data = [
      ['1', '접수', '충전기', '2026.11.13'],
      ['2', '반환', '반환 지갑', '2026.11.10'],
      ['3', '접수', 'LG USB(검정&흰색)', '2026.05.14'],
      ['4', '접수', '오래된 물품', '2026.05.13'],
    ];
    let failUsb = true;
    const api = new InstitutionItemsService({
      request: async (raw: string) => {
        const u = new URL(raw);
        if (u.hostname === 'dapi.kakao.com')
          return new Response(
            JSON.stringify({
              documents:
                u.searchParams.get('query') === '한성대학교 상상관'
                  ? [site]
                  : [],
            }),
          );
        if (u.pathname.endsWith('artclList.do')) {
          const page = Number(u.searchParams.get('page'));
          fetched.push(page);
          const [id, state, name, day] = data[page - 1];
          return new Response(
            '<table><th>작성일</th><tr><td><a href="/bbs/hansung/2175/' +
              id +
              '/artclView.do"><span class="cate-name">' +
              state +
              '</span><strong>(' +
              name +
              ') 보관중</strong></a></td><td class="td-date">' +
              day +
              '</td></tr></table><a href="javascript:page_link(\'8\')">끝</a>',
          );
        }
        const [id, state, name, day] =
          data[Number(u.pathname.split('/').at(-2)) - 1];
        if (id === '3' && failUsb) {
          failUsb = false;
          throw Error('temporary');
        }
        return new Response(
          '<div class="title"><span class="cate-name">' +
            state +
            '</span><strong>(' +
            name +
            ') 보관중</strong><li>작성일 : ' +
            day +
            '</li></div>',
        );
      },
    } as ExternalHttpService);
    const query = Object.assign(new NearbyDto(), { lat: 37.5, lng: 127 });
    const first = await api.nearby(query);
    expect(first.items.map((i) => i.name)).toEqual(['충전기']);
    expect(first.notices).toEqual([]);
    query.cursor = first.nextCursor!;
    const failed = await api.nearby(query);
    expect(failed.nextCursor).toBe('school:3');
    expect(failed.notices.join(' ')).toContain('불러오지 못했어요');
    query.cursor = failed.nextCursor!;
    const next = await api.nearby(query);
    expect(next.items.map((i) => [i.name, i.date, i.distanceM])).toEqual([
      ['LG USB(검정&흰색)', '2026-05-14', 0],
    ]);
    query.cursor = next.nextCursor!;
    expect(await api.nearby(query)).toMatchObject({
      items: [],
      notices: [],
      nextCursor: null,
    });
    expect(fetched).toEqual([1, 2, 3, 4]);
    // 목록을 끝까지 누르지 않은 새 검색도 독립적으로 전체를 계산합니다.
    const fresh = Object.assign(new NearbyDto(), { lat: 37.5, lng: 127 });
    expect(await api.nearbyTotal(fresh)).toMatchObject({
      status: 'counting',
      total: null,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await api.nearbyTotal(fresh)).toEqual({
      status: 'complete',
      total: 2,
      incomplete: [],
    });
    const filtered = { ...fresh, category: 'WALLET_BAG' as const };
    api.nearbyTotal(filtered);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await api.nearbyTotal(filtered)).toMatchObject({
      status: 'complete',
      total: 0,
    });
    query.cursor = 'school:0';
    await expect(api.nearby(query)).rejects.toThrow();
  });

  it('홈에서 더 볼 수 있도록 첫 10건 뒤의 보관품도 최신순으로 반환한다', async () => {
    const board =
      '<table><th>작성일</th>' +
      Array.from(
        { length: 12 },
        (_, i) =>
          '<tr><td><a href="/bbs/hansung/2175/' +
          (i + 1) +
          '/artclView.do"><span class="cate-name">접수</span><strong>물품 보관중</strong></a></td><td class="td-date">2026.11.' +
          String(i + 1).padStart(2, '0') +
          '</td></tr>',
      ).join('') +
      '</table>';
    const api = service((u) =>
      u.host === 'www.hansung.ac.kr' ? board : xml([]),
    );
    const { items } = await api.recent();
    expect(items).toHaveLength(12);
    expect(items.slice(10).map((i) => i.id)).toEqual([
      'hansung:2',
      'hansung:1',
    ]);
  });
  it('역 이름과 노선이 같은 보관품만 해당 역에 올린다', async () => {
    const site = {
      place_name: '한성대입구역 4호선',
      road_address_name: '삼선교로 지하 1',
      category_group_code: 'SW8',
      x: '127',
      y: '37.5',
    };
    const stored = { ...row, depPlace: '한성대입구역(4호선)' };
    const api = service((u) => {
      if (u.host === 'dapi.kakao.com')
        return JSON.stringify({
          meta: { is_end: true },
          documents:
            u.searchParams.get('category_group_code') === 'SW8' ? [site] : [],
        });
      if (u.pathname.endsWith('DetailInfo')) return xml([stored]);
      expect(u.searchParams.get('DEP_PLACE')).toBe('한성대입구역(4호선)');
      return xml([stored, { ...stored, fdSn: '2', depPlace: '다른역(4호선)' }]);
    });
    const data = await api.nearby(
      Object.assign(new NearbyDto(), { lat: 37.5, lng: 127, radiusM: 1000 }),
    );
    expect(data.items.map((item) => [item.storage, item.distanceM])).toEqual([
      ['한성대입구역(4호선)', 0],
    ]);
  });
  it('반경 내 모든 역·페이지와 공개 보관품을 합산하고 실제로 같은 건수를 끝까지 열 수 있다', async () => {
    const sites = ['하나', '둘', '셋', '넷', '다섯'].map((name, i) => ({
      place_name: name + '역 2호선',
      road_address_name: '테스트로 ' + (i + 1),
      category_group_code: 'SW8',
      x: String(127 + i / 10000),
      y: '37.5',
    }));
    const storage = (i: number) =>
      sites[i].place_name.replace(' 2호선', '(2호선)');
    const entries = Array.from({ length: 28 }, (_, i) => ({
      ...row,
      atcId: 'V' + (100 + i),
      depPlace: storage(i < 24 ? 0 : i - 23),
    }));
    const indexCalls: string[] = [];
    const detailHtml = (
      atcId: string,
      place: string,
      state: string,
      name: string,
    ) =>
      '<h4 class="box-tit1">' +
      name +
      '</h4><table>' +
      Object.entries({
        관리번호: atcId + '-1',
        습득일: '2026-11-13, 11시 경',
        '유실물 상태': state,
        보관장소: place,
        '물품 분류': '휴대폰',
      })
        .map(([k, v]) => '<tr><th>' + k + '</th><td>' + v + '</td></tr>')
        .join('') +
      '</table>';
    const api = new InstitutionItemsService({
      request: async (raw: string, init: RequestInit) => {
        const u = new URL(raw);
        if (u.host === 'dapi.kakao.com')
          return Response.json({
            meta: { is_end: true },
            documents:
              u.searchParams.get('category_group_code') === 'SW8'
                ? u.searchParams.has('query')
                  ? sites.filter(
                      (x) => x.place_name === u.searchParams.get('query'),
                    )
                  : sites
                : [],
          });
        if (u.pathname.endsWith('search.do')) {
          if (typeof init.body !== 'string') throw Error('Missing search body');
          const body = JSON.parse(init.body) as {
            subQueries: { FOUND_COLLECTION_QUERY: string };
            pageStart: number;
          };
          const place = body.subQueries.FOUND_COLLECTION_QUERY.slice(
            '<KPNG_PLC_NM:contains:'.length,
            -1,
          );
          indexCalls.push(place);
          const ids =
            place === storage(4) ? ['V127', 'V999', 'V998', 'V997'] : [];
          return Response.json({
            result: {
              outputs: {
                FOUND: {
                  totalCount: ids.length,
                  documents: ids.map((id) => ({
                    fields: {
                      PKUP_CMDTY_MNG_ID: id,
                      SORT_SN: '1',
                      KPNG_PLC_NM: id === 'V997' ? '다른역(2호선)' : place,
                    },
                  })),
                },
              },
            },
          });
        }
        if (u.pathname.endsWith('selectFindListDetail.do')) {
          const id = u.searchParams.get('pkupCmdtyMngId')!;
          return new Response(
            detailHtml(
              id,
              storage(4),
              id === 'V998' ? '반환완료' : '보관중',
              id === 'V999' ? '삼성 스마트폰' : '이어폰',
            ),
          );
        }
        if (u.pathname.endsWith('DetailInfo'))
          return new Response(
            xml(
              entries.filter((x) => x.atcId === u.searchParams.get('ATC_ID')),
            ),
          );
        const matches = entries.filter(
          (x) => x.depPlace === u.searchParams.get('DEP_PLACE'),
        );
        const page = Number(u.searchParams.get('pageNo')),
          size = 16;
        return new Response(
          xml(matches.slice((page - 1) * size, page * size)).replace(
            '<items>',
            '<pageNo>' +
              page +
              '</pageNo><numOfRows>' +
              size +
              '</numOfRows><totalCount>' +
              matches.length +
              '</totalCount><items>',
          ),
        );
      },
    } as ExternalHttpService);
    const query = Object.assign(new NearbyDto(), { lat: 37.5, lng: 127 });
    api.nearbyTotal(query);
    const first = await api.nearby(query);
    const next = await api.nearby(
      Object.assign(new NearbyDto(), query, { cursor: first.nextCursor! }),
    );
    const ids = [...first.items, ...next.items].map((i) => i.id);
    expect(first.items).toHaveLength(25);
    expect(new Set(ids).size).toBe(29);
    expect(ids).toHaveLength(29);
    expect(ids).toContain('lost112:V999:1');
    expect(ids).not.toContain('lost112:V998:1');
    expect(ids).not.toContain('lost112:V997:1');
    expect(next.nextCursor).toBeNull();
    expect(first.notices).toEqual([]);
    expect(indexCalls).toHaveLength(5);
    expect(await api.nearbyTotal(query)).toEqual({
      status: 'complete',
      total: 29,
      incomplete: [],
    });
    expect(await api.detail('lost112:V999:1')).toMatchObject({
      name: '삼성 스마트폰',
      storage: storage(4),
    });
  });
  it('전국 검색에서 지하철·공항·상점의 보관품만 한 번씩 표시한다', async () => {
    const venues = ['강남역(2호선)', '공항 고객센터', '백화점 안내소', '상점'];
    const entries = venues.map((depPlace, i) => ({
      ...row,
      fdPrdtNm: i === 2 ? '갈색 월렛' : '지갑',
      depPlace,
      atcId: 'V' + i,
      csteSteNm: i === 3 ? '반환완료' : '보관중',
    }));
    const api = service((u) => {
      if (u.host === 'www.hansung.ac.kr')
        return '<table><th>작성일</th></table>';
      if (!u.pathname.includes('LosPtfund')) return xml([]);
      if (u.pathname.endsWith('DetailInfo'))
        return xml(
          entries.filter((r) => r.atcId === u.searchParams.get('ATC_ID')),
        );
      expect(u.searchParams.has('DEP_PLACE')).toBe(false);
      return xml([...entries, entries[0]]);
    });
    const page = await api.search('지갑', '', 'all');
    expect(page.items.map((i) => [i.storage, i.source])).toEqual([
      [venues[0], '지하철'],
      [venues[1], '포털기관'],
      [venues[2], '포털기관'],
    ]);
  });
  it('홈과 검색이 같은 원본 페이지의 나머지 물품부터 확인한 뒤 실제 다음 페이지를 읽는다', async () => {
    const wallets = Array.from({ length: 43 }, (_, n) => ({
      ...row,
      atcId: 'W' + n,
      fdPrdtNm: '지갑',
      depPlace: '테스트역(2호선)',
    }));
    const api = service((u) => {
      if (u.host === 'www.hansung.ac.kr')
        return '<table><th>작성일</th></table>';
      if (!u.pathname.includes('LosPtfund')) return xml([]);
      if (u.pathname.endsWith('DetailInfo'))
        return xml(
          wallets.filter((w) => w.atcId === u.searchParams.get('ATC_ID')),
        );
      expect(u.searchParams.has('DEP_PLACE')).toBe(false);
      const page = Number(u.searchParams.get('pageNo'));
      const size = Number(u.searchParams.get('numOfRows'));
      return xml(wallets.slice((page - 1) * size, page * size)).replace(
        '<items>',
        '<totalCount>43</totalCount><numOfRows>' +
          size +
          '</numOfRows><pageNo>' +
          page +
          '</pageNo><items>',
      );
    });
    for (const fetch of [
      (cursor?: string) => api.recent(cursor),
      (cursor?: string) => api.search('지갑', '', 'all', cursor),
    ]) {
      const pages = [await fetch()];
      while (pages.at(-1)!.nextCursor && pages.length < 5) {
        pages.push(await fetch(pages.at(-1)!.nextCursor!));
      }
      expect(pages[0].items).toHaveLength(24);
      const ids = pages.flatMap((page) => page.items.map((item) => item.id));
      expect(ids).toHaveLength(43);
      expect(new Set(ids).size).toBe(43);
      expect(pages.at(-1)!.nextCursor).toBeNull();
      for (const page of pages) expect(page.notices).toEqual([]);
    }
  });
  it.each(['상세', '상세 누락'] as const)(
    '지하철 %s 조회 실패만 알리고 읽은 물품은 유지한다',
    async (failure) => {
      const rail = { ...row, depPlace: '강남역(2호선)' };
      const api = service((url) => {
        if (url.hostname === 'www.hansung.ac.kr') return school;
        if (!url.pathname.includes('LosPtfund')) return xml([]);
        if (url.pathname.endsWith('DetailInfo')) {
          if (url.searchParams.get('FD_SN') === '1') return xml([rail]);
          if (failure === '상세') throw Error('detail unavailable');
          return xml([]);
        }
        return xml([rail, { ...rail, fdSn: '2' }]);
      });
      const page = await api.search('이어폰', '', 'all');
      expect(page.items.map((i) => i.id)).toContain('lost112:F0001:1');
      expect(page.notices).toEqual(['포털기관 자료 일부를 불러오지 못했어요.']);
    },
  );
  it('다음 지하철 페이지 전체가 실패하면 같은 위치에서 다시 조회할 수 있다', async () => {
    let offline = true;
    const rail = { ...row, depPlace: '강남역(2호선)' };
    const api = service(() => {
      if (offline) throw Error('source unavailable');
      return xml([rail]);
    });
    const cursor = Buffer.from(JSON.stringify([null, null, [2, 0]])).toString(
      'base64url',
    );
    const failed = await api.search('이어폰', '강남역', 'all', cursor);
    expect(failed.notices).toEqual(['포털기관 자료를 현재 조회할 수 없어요.']);
    expect(failed.nextCursor).toBe(cursor);
    offline = false;
    const recovered = await api.search(
      '이어폰',
      '강남역',
      'all',
      failed.nextCursor!,
    );
    expect(recovered.nextCursor).toBeNull();
    expect(recovered.notices).toEqual([]);
    expect(recovered.items).toHaveLength(1);
  });
});

describe('기관 목록 저장본의 사진', () => {
  const photo =
    'https://www.lost112.go.kr/lostnfs/images/uploadImg/2026/11/wallet.jpg';
  it('확인한 보관품의 첫 사진 주소를 저장본에 함께 쓴다', async () => {
    const values: unknown[][] = [];
    const api = new InstitutionItemsService(
      {} as ExternalHttpService,
      {
        $executeRaw: async (_sql: TemplateStringsArray, ...args: unknown[]) => {
          values.push(args);
          return 1;
        },
      } as unknown as DatabaseService,
    );
    const item = await (
      api as unknown as {
        verifiedItem: (
          row: Record<string, string>,
          source: '포털기관',
          observedAt: Date,
        ) => Promise<{ photoUrls?: string[] } | undefined>;
      }
    ).verifiedItem(
      {
        atcId: 'V0002122L11170002',
        fdSn: '1',
        fdPrdtNm: '카드지갑',
        depPlace: '미아사거리역(4호선)',
        fdYmd: '20261117',
        csteSteNm: '보관중',
        orgNm: '서울교통공사',
        fdFilePathImg: photo,
      },
      '포털기관',
      new Date('2026-11-17T09:00:00+09:00'),
    );
    expect(item?.photoUrls).toEqual([photo]);
    expect(values).toHaveLength(1);
    expect(values[0].at(-1)).toBe(photo);
  });
  it('저장본 목록에 사진 주소가 있으면 photoUrls로 돌려준다', async () => {
    const row = {
      id: 'lost112:V111:2',
      source: '지하철',
      name: '카드지갑',
      storage: '가상역(2호선)',
      day: '2026-05-14',
      category: 'WALLET_BAG',
      checkedAt: new Date('2026-11-13T23:00:00+09:00'),
    };
    const findMany = jest.fn().mockResolvedValue([
      { ...row, photoUrl: photo },
      { ...row, id: 'lost112:V112:1', photoUrl: null },
    ]);
    const api = new InstitutionItemsService(
      {
        request: async () => {
          throw Error('offline');
        },
      } as unknown as ExternalHttpService,
      { verifiedPortalItem: { findMany } } as unknown as DatabaseService,
    );
    const cursor = Buffer.from(JSON.stringify([null, null, [0, 0]])).toString(
      'base64url',
    );
    const result = await api.search('지갑', '가상역 2호선', 'all', cursor);
    const byId = new Map(result.items.map((i) => [i.id, i]));
    expect(byId.get('lost112:V111:2')?.photoUrls).toEqual([photo]);
    expect(byId.get('lost112:V112:1')).not.toHaveProperty('photoUrls');
  });
});

describe('실시간 목록의 저장본 사진 보강', () => {
  type Row = Parameters<
    InstitutionItemsService['withSavedPhotos']
  >[0]['items'][number];
  const photo =
    'https://www.lost112.go.kr/lostnfs/images/uploadImg/2026/11/buds.jpg';
  const base = {
    source: '경찰' as const,
    date: '2026-11-14',
    dateLabel: '습득일' as const,
    storage: '연일지구대',
    reference: 'F1 / 1',
    url: '',
    category: 'ELECTRONICS',
  };
  it('사진이 없는 경찰 물품에 저장본 사진을 붙이고 나머지는 그대로 둔다', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'lost112:F1:1', photoUrl: photo }]);
    const api = new InstitutionItemsService(
      {} as ExternalHttpService,
      {
        verifiedPortalItem: { findMany },
      } as unknown as DatabaseService,
    );
    const kept = ['https://example.com/a.jpg'];
    const result = await api.withSavedPhotos({
      items: <Row[]>[
        { ...base, id: 'lost112:F1:1', name: '삼성 무선 이어폰' },
        { ...base, id: 'lost112:F2:1', name: '버즈 케이스' },
        { ...base, id: 'lost112:F3:1', name: '에어팟', photoUrls: kept },
        { ...base, id: 'hansung:9', name: '우산', source: '한성대' as const },
      ],
      nextCursor: 'c',
    });
    expect(findMany.mock.calls[0][0].where.id.in).toEqual([
      'lost112:F1:1',
      'lost112:F2:1',
    ]);
    expect(result.nextCursor).toBe('c');
    expect(result.items.map((i) => i.photoUrls)).toEqual([
      [photo],
      undefined,
      kept,
      undefined,
    ]);
  });
  it('저장본 조회가 실패해도 목록을 그대로 돌려준다', async () => {
    const api = new InstitutionItemsService(
      {} as ExternalHttpService,
      {
        verifiedPortalItem: {
          findMany: jest.fn().mockRejectedValue(Error('db down')),
        },
      } as unknown as DatabaseService,
    );
    const result = { items: [{ ...base, id: 'lost112:F1:1', name: '이어폰' }] };
    await expect(api.withSavedPhotos(result)).resolves.toBe(result);
  });
});

describe('검색 기간 직접 설정과 가까운 순', () => {
  it('직접 고른 시작일을 일수로 바꾸고 6개월을 넘으면 전체로 본다', () => {
    expect(periodOf({ period: '30' })).toBe('30');
    const today = new Date(Date.now() + 9 * 3600000);
    const ago = (n: number) =>
      new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
    expect(periodOf({ period: 'all', from: ago(0) })).toBe('1');
    expect(periodOf({ period: 'all', from: ago(16) })).toBe('17');
    expect(periodOf({ period: 'all', from: ago(400) })).toBe('all');
  });
  it('일수 기간의 시작일은 6개월 경계보다 앞서지 않는다', () => {
    const ms = Date.parse('2026-11-17T03:00:00Z');
    expect(sinceFound('17', ms)).toBe('2026-11-01');
    expect(sinceFound('183', ms) >= sinceFound('all', ms)).toBe(true);
  });
  const base = {
    source: '지하철' as const,
    dateLabel: '습득일' as const,
    reference: 'V1 / 1',
    url: '',
    category: 'OTHER',
  };
  it('끝일 이후 물품을 빼고 다음 페이지 값은 유지한다', () => {
    const api = new InstitutionItemsService({} as ExternalHttpService);
    const result = api.untilDay(
      {
        items: [
          {
            ...base,
            id: 'a',
            name: 'A',
            storage: '혜화역(4호선)',
            date: '2026-11-10',
          },
          {
            ...base,
            id: 'b',
            name: 'B',
            storage: '혜화역(4호선)',
            date: '2026-11-16',
          },
        ],
        nextCursor: 'n',
      },
      '2026-11-12',
    );
    expect(result.items.map((i) => i.id)).toEqual(['a']);
    expect(result.nextCursor).toBe('n');
  });
  it('보관처 위치를 찾은 물품에만 거리를 붙인다', async () => {
    const saved = process.env.KAKAO_REST_API_KEY;
    process.env.KAKAO_REST_API_KEY = 'test';
    try {
      const api = new InstitutionItemsService({} as ExternalHttpService);
      const lookup = jest
        .spyOn(
          api as unknown as { storagePoint: (n: string) => Promise<unknown> },
          'storagePoint',
        )
        .mockImplementation(async (name: string) =>
          name === '혜화역(4호선)'
            ? { lat: 37.5822, lng: 127.0019 }
            : undefined,
        );
      const result = await api.withDistances(
        {
          items: <InstitutionItem[]>[
            {
              ...base,
              id: 'a',
              name: 'A',
              storage: '혜화역(4호선)',
              date: '2026-11-10',
            },
            {
              ...base,
              id: 'b',
              name: 'B',
              storage: '알 수 없는 곳',
              date: '2026-11-10',
            },
          ],
        },
        '37.5884,127.0060',
      );
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(result.items[0].distanceM).toBeGreaterThan(500);
      expect(result.items[0].distanceM).toBeLessThan(1000);
      expect(result.items[1]).not.toHaveProperty('distanceM');
    } finally {
      process.env.KAKAO_REST_API_KEY = saved;
    }
  });
});
