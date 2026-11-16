import type { Prisma } from '../generated/prisma/client';
import { fail } from './http';

// 닉네임은 활동 중인 회원 사이에서 중복을 허용하지 않는다. 영문 대소문자는 같은 닉네임으로 본다.
// 탈퇴 회원은 모두 '탈퇴회원'으로 바뀌므로 비교 대상에서 빼고, 그 이름은 새로 쓸 수 없게 막는다.
// DB unique 제약은 운영 DB의 기존 중복 여부를 확인한 뒤 별도 migration으로 추가한다.
const RESERVED_NICKNAMES = ['탈퇴회원'];

export async function isNicknameTaken(
  db: Prisma.TransactionClient,
  nickname: string,
  exceptUserId?: string,
) {
  const value = nickname.trim();
  if (RESERVED_NICKNAMES.includes(value)) return true;
  const found = await db.user.findFirst({
    where: {
      nickname: { equals: value, mode: 'insensitive' },
      withdrawnAt: null,
      ...(exceptUserId && { id: { not: exceptUserId } }),
    },
    select: { id: true },
  });
  return found !== null;
}

export async function assertNicknameAvailable(
  db: Prisma.TransactionClient,
  nickname: string,
  exceptUserId?: string,
) {
  if (await isNicknameTaken(db, nickname, exceptUserId))
    fail(409, 'NICKNAME_UNAVAILABLE', '이미 사용 중인 닉네임입니다.');
}
