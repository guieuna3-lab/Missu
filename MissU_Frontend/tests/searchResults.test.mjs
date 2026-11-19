import assert from 'node:assert/strict';
import test from 'node:test';
process.env.EXPO_PUBLIC_API_URL = 'https://missu.example/api/v1';
const { searchResults } = await import('../src/lib/searchResults.ts');

test('통합 검색은 정렬·기간·장소·커서를 보내고 서버 순서와 사진을 유지한다', async () => {
  const original = globalThis.fetch;
  let called;
  globalThis.fetch = async (url) => {
    called = new URL(url);
    return new Response(
      JSON.stringify({
        data: {
          items: [
            {
              id: 'lost112:A:1',
              source: '포털기관',
              name: '에어팟',
              date: '2026-10-01',
              photoUrls: ['https://images.example/a.jpg'],
            },
            {
              id: 'member',
              name: '이어폰',
              category: 'ELECTRONICS',
              foundAt: '2026-11-01T00:00:00Z',
              foundLocation: { label: '강남역', lat: 37, lng: 127 },
              storagePlace: '보관센터',
              photos: [{ id: 'p', url: '/api/v1/photos/p' }],
              status: 'AVAILABLE',
            },
          ],
          nextCursor: 'next-signed-cursor',
          memberTotal: 1,
        },
      }),
    );
  };
  try {
    const result = await searchResults(
      { query: '이어폰', place: '강남역', period: 'custom', from: '2026-10-01', to: '2026-11-19' },
      'relevance',
      'previous-signed-cursor',
    );
    assert.equal(called.pathname, '/api/v1/search-items');
    assert.equal(called.searchParams.get('sort'), 'relevance');
    assert.equal(called.searchParams.get('cursor'), 'previous-signed-cursor');
    assert.equal(called.searchParams.get('from'), '2026-10-01');
    assert.equal(called.searchParams.get('to'), '2026-11-19');
    assert.equal(called.searchParams.get('place'), '강남역');
    assert.deepEqual(
      result.items.map((i) => i.id),
      ['lost112:A:1', 'member'],
    );
    assert.deepEqual(result.items[0].photoUrls, ['https://images.example/a.jpg']);
    assert.deepEqual(result.items[1].photoUrls, ['https://missu.example/api/v1/photos/p']);
  } finally {
    globalThis.fetch = original;
  }
});
