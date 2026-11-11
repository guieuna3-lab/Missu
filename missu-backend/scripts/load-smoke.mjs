/** 전용 시험 DB에서 1만 물품·각 3장 사진 메타데이터로 검색/상세/지도/분실 신고 부하를 측정합니다. */
import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { setupApp } from '../dist/setup-app.js';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  url.hostname !== '127.0.0.1' ||
  !['/missu_dev', '/missu_test'].includes(url.pathname)
)
  throw new Error('로컬 시험 DB만 허용합니다.');
url.pathname = '/missu_test';
Object.assign(process.env, {
  DATABASE_URL: url.toString(),
  NODE_ENV: 'test',
  EMAIL_PROVIDER: 'local',
  SMS_PROVIDER: 'local',
  STORAGE_PROVIDER: 'local',
  PLACE_PROVIDER: 'disabled',
});
const warmupSeconds = Number(process.env.LOAD_WARMUP_SECONDS ?? 60),
  measureSeconds = Number(process.env.LOAD_MEASURE_SECONDS ?? 300);
if (
  ![warmupSeconds, measureSeconds].every(
    (x) => Number.isInteger(x) && x > 0 && x <= 600,
  )
)
  throw new Error('시험 시간 설정이 올바르지 않습니다.');
const db = new Client({
  connectionString: url.toString(),
  connectionTimeoutMillis: 5000,
});
const userId = randomUUID(),
  suffix = randomUUID().slice(0, 8),
  search = '부하시험' + suffix;
const passwordHash = createHash('sha256').update(randomBytes(32)).digest('hex');
const sessions = Array.from({ length: 30 }, () => ({
  raw: randomBytes(32).toString('hex'),
  csrf: randomBytes(32).toString('hex'),
}));
let app,
  ids = [],
  seeded = false;
