/** 로컬 인증 대역으로 가입부터 실제 HTTP 반환 완료까지 시연합니다. 외부 발송 모드에서는 실행하지 않습니다. */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.NODE_ENV === 'production' ||
  url.hostname !== '127.0.0.1' ||
  url.pathname !== '/missu_dev' ||
  (process.env.EMAIL_PROVIDER ?? 'local') !== 'local' ||
  (process.env.SMS_PROVIDER ?? 'local') !== 'local'
)
  throw new Error(
    '전체 시연은 로컬 개발 DB와 로컬 인증 대역에서만 실행합니다.',
  );
const base = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('로컬 서버 주소가 필요합니다.');
const origin = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(
  ',',
)[0];
const policyVersion = process.env.POLICY_VERSION ?? 'dev-v1',
  path = '.local/mvp-demo-accounts.json';
mkdirSync('.local', { recursive: true });
const accounts = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : ['keeper', 'requester'].map((role, index) => ({
      email: role + '-' + randomUUID().slice(0, 8) + '@missu.test',
      nickname: index ? '시연요청자' : '시연보관자',
      password: 'Demo-' + randomBytes(16).toString('hex'),
      phone: index ? '01000000002' : '01000000001',
    }));
writeFileSync(path, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 });
const localCode = (id) =>
  JSON.parse(
    readFileSync(
      resolve(process.env.OUTBOX_PATH ?? '.local/outbox', id + '.json'),
      'utf8',
    ),
  ).code;
async function actor(account) {
  let cookie = '',
    csrf = '';
  async function send(path, method = 'GET', body, idempotent = false) {
    const headers = { Cookie: cookie, Origin: origin };
    if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
    if (idempotent) headers['Idempotency-Key'] = randomUUID();
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
      signal: AbortSignal.timeout(15000),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const result = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
      const error = new Error(
        path +
          ': HTTP ' +
          response.status +
          ' ' +
          (result.error?.code ?? 'ERROR'),
      );
      error.status = response.status;
      throw error;
    }
    return result.data;
  }
  csrf = (await send('/auth/csrf')).csrfToken;
  let login;
  try {
    login = await send('/auth/login', 'POST', {
      email: account.email,
      password: account.password,
    });
  } catch (error) {
    if (error.status !== 401) throw error;
    const challenge = await send('/auth/challenges', 'POST', {
      purpose: 'SIGNUP',
      target: account.email,
    });
    const verified = await send(
      '/auth/challenges/' + challenge.challengeId + '/verify',
      'POST',
      { code: localCode(challenge.challengeId) },
    );
    await send('/auth/signup', 'POST', {
      email: account.email,
      nickname: account.nickname,
      password: account.password,
      challengeId: challenge.challengeId,
      proof: verified.proof,
      consents: ['TERMS', 'PRIVACY'].map((kind) => ({
        kind,
        policyVersion,
        agreed: true,
      })),
    });
    login = await send('/auth/login', 'POST', {
      email: account.email,
      password: account.password,
    });
  }
  csrf = login.csrfToken;
  if (!(await send('/me')).phoneVerified) {
    const challenge = await send('/auth/challenges', 'POST', {
      purpose: 'PHONE',
      target: account.phone,
      consent: { kind: 'PHONE', policyVersion, agreed: true },
    });
    await send(
      '/auth/challenges/' + challenge.challengeId + '/verify',
      'POST',
      { code: localCode(challenge.challengeId) },
    );
  }
  return send;
}
const keeper = await actor(accounts[0]),
  requester = await actor(accounts[1]);
console.log('1/6 회원가입·로그인·전화 인증 완료 (이메일/SMS는 로컬 대역)');
const png = await sharp({
  create: { width: 400, height: 300, channels: 3, background: '#f5ad47' },
})
  .png()
  .toBuffer();
const form = new FormData();
form.set('file', new Blob([png], { type: 'image/png' }), 'demo.png');
const photo = await keeper('/uploads', 'POST', form);
const item = await keeper(
  '/items',
  'POST',
  {
    name: '전체 시연용 물품',
    publicFeatures: '주황색 합성 사진',
    foundAt: new Date(Date.now() - 3600000).toISOString(),
    foundLocation: { label: '한성대학교 시험 위치', lat: 37.582, lng: 127.01 },
    photoIds: [photo.photoId],
    storagePlace: '시험 보관함',
    privateFeatures: '개발 시연용 비공개 단서',
  },
  true,
);
console.log('2/6 사진 업로드·습득물 저장 완료');
const claim = await requester(
  '/items/' + item.id + '/claims',
  'POST',
  {
    features: '개발 시연용 소유 특징',
    lostTime: {
      start: new Date(Date.now() - 7200000).toISOString(),
      end: new Date(Date.now() - 3600000).toISOString(),
      precision: 'APPROX',
    },
    lostLocation: { label: '한성대학교 시험 위치', lat: 37.582, lng: 127.01 },
  },
  true,
);
const report = await keeper(
  '/claims/' + claim.claimId + '/reports',
  'POST',
  { reason: '실제 신고가 아닌 개발용 접수 시연입니다.' },
  true,
);
await keeper(
  '/claims/' + claim.claimId + '/decision',
  'POST',
  { decision: 'APPROVE' },
  true,
);
console.log('3/6 주인 확인 요청·신고 접수·승인 완료');
await requester('/claims/' + claim.claimId + '/messages', 'POST', {
  body: '시험 보관함에서 만나겠습니다.',
  clientMessageId: randomUUID(),
});
await keeper('/claims/' + claim.claimId + '/messages', 'POST', {
  body: '네, 개발 시연용 대화입니다.',
  clientMessageId: randomUUID(),
});
console.log('4/6 승인된 두 계정의 대화 저장 완료');
const handed = await keeper(
  '/claims/' + claim.claimId + '/handover',
  'POST',
  {},
  true,
);
if (handed.itemStatus !== 'RESERVED')
  throw new Error('전달만으로 반환 완료가 되면 안 됩니다.');
await requester('/claims/' + claim.claimId + '/receipt', 'POST', {}, true);
console.log('5/6 보관자 전달 후 요청자 수령 확인 완료');
const detail = await requester('/items/' + item.id),
  messages = await requester('/claims/' + claim.claimId + '/messages');
if (
  detail.status !== 'RETURNED' ||
  messages.messages.length !== 2 ||
  'privateFeatures' in detail
)
  throw new Error('최종 상태 검증 실패');
writeFileSync(
  '.local/last-mvp-demo.json',
  JSON.stringify(
    {
      itemId: item.id,
      claimId: claim.claimId,
      reportId: report.reportId,
      detailUrl: base + '/api/v1/items/' + item.id,
      status: detail.status,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log('6/6 RETURNED 상태·대화 조회·비공개 필드 제외 확인');
console.log('상세 주소: ' + base + '/api/v1/items/' + item.id);
