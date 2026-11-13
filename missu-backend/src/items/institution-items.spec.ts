import { InstitutionItemsService } from './institution-items.service';
import { ExternalHttpService } from '../integrations/external-http.service';
import { NearbyDto } from './nearby.dto';

const school =
  '<table><th>작성일</th><tr><td><a href="/bbs/onestop/1718/1/artclView.do"><strong>학교에서 습득한 (이어폰) 보관중</strong></a></td><td class="td-date">2026.01.22</td></tr><tr><td><a href="/bbs/onestop/1718/2/artclView.do">이어폰 반환완료</a></td><td class="td-date">2026.01.22</td></tr></table>';
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
    process.env.DATA_GO_KR_SERVICE_KEY = 'test';
    process.env.KAKAO_REST_API_KEY = 'test';
  });
  afterEach(() => {
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
      request: async (url: string) => new Response(read(new URL(url))),
    } as ExternalHttpService);
  it('키가 없어도 학교 보관 공고와 불러오지 못한 기관을 구분한다', async () => {
    delete process.env.DATA_GO_KR_SERVICE_KEY;
    const result = await service(() => school).search('이어폰', '', 'all');
    expect(result.items.map((x) => x.id)).toEqual(['hansung:1']);
    expect(result.notices).toHaveLength(2);
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
  it('홈에서 더 볼 수 있도록 첫 10건 뒤의 보관품도 최신순으로 반환한다', async () => {
    const board =
      '<table><th>작성일</th>' +
      Array.from(
        { length: 12 },
        (_, i) =>
          '<tr><td><a href="/bbs/onestop/1718/' +
          (i + 1) +
          '/artclView.do">물품 보관중</a></td><td class="td-date">2026.01.' +
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
  it('장소 없이 지갑을 찾아도 다른 포털기관에 밀린 역 보관품을 한 번만 표시한다', async () => {
    const wallet = {
      ...row,
      fdPrdtNm: '카드지갑',
      depPlace: '한성대입구역(4호선)',
    };
    let details = 0;
    const api = service((u) => {
      if (u.host === 'www.hansung.ac.kr') return school;
      if (!u.pathname.includes('LosPtfund')) return xml([]);
      if (u.pathname.endsWith('DetailInfo')) {
        details++;
        return xml([wallet]);
      }
      expect(u.searchParams.get('PRDT_NM')).toBe('지갑');
      if (u.searchParams.has('DEP_PLACE')) return xml([wallet]);
      return xml(
        Array.from({ length: 40 }, (_, i) => ({
          ...wallet,
          atcId: 'SHOP' + i,
          depPlace: '쇼핑몰 안내센터',
        })),
      );
    });
    const result = await api.search('지갑', '', 'all');
    expect(
      result.items.filter((i) => i.source === '지하철').map((i) => i.name),
    ).toEqual(['카드지갑']);
    expect(details).toBe(1);
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
      if (u.searchParams.get('DEP_PLACE') !== '2호선') return xml([]);
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
      const a = await fetch(),
        b = await fetch(a.nextCursor!),
        c = await fetch(b.nextCursor!);
      expect([a.items.length, b.items.length, c.items.length]).toEqual([
        24, 16, 3,
      ]);
      expect(
        new Set([...a.items, ...b.items, ...c.items].map((i) => i.id)).size,
      ).toBe(43);
      expect(c.nextCursor).toBeNull();
    }
  });
});
