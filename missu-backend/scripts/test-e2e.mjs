/**
 * 실제 사용자 데이터를 보호하기 위해 전용 missu_test DB에서만 통합 시험을 실행합니다.
 * 개발용 missu_dev의 테이블이나 물품을 지우지 않습니다.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  url.hostname !== '127.0.0.1' ||
  url.username !== 'missu_app' ||
  url.port !== (process.env.LOCAL_DB_PORT ?? '54329') ||
  !['/missu_dev', '/missu_test'].includes(url.pathname)
)
  throw new Error('통합 시험은 전용 로컬 시험 DB에서만 실행합니다.');
url.pathname = '/missu_test';
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  NODE_ENV: 'test',
  STORAGE_PATH: '.local/test-photos',
  MISSU_TEST_DATABASE: '1',
  OUTBOX_PATH: '.local/test-outbox',
  EMAIL_PROVIDER: 'local',
  SMS_PROVIDER: 'local',
  PLACE_PROVIDER: 'disabled',
  STORAGE_PROVIDER: 'local',
  POLICY_VERSION: 'dev-v1',
};
for (const args of [
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  [
    '--experimental-vm-modules',
    'node_modules/jest/bin/jest.js',
    '--config',
    'test/jest-e2e.json',
    '--runInBand',
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env,
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
