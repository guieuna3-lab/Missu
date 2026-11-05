/**
 * 멱등 처리: 사용자가 등록 버튼을 여러 번 눌러도 같은 요청은 한 번만 저장합니다.
 * 등록과 성공 결과 기록을 하나의 트랜잭션으로 묶어 중간 실패 시 함께 취소합니다.
 */
import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '../generated/prisma/client';
import { digest } from './crypto';
import { fail } from './http';
import { transaction } from './transaction';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly db: DatabaseService) {}
  async run(
    userId: string,
    route: string,
    key: string | undefined,
    body: unknown,
    action: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonObject>,
  ) {
    if (!key || !isUUID(key))
      fail(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key에 UUID를 입력하세요.',
      );
    const requestHash = digest(canonical(body));
    return transaction(this.db, async (tx) => {
      // 결과 행이 아직 없을 때 동시에 들어온 재시도도 같은 잠금을 거치도록 합니다.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId + route + key}, 0))`;
      const existing = await tx.idempotencyRecord.findUnique({
        where: { userId_route_key: { userId, route, key } },
      });
      if (existing && existing.expiresAt > new Date()) {
        if (existing.requestHash !== requestHash)
          fail(
            409,
            'IDEMPOTENCY_MISMATCH',
            '동일한 키에 다른 입력을 사용할 수 없습니다.',
          );
        return existing.responseBody;
      }
      if (existing)
        await tx.idempotencyRecord.delete({ where: { id: existing.id } });
      const result = await action(tx);
      await tx.idempotencyRecord.create({
        data: {
          userId,
          route,
          key,
          requestHash,
          responseBody: result,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return result;
    });
  }
}
