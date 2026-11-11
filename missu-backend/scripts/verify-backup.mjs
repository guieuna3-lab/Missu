/** 새 임시 DB에만 복원해 행 수를 검증합니다. 기존 개발·시험 DB는 덮어쓰지 않습니다. */
import 'dotenv/config';
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomBytes, createHash, createDecipheriv } from 'node:crypto';
import { parse } from 'dotenv';
const url = new URL(process.env.DATABASE_URL ?? ''),
  folder = resolve(process.argv[2] ?? '');
if (
  url.hostname !== '127.0.0.1' ||
  url.pathname !== '/missu_dev' ||
  process.env.NODE_ENV === 'production'
)
  throw new Error('로컬 개발 DB에서만 검증합니다.');
if (!folder.startsWith(resolve('.local/backups') + sep))
  throw new Error('.local/backups 안의 백업 폴더가 필요합니다.');
const manifest = JSON.parse(
  await readFile(resolve(folder, 'manifest.json'), 'utf8'),
);
const target = 'missu_restore_check_' + randomBytes(8).toString('hex');
const admin = new Client({
  host: url.hostname,
  port: Number(url.port),
  user: 'missu_admin',
  database: 'postgres',
  password: (await readFile('.local/admin-password.txt', 'utf8')).trim(),
  connectionTimeoutMillis: 5000,
});
let created = false;
await admin.connect();
try {
  await admin.query('CREATE DATABASE "' + target + '" OWNER missu_app');
  created = true;
  const restored = spawnSync(
    resolve('.local/pgsql/bin/pg_restore.exe'),
    [
      '-h',
      url.hostname,
      '-p',
      url.port,
      '-U',
      decodeURIComponent(url.username),
      '-d',
      target,
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      resolve(folder, 'database.dump'),
    ],
    {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 120000,
      encoding: 'utf8',
    },
  );
  if (restored.status !== 0) throw new Error('임시 DB 복원 실패');
  const copy = new URL(url);
  copy.pathname = '/' + target;
  const client = new Client({
    connectionString: copy.toString(),
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    for (const [table, expected] of Object.entries(manifest.counts)) {
      if (
        !['users', 'found_items', 'item_photos', 'claims', 'messages'].includes(
          table,
        )
      )
        throw new Error('알 수 없는 검증 테이블');
      const actual = Number(
        (await client.query('SELECT count(*) AS count FROM "' + table + '"'))
          .rows[0].count,
      );
      if (actual !== expected) throw new Error('백업 검증 불일치: ' + table);
    }
    for (const photo of manifest.photoFiles ?? []) {
      if (!/^[a-f0-9-]{36}\.webp$/.test(photo.key))
        throw new Error('잘못된 사진 백업 키');
      const bytes = await readFile(resolve(folder, 'photos', photo.key));
      if (createHash('sha256').update(bytes).digest('hex') !== photo.sha256)
        throw new Error('사진 백업 검증 실패');
    }
    const privateEnv = parse(await readFile(resolve(folder, 'private.env')));
    const secret = (
      await client.query(
        'SELECT features_ciphertext FROM found_item_secrets LIMIT 1',
      )
    ).rows[0];
    if (secret) {
      const [version, iv, tag, ciphertext] =
        secret.features_ciphertext.split('.');
      if (version !== 'v1') throw new Error('알 수 없는 암호화 버전');
      const cipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(privateEnv.PII_KEY, 'hex'),
        Buffer.from(iv, 'hex'),
      );
      cipher.setAuthTag(Buffer.from(tag, 'hex'));
      cipher.update(Buffer.from(ciphertext, 'hex'));
      cipher.final();
    }
  } finally {
    await client.end();
  }
  console.log('새 임시 DB 복원·행 수·사진 무결성·암호화 키 검증 성공');
} finally {
  if (created && /^missu_restore_check_[a-f0-9]{16}$/.test(target))
    await admin.query('DROP DATABASE "' + target + '" WITH (FORCE)');
  await admin.end();
}
