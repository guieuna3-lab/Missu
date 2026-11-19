import { searchPoint, searchRange } from './search-range';
describe('검색 기간과 기준 위치', () => {
  const at = Date.parse('2026-11-19T10:12:00+09:00');
  it('직접 고른 하루의 양 끝과 서울 날짜를 포함한다', () => {
    const r = searchRange(
      { period: 'all', from: '2026-10-31', to: '2026-10-31' },
      at,
    );
    expect(r.fromTime.toISOString()).toBe('2026-10-30T15:00:00.000Z');
    expect(r.toTime.toISOString()).toBe('2026-10-31T14:59:59.999Z');
  });
  it('최근 7일과 달력 6개월 경계를 사용한다', () => {
    expect(searchRange({ period: '7' }, at).from).toBe('2026-11-13');
    expect(searchRange({ period: 'all' }, at).from).toBe('2026-05-19');
    expect(
      searchRange({ period: 'all' }, Date.parse('2026-08-31T10:00:00+09:00'))
        .from,
    ).toBe('2026-02-28');
  });
  it('잘못된 날짜와 역전된 기간·좌표를 거부한다', () => {
    for (const from of ['2026-02-30', 'not-a-day'])
      expect(() => searchRange({ period: 'all', from }, at)).toThrow();
    expect(() =>
      searchRange({ period: 'all', from: '2026-11-10', to: '2026-11-09' }, at),
    ).toThrow();
    for (const point of ['91,127', '37,181', 'NaN,127', ',127', '1,2,3'])
      expect(() => searchPoint(point)).toThrow();
    expect(searchPoint('37.5,127')).toEqual({ lat: 37.5, lng: 127 });
  });
});
