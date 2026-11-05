/**
 * Windows 개발용 PostgreSQL을 시작하고 초기 DB를 준비합니다.
 * 기존 .env와 DB를 임의로 초기화하지 않습니다. 관리자 계정은 설정에만 쓰고 앱에는 제한된 계정을 줍니다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { parse } from 'dotenv';

const root = process.cwd(),
  local = resolve(root, '.local'),
  bin = resolve(local, 'pgsql/bin'),
  data = resolve(local, 'postgres-data');
const command = process.argv[2] ?? 'start',
  port = 54329;
mkdirSync(local, { recursive: true });
function run(exe, args, quiet = false) {
  const result = spawnSync(resolve(bin, exe + '.exe'), args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    stdio: quiet ? 'ignore' : 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${exe} 실패: ${result.stderr ?? result.error ?? result.stdout}`,
    );
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
}
if (!existsSync(resolve(bin, 'pg_ctl.exe')))
  throw new Error(
    '.local/pgsql에 PostgreSQL 실행 파일이 필요합니다. docs/LOCAL_SETUP.md를 확인하세요.',
  );
if (command === 'stop') {
  run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  process.exit(0);
}
let settings = existsSync('.env') ? parse(readFileSync('.env')) : null;
if (!existsSync(resolve(data, 'PG_VERSION'))) {
  if (command !== 'setup')
    throw new Error('먼저 npm run local:setup을 실행하세요.');
  const adminPassword = randomBytes(32).toString('hex');
  writeFileSync(resolve(local, 'admin-password.txt'), adminPassword, {
    flag: 'wx',
  });
  run(
    'initdb',
    [
      '-D',
      data,
      '-U',
      'missu_admin',
      '--encoding=UTF8',
      '--no-locale',
      '--auth=scram-sha-256',
      '--pwfile=' + resolve(local, 'admin-password.txt'),
    ],
    true,
  );
}
const status = spawnSync(resolve(bin, 'pg_ctl.exe'), ['-D', data, 'status'], {
  encoding: 'utf8',
  windowsHide: true,
});
if (status.status !== 0)
  run(
    'pg_ctl',
    [
      '-D',
      data,
      '-l',
      resolve(local, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ],
    true,
  );
if (command === 'setup') {
  const client = new Client({
    host: '127.0.0.1',
    port,
    user: 'missu_admin',
    database: 'postgres',
    password: readFileSync(resolve(local, 'admin-password.txt'), 'utf8').trim(),
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    let appPassword;
    if (settings) {
      const url = new URL(settings.DATABASE_URL);
      if (
        url.hostname !== '127.0.0.1' ||
        url.port !== String(port) ||
        url.username !== 'missu_app' ||
        url.pathname !== '/missu_dev'
      )
        throw new Error(
          '기존 .env가 이 로컬 DB 설정과 다릅니다. 덮어쓰지 않았습니다.',
        );
      appPassword = decodeURIComponent(url.password);
    } else {
      appPassword = randomBytes(32).toString('hex');
      if (
        (await client.query("SELECT 1 FROM pg_roles WHERE rolname='missu_app'"))
          .rowCount
      )
        throw new Error(
          '기존 DB 계정이 있으나 .env가 없습니다. 자동 변경을 중지합니다.',
        );
    }
    if (
      !(await client.query("SELECT 1 FROM pg_roles WHERE rolname='missu_app'"))
        .rowCount
    ) {
      // Password is generated hexadecimal, never user-controlled SQL.
      if (!/^[a-f0-9]{64}$/.test(appPassword))
        throw new Error('Invalid generated password');
      await client.query(
        `CREATE ROLE missu_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
      );
    }
    for (const database of ['missu_dev', 'missu_test']) {
      if (
        !(
          await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [
            database,
          ])
        ).rowCount
      )
        await client.query(`CREATE DATABASE ${database} OWNER missu_app`);
    }
    if (!settings) {
      const lines = [
        `DATABASE_URL=postgresql://missu_app:${appPassword}@127.0.0.1:${port}/missu_dev`,
        'NODE_ENV=development',
        'PORT=3000',
        'HOST=127.0.0.1',
        'ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173',
        'STORAGE_PATH=.local/photos',
        `PII_KEY=${randomBytes(32).toString('hex')}`,
        `SIGNING_KEY=${randomBytes(32).toString('hex')}`,
      ];
      writeFileSync('.env', lines.join('\n') + '\n', { flag: 'wx' });
    }
  } finally {
    await client.end();
  }
}
console.log(
  `PostgreSQL 준비 완료: 127.0.0.1:${port} (개발 DB missu_dev / 시험 DB missu_test)`,
);
