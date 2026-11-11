/** 기본은 정리 대상 건수만 표시합니다. --apply를 붙인 경우에만 만료된 기술 데이터를 정리합니다. */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { MaintenanceService } from '../dist/maintenance/maintenance.service.js';
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const result = await app
    .get(MaintenanceService)
    .run(process.argv.includes('--apply'));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
}
