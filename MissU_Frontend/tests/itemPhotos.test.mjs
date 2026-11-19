import assert from 'node:assert/strict';
import test from 'node:test';
process.env.EXPO_PUBLIC_API_URL = 'https://missu.example/api/v1';
const { displayPhotoUrls, loadItemPhotos, thumbnailPhotoUrl } =
  await import('../src/lib/itemPhotos.ts');

test('미리보기는 학교 이미지 API에만 적용하고 상세·회원·외부 URL을 보존', () => {
  const full = displayPhotoUrls('hansung:226144', ['https://www.hansung.ac.kr/file'])[0];
  assert.equal(thumbnailPhotoUrl(full), full + '?size=thumb');
  for (const uri of [
    'https://images.example/a.jpg',
    'https://missu.example/api/v1/photos/a?signature=keep',
  ])
    assert.equal(thumbnailPhotoUrl(uri), uri);
  assert.equal(displayPhotoUrls('hansung:226144', ['https://www.hansung.ac.kr/file'])[0], full);
});
test('학교 다운로드는 이미지 API, 회원 상대 사진은 같은 서버로 연결', () => {
  assert.deepEqual(displayPhotoUrls('hansung:226144', ['https://www.hansung.ac.kr/file']), [
    'https://missu.example/api/v1/institution-items/image/hansung%3A226144/0',
  ]);
  assert.deepEqual(displayPhotoUrls('member', ['/api/v1/photos/a']), [
    'https://missu.example/api/v1/photos/a',
  ]);
  assert.deepEqual(displayPhotoUrls('lost112:F1:1', ['https://minwon24.police.go.kr/a.jpg']), [
    'https://minwon24.police.go.kr/a.jpg',
  ]);
});
test('목록과 상세 사진 조회를 공유하고 실패·만료 후에는 새 주소를 조회', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ data: ['https://images.example/' + calls + '.jpg'] }));
  };
  try {
    const [a, b] = await Promise.all([
      loadItemPhotos('lost112:F100:1'),
      loadItemPhotos('lost112:F100:1'),
    ]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    await loadItemPhotos('lost112:F100:1');
    assert.equal(calls, 1);
    assert.deepEqual(await loadItemPhotos('lost112:F100:1', true), [
      'https://images.example/2.jpg',
    ]);
    globalThis.fetch = async () => new Response('error', { status: 503 });
    await assert.rejects(loadItemPhotos('lost112:F100:1', true));
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }));
    assert.deepEqual(await loadItemPhotos('lost112:F100:1'), []);
  } finally {
    globalThis.fetch = original;
  }
});
