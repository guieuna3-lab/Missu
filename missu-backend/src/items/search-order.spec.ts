import { itemSearch } from './item-search';
import {
  compareRank,
  relevanceScore,
  relevanceSql,
  searchWhereSql,
} from './search-order';
import { Prisma } from '../generated/prisma/client';
import { completeSchool, readSearchPosition, searchCursor } from './search-results.service';

describe('전체 결과 정렬', () => {
  it('학교 목록의 일시 실패는 재시도하고 지속 장애를 빈 목록으로 바꾸지 않는다', async () => {
    let attempts = 0;
    await expect(completeSchool(async () => {
      if (++attempts === 1) throw Error('temporary');
      return ['school item'];
    })).resolves.toEqual(['school item']);
    expect(attempts).toBe(2);
    await expect(completeSchool(async () => { throw Error('unavailable'); })).rejects.toMatchObject({status: 503});
  });
  const score = (name: string, query: string, features = '') =>
    relevanceScore(name, features, itemSearch(query));
  it('같은 물품의 다른 이름과 세부 제품명을 평가한다', () => {
    expect(score('휴대폰', '핸드폰')).toBe(960);
    expect(score('에어팟', '이어폰')).toBe(960);
    expect(score('버즈', '이어폰')).toBe(960);
    expect(score('이어폰', '이어폰')).toBeGreaterThan(
      score('에어팟', '이어폰'),
    );
    expect(score('이어폰', '에어팟')).toBe(0);
    expect(score('귀고리', '귀걸이')).toBe(960);
    expect(score('검정 에어팟', '검정 이어폰')).toBeGreaterThan(
      score('에어팟', '검정 이어폰', '검정'),
    );
  });
  it('물품명과 장소를 분리해 장소가 점수를 떨어뜨리지 않는다', () => {
    expect(score('휴대폰', '핸드폰 강남역')).toBe(score('휴대폰', '핸드폰'));
  });
  it('날짜가 같으면 출처와 무관한 고정 관리번호 순서를 사용한다', () => {
    const keys = [
      { id: 'lost112:X:1', day: '2026-11-18', score: 960 },
      { id: 'hansung:1', day: '2026-11-18', score: 960 },
      { id: 'a', day: '2026-11-17', score: 1000 },
    ];
    expect(keys.sort(compareRank).map((i) => i.id)).toEqual([
      'a',
      'hansung:1',
      'lost112:X:1',
    ]);
  });
  it('검색 문자열을 SQL 코드로 삽입하지 않는다', () => {
    const search = itemSearch("지갑%' OR 1=1 --", "강남역%'");
    const queries = [
      searchWhereSql(search, true),
      searchWhereSql(search, false),
      relevanceSql(Prisma.sql`name`, Prisma.sql`kind_name`, search),
    ];
    for (const query of queries) expect(query.text).not.toContain('OR 1=1');
  });
  it('정렬·필터가 바뀌거나 변조된 다음 페이지는 거부한다', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/unit_test';
    process.env.PII_KEY = '1'.repeat(64);
    process.env.SIGNING_KEY = '2'.repeat(64);
    const now = Date.now();
    const p = {
      id: 'lost112:X:1',
      day: '2026-11-18',
      score: 960,
      scope: 'query1',
      at: now,
    };
    const cursor = searchCursor(p);
    expect(readSearchPosition(cursor, 'query1', now)).toEqual(p);
    expect(() => readSearchPosition(cursor, 'query2', now)).toThrow();
    expect(() => readSearchPosition(cursor + 'x', 'query1', now)).toThrow();
    expect(() => readSearchPosition(cursor, 'query1', now + 3600001)).toThrow();
  });
});
