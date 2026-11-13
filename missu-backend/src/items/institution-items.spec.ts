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
});
