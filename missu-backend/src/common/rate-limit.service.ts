/** 시도 횟수를 DB에서 원자적으로 관리합니다. 주소·이메일 원문 대신 키 HMAC만 저장합니다. */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { sign } from './crypto';
import { fail } from './http';

export type RateLimit = {
  key: string;
  maximum: number;
  windowMs: number;
  reason?: string;
};

@Injectable()
export class RateLimitService {
  constructor(private readonly db: DatabaseService) {}
  async consume(key: string, maximum: number, windowMs: number) {
    await this.consumeAll([{ key, maximum, windowMs }]);
  }
  async consumeAll(limits: RateLimit[]) {
    const rules = limits
      .map(({ key, ...rule }) => ({ id: sign('rate:' + key), ...rule }))
      .sort((a, b) => a.id.localeCompare(b.id));
    await this.db.$transaction(async (tx) => {
      // 같은 번호·세션의 동시 요청도 모든 제한을 같은 순서로 잠그고 함께 판정합니다.
      for (const { id } of rules) {
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          id,
        );
      }
      const now = new Date();
      const active = await tx.rateLimitBucket.findMany({
        where: {
          id: { in: rules.map((rule) => rule.id) },
          expiresAt: { gt: now },
        },
      });
      const buckets = new Map(active.map((bucket) => [bucket.id, bucket]));
      let retryAt = 0;
      let reason = '요청 횟수 제한에 도달했습니다.';
      for (const rule of rules) {
        const bucket = buckets.get(rule.id);
        if (
          bucket &&
          bucket.count >= rule.maximum &&
          +bucket.expiresAt > retryAt
        ) {
          retryAt = +bucket.expiresAt;
          reason = rule.reason ?? reason;
        }
      }
      if (retryAt) {
        const seconds = Math.ceil((retryAt - +now) / 1000);
        const wait =
          seconds <= 60
            ? seconds + '초'
            : '약 ' + Math.ceil(seconds / 60) + '분';
        fail(
          429,
          'RATE_LIMITED',
          reason + ' ' + wait + ' 후 다시 시도해 주세요.',
        );
      }
      // 하나라도 차단됐으면 어느 횟수도 차감하지 않습니다.
      for (const { id, windowMs } of rules) {
        const initial = { count: 1, expiresAt: new Date(+now + windowMs) };
        await tx.rateLimitBucket.upsert({
          where: { id },
          create: { id, ...initial },
          update: buckets.has(id) ? { count: { increment: 1 } } : initial,
        });
      }
    });
  }
  async reset(key: string) {
    await this.db.rateLimitBucket.deleteMany({
      where: { id: sign('rate:' + key) },
    });
  }
}
