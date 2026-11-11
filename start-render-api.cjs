'use strict';

const { createHash } = require('node:crypto');
const { resolve } = require('node:path');

// Render에서 보관하는 두 비밀값을 각각 서버가 요구하는 32바이트 키로 변환합니다.
for (const key of ['PII_KEY', 'SIGNING_KEY']) {
  const seed = process.env[key + '_SEED'];
  if (!seed || seed.length < 32) throw new Error(key + '_SEED 설정을 확인하세요.');
  process.env[key] = createHash('sha256').update(seed).digest('hex');
}

// 모바일 앱은 Bearer 토큰을 사용합니다. 별도 웹 프론트가 있으면 운영 Origin을 명시합니다.
const url = new URL(process.env.RENDER_EXTERNAL_URL);
if (url.protocol !== 'https:') throw new Error('Render HTTPS 주소가 필요합니다.');
process.env.ALLOWED_ORIGINS ||= url.origin;
process.chdir(resolve(__dirname, 'missu-backend'));
require('./missu-backend/dist/main.js');
