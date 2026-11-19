import type { DatabaseService } from '../database/database.service';
import { itemSearch } from './item-search';
import { portalRanked } from './search-portal-rank';

describe('작은 묶음으로 읽는 전체 정렬', () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({
    id: 'lost112:QA' + String(i).padStart(4, '0') + ':1',
    day: '2026-11-18',
    name: '이어폰 검정',
    features: '',
    storage: '보관센터',
  }));
  const exact = {
    id: 'lost112:QALAST:1',
    day: '2026-08-01',
    name: '이어폰',
    features: '',
    storage: '보관센터',
  };
  function database(failSecond = false) {
    return {
      $transaction: async (read: (tx: unknown) => Promise<unknown>) => {
        let n = 0;
        return read({
          $executeRaw: jest.fn().mockResolvedValue(0),
          $queryRaw: async () => {
            if (n++ === 0) return rows;
            if (failSecond) throw Error('read failed');
            return [exact];
          },
        });
      },
    } as unknown as DatabaseService;
  }
  it('2,000건 뒤의 정확한 일치가 첫 페이지에 오고 다음 페이지 경계도 유지한다', async () => {
    const db = database();
    const first = await portalRanked(
      db,
      itemSearch('이어폰'),
      '2026-05-19',
      '2026-11-19',
      'relevance',
      Date.now(),
    );
    expect(first).toHaveLength(26);
    expect(first[0]).toEqual({ id: exact.id, day: exact.day, score: 1000 });
    expect(first[25].id).toBe(rows[24].id);
    const next = await portalRanked(
      db,
      itemSearch('이어폰'),
      '2026-05-19',
      '2026-11-19',
      'relevance',
      Date.now(),
      first[24],
    );
    expect(next[0].id).toBe(rows[24].id);
    expect(next.some((i) => i.id === exact.id)).toBe(false);
  });
  it('뒤쪽 묶음 읽기가 실패하면 일부만 읽은 결과를 정상 목록으로 내보내지 않는다', async () => {
    await expect(
      portalRanked(
        database(true),
        itemSearch('이어폰'),
        '2026-05-19',
        '2026-11-19',
        'relevance',
        Date.now(),
      ),
    ).rejects.toThrow('read failed');
  });
});
