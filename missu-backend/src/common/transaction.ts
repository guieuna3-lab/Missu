/** 교착/직렬화 충돌만 제한적으로 다시 시도합니다. 입력 오류나 외부 발송을 재시도하지 않습니다. */
import { DatabaseService } from '../database/database.service';
import { Prisma } from '../generated/prisma/client';
import { fail } from './http';
export async function transaction<T>(
  db: DatabaseService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(work, { timeout: 15000 });
    } catch (error) {
      const collision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            ['40P01', '40001'].includes(String(error.meta?.code))));
      if (!collision) throw error;
    }
  }
  fail(
    409,
    'STATE_CONFLICT',
    '다른 요청이 처리 중입니다. 최신 상태를 확인하세요.',
  );
}
