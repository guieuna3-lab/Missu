/**
 * 목록의 다음 페이지 위치를 커서에 담습니다. 서명을 붙여 사용자의 커서 변조를 막고,
 * 검색 조건이 바뀌면 이전 커서를 사용할 수 없게 합니다.
 */
import { isUUID } from 'class-validator';
import { digest, equal, sign } from './crypto';
import { fail } from './http';

export function cursorFor(id: string, createdAt: Date, scope: string) {
  const payload = Buffer.from(
    JSON.stringify({
      id,
      createdAt: createdAt.toISOString(),
      scope: digest(scope),
    }),
  ).toString('base64url');
  return payload + '.' + sign(payload);
}
export function readCursor(cursor: string | undefined, scope: string) {
  if (!cursor) return undefined;
  try {
    const parts = cursor.split('.');
    if (parts.length !== 2 || !equal(sign(parts[0]), parts[1]))
      throw new Error();
    const value = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8'),
    ) as { id: string; createdAt: string; scope: string };
    if (
      !isUUID(value.id) ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      value.scope !== digest(scope)
    )
      throw new Error();
    return { id: value.id, createdAt: new Date(value.createdAt) };
  } catch {
    fail(
      400,
      'VALIDATION_ERROR',
      '검색 조건이 변경되었거나 커서가 올바르지 않습니다. 첫 페이지부터 다시 조회하세요.',
    );
  }
}
export function olderThan(value: ReturnType<typeof readCursor>) {
  return value
    ? {
        OR: [
          { createdAt: { lt: value.createdAt } },
          { createdAt: value.createdAt, id: { lt: value.id } },
        ],
      }
    : {};
}
