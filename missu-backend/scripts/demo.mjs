/** 실제 서버에 로그인한 뒤 합성 사진·물품을 등록하고, 다른 계정으로 조회하는 첫 시연입니다. */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const base = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('시연은 로컬 서버에서만 실행합니다.');
const accounts = JSON.parse(readFileSync('.local/demo-accounts.json', 'utf8'));
async function login(account) {
  let cookie = '',
    csrf = '';
  async function send(path, method = 'GET', body, extra = {}) {
    const headers = { Cookie: cookie, Origin: base, ...extra };
    if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
    if (body && !(body instanceof FormData))
      headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api/v1' + path, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const result = await response.json();
    if (!response.ok)
      throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
    return result;
  }
  csrf = (await send('/auth/csrf')).data.csrfToken;
  csrf = (
    await send('/auth/login', 'POST', {
      email: account.email,
      password: account.password,
    })
  ).data.csrfToken;
  return send;
}
const keeper = await login(accounts[0]),
  visitor = await login(accounts[1]);
console.log('1/4 시험 보관자·방문자 로그인 성공');
const image = await sharp({
  create: { width: 400, height: 300, channels: 3, background: '#599be8' },
})
  .png()
  .toBuffer();
const form = new FormData();
form.set('file', new Blob([image], { type: 'image/png' }), 'demo.png');
const photo = await keeper('/uploads', 'POST', form);
console.log('2/4 합성 시험 사진 업로드 성공');
const item = {
  name: '시연용 파란 물품',
  publicFeatures: '합성 데이터 · 파란색 식별 특징',
  foundAt: new Date(Date.now() - 3600000).toISOString(),
  foundLocation: { label: '한성대학교 시험 위치', lat: 37.582, lng: 127.01 },
  photoIds: [photo.data.photoId],
  storagePlace: '시험 보관함',
  pickupGuide: '실제 분실물이 아닌 개발용 예시입니다.',
  privateFeatures: '시연용 비공개 특징',
};
const created = await keeper('/items', 'POST', item, {
  'Idempotency-Key': randomUUID(),
});
console.log('3/4 습득물 PostgreSQL 저장 성공');
const detail = await visitor('/items/' + created.data.id),
  search = await visitor('/items?q=' + encodeURIComponent(item.name));
if (
  detail.data.name !== item.name ||
  !search.data.some((row) => row.id === created.data.id) ||
  'privateFeatures' in detail.data
)
  throw new Error('등록/조회 결과가 일치하지 않습니다.');
const result = {
  itemId: created.data.id,
  detailUrl: base + '/api/v1/items/' + created.data.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync('.local/last-demo.json', JSON.stringify(result, null, 2) + '\n');
console.log('4/4 다른 계정 검색·상세 조회 성공 (비공개 특징 미노출)');
console.log('브라우저 확인: ' + result.detailUrl);
