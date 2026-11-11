/**
 * 이메일 발송 연동 전, 로컬 개발 DB에만 합성 시험 계정을 만듭니다.
 * 실제 가입·이메일 인증 성공을 의미하지 않습니다. 운영 DB에서는 실행할 수 없습니다.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { hash, Algorithm } from '@node-rs/argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const url = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.NODE_ENV === 'production' ||
  url.hostname !== '127.0.0.1' ||
  url.pathname !== '/missu_dev'
)
  throw new Error('합성 시험 계정은 로컬 missu_dev에서만 만들 수 있습니다.');
const path = '.local/demo-accounts.json';
mkdirSync('.local', { recursive: true });
const accounts = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : [
      {
        email: 'keeper@missu.test',
        nickname: '시험보관자',
        password: 'Demo-' + randomBytes(12).toString('hex'),
      },
      {
        email: 'visitor@missu.test',
        nickname: '시험방문자',
        password: 'Demo-' + randomBytes(12).toString('hex'),
      },
    ];
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const account of accounts) {
    if (
      (
        await client.query('SELECT 1 FROM users WHERE email=$1', [
          account.email,
        ])
      ).rowCount
    )
      continue;
    const passwordHash = await hash(account.password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await client.query(
      'INSERT INTO users(id,email,nickname,password_hash,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now())',
      [randomUUID(), account.email, account.nickname, passwordHash],
    );
  }
  writeFileSync(path, JSON.stringify(accounts, null, 2) + '\n');
  console.log(
    '합성 시험 계정 준비 완료. 로그인 정보: .local/demo-accounts.json (실제 이메일 인증 결과가 아닙니다.)',
  );
} finally {
  await client.end();
}
