/** 개발 DB·로컬 사진·복원에 필요한 비밀 설정을 PC 안의 비공개 백업 폴더에 보관합니다. */
import 'dotenv/config';
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  url.hostname !== '127.0.0.1' ||
  url.pathname !== '/missu_dev' ||
  process.env.NODE_ENV === 'production'
)
  throw new Error('이 명령은 로컬 개발 DB 전용입니다.');
const root = process.cwd(),
  stamp =
    new Date().toISOString().replace(/[:.]/g, '-') +
    '-' +
    randomUUID().slice(0, 8);
const folder = resolve('.local/backups', stamp);
await mkdir(folder, { recursive: true, mode: 0o700 });
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
const pgArgs = [
  '-h',
  url.hostname,
  '-p',
  url.port || '5432',
  '-U',
  decodeURIComponent(url.username),
  '-d',
  url.pathname.slice(1),
];
const storage = process.env.STORAGE_PROVIDER ?? 'local';
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
await client.connect();
const counts = {},
  photoFiles = [];
try {
  // pg_dump와 행 수·사진 목록을 같은 DB 스냅샷에서 읽어 백업 중 새 등록이 생겨도 일치시킵니다.
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot = (
    await client.query('SELECT pg_export_snapshot() AS snapshot')
  ).rows[0].snapshot;
  const dumped = spawnSync(
    resolve('.local/pgsql/bin/pg_dump.exe'),
    [
      ...pgArgs,
      '--format=custom',
      '--no-owner',
      '--no-acl',
      // 이동 경로는 48시간 뒤 백업에서 되살아나지 않도록 데이터 백업 대상에서 제외합니다.
      '--exclude-table-data=public.route_points',
      '--exclude-table-data=public.route_recordings',
      '--snapshot=' + snapshot,
      '--file=' + resolve(folder, 'database.dump'),
    ],
    {
      env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 120000,
      encoding: 'utf8',
    },
  );
  if (dumped.status !== 0)
    throw new Error('DB 백업에 실패했습니다. 미완성 폴더를 확인하세요.');
  for (const table of [
    'users',
    'found_items',
    'item_photos',
    'claims',
    'messages',
  ]) {
    if (
      (await client.query('SELECT to_regclass($1) AS relation', [table]))
        .rows[0].relation
    )
      counts[table] = Number(
        (await client.query('SELECT count(*) AS count FROM "' + table + '"'))
          .rows[0].count,
      );
  }
  if (storage === 'local') {
    const photos = resolve(process.env.STORAGE_PATH ?? '.local/photos');
    if (!photos.startsWith(root + sep))
      throw new Error('프로젝트 밖 사진 경로는 자동 백업하지 않습니다.');
    await mkdir(resolve(folder, 'photos'));
    const rows = (await client.query('SELECT object_key FROM item_photos'))
      .rows;
    for (const row of rows) {
      if (!/^[a-f0-9-]{36}\.webp$/.test(row.object_key))
        throw new Error('사진 키를 확인하세요.');
      const bytes = await readFile(resolve(photos, row.object_key));
      await writeFile(resolve(folder, 'photos', row.object_key), bytes, {
        flag: 'wx',
      });
      photoFiles.push({
        key: row.object_key,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  await copyFile('.env', resolve(folder, 'private.env'));
  await writeFile(
    resolve(folder, 'manifest.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        database: 'missu_dev',
        counts,
        storage,
        photoFiles,
        photosCopied: storage === 'local',
        containsSecrets: true,
        excludedTemporaryData: ['route_points', 'route_recordings'],
        requiresQuiescedCleanup: true,
      },
      null,
      2,
    ),
  );
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
console.log('로컬 개발 백업: ' + folder);
console.log(
  'private.env에는 비밀 설정이 있습니다. 소스 전달 ZIP에는 넣지 않습니다.',
);
