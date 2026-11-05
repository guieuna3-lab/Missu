/**
 * Guard는 컨트롤러 실행 전에 요청을 검사하는 문지기입니다.
 * 로그인 필요 여부와 CSRF 토큰을 검사해 다른 사이트에서 몰래 보내는 변경 요청을 차단합니다.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { SessionService } from './session.service';
import type { SessionRequest } from './session.service';
import { digest, equal } from '../common/crypto';
import { fail } from '../common/http';
import { config } from '../config';

export const Public = () => SetMetadata('public', true);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', [
      context.getHandler(),
      context.getClass(),
    ]);
    // 서버/DB 상태 확인은 세션 조회 없이 처리합니다. DB 장애여도 live는 응답해야 합니다.
    if (req.path === '/' || req.path.startsWith('/health/')) return true;
    const session = await this.sessions.find(req);
    req.authSession = session ?? undefined;
    if (!isPublic && !session?.userId)
      fail(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('Origin'),
        csrf = req.get('X-CSRF-Token');
      if (
        !origin ||
        !config().origins.includes(origin) ||
        !csrf ||
        !session ||
        !equal(digest(csrf), session.csrfDigest)
      )
        fail(403, 'CSRF_INVALID', '접속 주소와 CSRF 토큰을 확인하세요.');
    }
    if (!isPublic || req.path.includes('/auth/'))
      res.setHeader('Cache-Control', 'no-store');
    return true;
  }
}
