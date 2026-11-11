/**
 * 로그인 상태를 PostgreSQL 세션에 저장합니다. 브라우저에는 무작위 토큰을 쿠키로 보내고,
 * DB에는 그 토큰의 해시만 저장합니다. 30분 미사용 또는 절대 만료 시 로그인이 풀립니다.
 */
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { config } from '../config';
import { digest, token } from '../common/crypto';

export type CurrentSession = NonNullable<
  Awaited<ReturnType<SessionService['find']>>
>;
export interface SessionRequest extends Request {
  authSession?: CurrentSession;
}

@Injectable()
export class SessionService {
  constructor(private readonly db: DatabaseService) {}
  async find(req: Request) {
    const authorization = req.get('Authorization');
    const raw: unknown =
      authorization === undefined
        ? req.cookies?.[config().cookieName]
        : /^Bearer ([a-f0-9]{64})$/i.exec(authorization)?.[1];
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) return null;
    const session = await this.db.session.findUnique({
      // 전달 방식까지 해시에 포함해 웹 쿠키와 앱 토큰을 서로 바꿔 쓸 수 없게 합니다.
      where: {
        tokenDigest: digest(
          authorization === undefined ? raw : 'mobile:' + raw,
        ),
      },
      include: { user: true },
    });
    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.lastSeenAt.getTime() < Date.now() - 30 * 60 * 1000
    )
      return null;
    await this.db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    return session;
  }
  async issue(
    transport: 'cookie' | 'bearer',
    userId: string | null,
    client: Pick<DatabaseService, 'session'> = this.db,
  ) {
    const raw = token(),
      csrfToken = token();
    const session = await client.session.create({
      data: {
        userId,
        tokenDigest: digest(transport === 'bearer' ? 'mobile:' + raw : raw),
        csrfDigest: digest(csrfToken),
        expiresAt: new Date(Date.now() + (userId ? 7 * 86400000 : 30 * 60000)),
      },
    });
    return { session, raw, csrfToken };
  }
  setCookie(res: Response, raw: string, expiresAt: Date) {
    res.cookie(config().cookieName, raw, {
      httpOnly: true,
      secure: config().production,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }
  async csrf(req: SessionRequest, res: Response) {
    const session = req.authSession;
    if (!session) {
      const issued = await this.issue('cookie', null);
      this.setCookie(res, issued.raw, issued.session.expiresAt);
      return { csrfToken: issued.csrfToken };
    }
    const csrfToken = token();
    await this.db.session.update({
      where: { id: session.id },
      data: { csrfDigest: digest(csrfToken) },
    });
    return { csrfToken };
  }
}
