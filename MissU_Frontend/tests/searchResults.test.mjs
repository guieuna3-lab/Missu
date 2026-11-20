import assert from 'node:assert/strict';
import test from 'node:test';
process.env.EXPO_PUBLIC_API_URL = 'https://missu.example/api/v1';
const { searchResults, searchCount, recentResults, cachedRecentResults } =
  await import('../src/lib/searchResults.ts');

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

test('가까운순도 통합 API에 기준 좌표를 보내고 서버 거리·순서를 보존한다', async () => {
  const original = globalThis.fetch;
  let called;
  globalThis.fetch = async (url) => {
    called = new URL(url);
    return new Response(
      JSON.stringify({
        data: {
          items: [
            { id: 'old-near', source: '포털기관', name: '지갑', date: '2026-06-01', distanceM: 5 },
            { id: 'new-far', source: '포털기관', name: '지갑', date: '2026-11-19', distanceM: 500 },
          ],
          nextCursor: 'next',
        },
      }),
    );
  };
  try {
    const result = await searchResults(
      {
        query: '지갑',
        place: '강남역',
        period: 'all',
        near: { lat: 37.5, lng: 127, label: '강남역' },
      },
      'distance',
    );
    assert.equal(called.searchParams.get('near'), '37.500000,127.000000');
    assert.equal(called.searchParams.get('sort'), 'distance');
    assert.deepEqual(
      result.items.map((i) => i.id),
      ['old-near', 'new-far'],
    );
    assert.equal(result.items[0].distanceM, 5);
  } finally {
    globalThis.fetch = original;
  }
});

test('과거 직접 기간의 건수는 목록과 별도 요청이며 정렬·좌표를 보내지 않는다', async () => {
  const original = globalThis.fetch;
  let called;
  globalThis.fetch = async (url) => {
    called = new URL(url);
    return new Response(
      JSON.stringify({ data: { total: 37, notices: [], checkedAt: '2026-11-19' } }),
    );
  };
  try {
    const result = await searchCount(
      {
        query: '지갑',
        place: '강남역',
        period: 'custom',
        from: '2026-10-01',
        to: '2026-10-15',
        near: { lat: 37.5, lng: 127, label: '강남역' },
      },
      new AbortController().signal,
    );
    assert.equal(called.pathname, '/api/v1/search-items/count');
    assert.equal(called.searchParams.get('from'), '2026-10-01');
    assert.equal(called.searchParams.get('to'), '2026-10-15');
    assert.equal(called.searchParams.has('sort'), false);
    assert.equal(called.searchParams.has('near'), false);
    assert.equal(result.total, 37);
  } finally {
    globalThis.fetch = original;
  }
});

test('홈은 합쳐진 저장 목록을 한 번만 요청한다', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ data: { items: [], nextCursor: null, notices: [] } }));
  };
  try {
    await recentResults();
    assert.deepEqual(calls, ['https://missu.example/api/v1/search-items/recent']);
  } finally {
    globalThis.fetch = original;
  }
});

test('홈은 겹친 요청을 공유하며 마지막 통합 첫 페이지를 1분 동안만 재사용한다', async () => {
  const original = globalThis.fetch;
  const clock = Date.now;
  let now = clock();
  let resolve;
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  };
  try {
    const first = recentResults();
    const shared = recentResults();
    assert.equal(calls, 1);
    assert.equal(first, shared);
    resolve(
      new Response(
        JSON.stringify({
          data: {
            items: [{ id: 'hansung:1', source: '한성대', name: '지갑', date: '2026-11-20' }],
            nextCursor: 'page-2',
            notices: [],
          },
        }),
      ),
    );
    const result = await first;
    assert.equal(cachedRecentResults(), result);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { items: [], nextCursor: null } }));
    await recentResults('page-2');
    assert.equal(cachedRecentResults(), result, '더보기 응답으로 첫 목록을 덮어쓰지 않는다');
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    await assert.rejects(recentResults());
    assert.equal(cachedRecentResults(), result, '갱신 실패 시 마지막 정상 목록을 유지한다');
    now += 60001;
    assert.equal(cachedRecentResults(), undefined, '오래된 물품 목록을 계속 재사용하지 않는다');
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { items: [], nextCursor: null } }));
    assert.deepEqual((await recentResults()).items, [], '실패한 요청을 재시도할 수 있다');
  } finally {
    globalThis.fetch = original;
    Date.now = clock;
  }
});
