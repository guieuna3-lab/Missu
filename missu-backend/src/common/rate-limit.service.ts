/** 시도 횟수를 DB에서 원자적으로 관리합니다. 주소·이메일 원문 대신 키 HMAC만 저장합니다. */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { sign } from './crypto';
import { fail } from './http';

@Injectable()
export class RateLimitService {
  constructor(private readonly db: DatabaseService) {}
  async consume(key: string, maximum: number, windowMs: number) {
    const id = sign('rate:' + key);
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        id,
      );
      const old = await tx.rateLimitBucket.findUnique({ where: { id } });
      const now = new Date();
      if (old && old.expiresAt > now && old.count >= maximum) return false;
      await tx.rateLimitBucket.upsert({
        where: { id },
        create: { id, count: 1, expiresAt: new Date(+now + windowMs) },
        update:
          old && old.expiresAt > now
            ? { count: { increment: 1 } }
            : { count: 1, expiresAt: new Date(+now + windowMs) },
      });
      return true;
    });
    if (!result)
      fail(429, 'RATE_LIMITED', '시도가 많습니다. 잠시 후 다시 시도하세요.');
  }
  async reset(key: string) {
    await this.db.rateLimitBucket.deleteMany({
      where: { id: sign('rate:' + key) },
    });
  }
}
