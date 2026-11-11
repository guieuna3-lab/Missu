/**
 * live는 서버 프로세스가 응답하는지, ready는 실제 DB와 테이블을 사용할 수 있는지 확인합니다.
 */
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './auth/auth.guard';
import { DatabaseService } from './database/database.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      await this.db.$queryRaw`SELECT 1 FROM users LIMIT 1`;
      await this.db.$queryRaw`SELECT 1 FROM found_items LIMIT 1`;
      await this.db.$queryRaw`SELECT 1 FROM auth_challenges LIMIT 1`;
      await this.db.$queryRaw`SELECT 1 FROM claims LIMIT 1`;
      return { status: 'ok', database: 'connected' };
    } catch {
      throw new ServiceUnavailableException('Database not ready');
    }
  }
}