const results = { read: [], write: [], failures: 0, statuses: {}, total: 0 };
await db.connect();
try {
  await db.query('BEGIN');
  await db.query(
    'INSERT INTO users(id,email,nickname,password_hash,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now())',
    [userId, suffix + '@load.missu.test', '부하시험회원', passwordHash],
  );
  await db.query(
    "INSERT INTO found_items(id,keeper_id,name,category,found_at,found_label,lat,lng,storage_place,updated_at) SELECT gen_random_uuid(),$1::uuid,$2||n::text,'ELECTRONICS',now()-interval '1 hour','합성 부하 시험 위치',37.58+(n%100)::numeric/20000,127.01+(n/100)::numeric/20000,'합성 시험 보관함',now() FROM generate_series(1,10000) AS n",
    [userId, search],
  );
  await db.query(
    "INSERT INTO item_photos(id,uploader_id,item_id,object_key,mime,byte_size,width,height,state,sort_order) SELECT gen_random_uuid(),$1::uuid,f.id,gen_random_uuid()::text||'.webp','image/webp',1,1,1,'ATTACHED',n FROM found_items f CROSS JOIN generate_series(0,2) AS n WHERE f.keeper_id=$1::uuid",
    [userId],
  );
  for (const value of sessions)
    await db.query(
      "INSERT INTO sessions(id,user_id,token_digest,csrf_digest,expires_at) VALUES(gen_random_uuid(),$1,$2,$3,now()+interval '1 hour')",
      [
        userId,
        createHash('sha256').update(value.raw).digest('hex'),
        createHash('sha256').update(value.csrf).digest('hex'),
      ],
    );
  await db.query('COMMIT');
  seeded = true;
  ids = (
    await db.query('SELECT id FROM found_items WHERE keeper_id=$1 LIMIT 100', [
      userId,
    ])
  ).rows.map((x) => x.id);
  app = await NestFactory.create(AppModule, { logger: false });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(),
    origin = 'http://localhost:3000';
  const lostTime = {
    start: new Date(Date.now() - 3600000).toISOString(),
    end: new Date(Date.now() - 3600000).toISOString(),
    precision: 'EXACT',
  };
  const body = JSON.stringify({
    name: '부하신고',
    lostTime,
    lostLocation: { label: '합성 시험 위치', lat: 37.582, lng: 127.01 },
  });
  async function phase(seconds, measure) {
    const until = Date.now() + seconds * 1000;
    await Promise.all(
      sessions.map(async (session, worker) => {
        let sequence = worker;
        while (Date.now() < until) {
          const write = sequence % 10 === 0;
          const path = write
            ? '/api/v1/lost-reports'
            : sequence % 3 === 0
              ? '/api/v1/items/' + ids[sequence % ids.length]
              : sequence % 3 === 1
                ? '/api/v1/items?q=' + encodeURIComponent(search) + '&limit=20'
                : '/api/v1/items/nearby?lat=37.582&lng=127.012&radiusM=1000&q=' +
                  encodeURIComponent(search);
          const start = performance.now();
          let status = 0;
          try {
            const response = await fetch(base + path, {
              method: write ? 'POST' : 'GET',
              signal: AbortSignal.timeout(15000),
              headers: {
                Origin: origin,
                Cookie: 'mishu_session=' + session.raw,
                'X-CSRF-Token': session.csrf,
                'Idempotency-Key': randomUUID(),
                'Content-Type': 'application/json',
              },
              body: write ? body : undefined,
            });
            status = response.status;
            await response.arrayBuffer();
          } catch {
            /* 시간 초과도 실패율에 포함합니다. */
          }
          if (measure) {
            results[write ? 'write' : 'read'].push(performance.now() - start);
            results.total++;
            results.statuses[status] = (results.statuses[status] ?? 0) + 1;
            if (status !== (write ? 201 : 200)) results.failures++;
          }
          sequence++;
        }
      }),
    );
  }
  console.log(
    '부하 시험 준비: 합성 물품 10000건 / 사진 메타데이터 30000건 / 동시 요청자 30명',
  );
  console.log('예열 ' + warmupSeconds + '초 시작');
  await phase(warmupSeconds, false);
  const began = Date.now(),
    progress = setInterval(
      () =>
        console.log(
          '측정 ' +
            Math.floor((Date.now() - began) / 1000) +
            '초 / 처리 ' +
            results.total +
            '건',
        ),
      30000,
    );
  try {
    await phase(measureSeconds, true);
  } finally {
    clearInterval(progress);
  }
  const p95 = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return (
      Math.round(
        sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] * 100,
      ) / 100
    );
  };
  const report = {
    verifiedAt: new Date().toISOString(),
    environment: 'Windows local PostgreSQL, test DB only',
    concurrentUsers: 30,
    foundItems: 10000,
    photoMetadata: 30000,
    warmupSeconds,
    measureSeconds,
    measured:
      '검색·상세·근처 JSON 읽기 + 분실 신고 쓰기. 사진 파일 다운로드·외부 발송·프런트엔드 제외.',
    requests: results.total,
    failures: results.failures,
    failureRate: results.failures / results.total,
    readP95Ms: p95(results.read),
    writeP95Ms: p95(results.write),
    statusCounts: results.statuses,
  };
  report.targetsPassed =
    report.readP95Ms <= 1000 &&
    report.writeP95Ms <= 1500 &&
    report.failureRate < 0.01;
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/load-report.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  if (!report.targetsPassed) process.exitCode = 1;
} finally {
  await app?.close();
  if (seeded) {
    await db.query('BEGIN');
    for (const table of [
      'audit_events',
      'idempotency_records',
      'lost_reports',
      'sessions',
    ]) {
      const field = table === 'audit_events' ? 'actor_id' : 'user_id';
      await db.query('DELETE FROM ' + table + ' WHERE ' + field + '=$1', [
        userId,
      ]);
    }
    await db.query('DELETE FROM item_photos WHERE uploader_id=$1', [userId]);
    await db.query('DELETE FROM found_items WHERE keeper_id=$1', [userId]);
    await db.query('DELETE FROM users WHERE id=$1', [userId]);
    await db.query('COMMIT');
  } else await db.query('ROLLBACK');
  await db.end();
}
