import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import type { Response } from 'express';
import { AuthEntry, Public } from './auth.guard';
import { publicUser } from './auth.controller';
import { SessionService, type SessionRequest } from './session.service';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../common/rate-limit.service';
import { config } from '../config';
import { digest } from '../common/crypto';
import { fail } from '../common/http';

class RestoreDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) token: string;
}
const cookieName = () =>
  config().production ? '__Host-missu_restore' : 'missu_restore';
const cookieOptions = () => ({
  httpOnly: true,
  secure: config().production,
  sameSite: 'lax' as const,
  path: '/',
});
/** 웹은 동일 출처 프록시의 HttpOnly 쿠키, 네이티브는 SecureStore로 복원 자격을 보관합니다. */
@Controller('api/v1/auth')
export class PersistentSessionController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
    private readonly rates: RateLimitService,
  ) {}
  private browser(req: SessionRequest) {
    if (
      !config().origins.includes(req.get('Origin') ?? '') ||
      req.get('X-Missu-Session') !== '1'
    )
      fail(403, 'CSRF_INVALID', '미슈 앱에서 다시 시도해 주세요.');
  }
  private native(req: SessionRequest) {
    if (req.get('Origin'))
      fail(403, 'AUTH_TRANSPORT_MISMATCH', '웹은 보호된 쿠키를 사용하세요.');
  }
  private raw(req: SessionRequest): string | undefined {
    const value: unknown = req.cookies?.[cookieName()];
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      ? value
      : undefined;
  }
  private async create(req: SessionRequest, previous?: string) {
    const session = req.authSession!;
    await this.rates.consume('remember:' + session.userId, 30, 3600000);
    return this.db.$transaction(async (tx) => {
      // 비밀번호 재설정·탈퇴와 복원 자격 발급을 직렬화합니다.
      await tx.$queryRawUnsafe(
        'SELECT id FROM users WHERE id=$1::uuid FOR UPDATE',
        session.userId,
      );
      const current = await tx.session.findUnique({
        where: { id: session.id },
        include: { user: true },
      });
      if (
        !current?.user ||
        current.user.withdrawnAt ||
        current.expiresAt <= new Date()
      )
        return fail(401, 'AUTH_REQUIRED', '다시 로그인해 주세요.');
      if (previous) {
        const old = await tx.session.findUnique({
          where: { tokenDigest: digest('remember:' + previous) },
        });
        if (old)
          await tx.session.updateMany({
            where: {
              id: { not: current.id },
              OR: [{ id: old.id }, { rememberId: old.id }],
            },
            data: { expiresAt: new Date() },
          });
      }
      const issued = await this.sessions.issue('remember', current.userId, tx);
      const expiresAt = new Date(
        Math.min(current.expiresAt.getTime(), Date.now() + 7 * 86400000),
      );
      await tx.session.update({
        where: { id: issued.session.id },
        data: { expiresAt },
      });
      await tx.session.update({
        where: { id: current.id },
        data: { rememberId: issued.session.id },
      });
      return { token: issued.raw, expiresAt };
    });
  }
  private async restore(raw: string | undefined, req: SessionRequest) {
    await this.rates.consume('restore-ip:' + req.ip, 120, 300000);
    if (!raw) return fail(401, 'AUTH_REQUIRED', '저장된 로그인이 없어요.');
    const tokenDigest = digest('remember:' + raw);
    const candidate = await this.db.session.findUnique({
      where: { tokenDigest },
    });
    if (!candidate?.userId)
      return fail(401, 'AUTH_REQUIRED', '다시 로그인해 주세요.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM users WHERE id=$1::uuid FOR UPDATE',
        candidate.userId,
      );
      await tx.$queryRawUnsafe(
        'SELECT id FROM sessions WHERE id=$1::uuid FOR UPDATE',
        candidate.id,
      );
      const grant = await tx.session.findUnique({
        where: { id: candidate.id },
        include: { user: true },
      });
      if (
        !grant?.user ||
        grant.user.withdrawnAt ||
        grant.expiresAt <= new Date()
      )
        return fail(
          401,
          'AUTH_REQUIRED',
          '로그인이 만료됐어요. 다시 로그인해 주세요.',
        );
      const issued = await this.sessions.issue('bearer', grant.userId, tx);
      // 복원 자격의 7일 절대 만료를 늘리지 않습니다. 짧은 앱 토큰만 새로 발급합니다.
      const expiresAt = new Date(
        Math.min(grant.expiresAt.getTime(), Date.now() + 30 * 60000),
      );
      await tx.session.update({
        where: { id: issued.session.id },
        data: { rememberId: grant.id, expiresAt },
      });
      await tx.session.update({
        where: { id: grant.id },
        data: { lastSeenAt: new Date() },
      });
      return {
        user: publicUser(grant.user),
        accessToken: issued.raw,
        expiresAt,
      };
    });
  }
  private async forget(raw: string | undefined) {
    if (!raw) return;
    const grant = await this.db.session.findUnique({
      where: { tokenDigest: digest('remember:' + raw) },
    });
    if (grant)
      await this.db.session.updateMany({
        where: { OR: [{ id: grant.id }, { rememberId: grant.id }] },
        data: { expiresAt: new Date() },
      });
  }
  @AuthEntry('mobile')
  @Post('browser/save')
  @HttpCode(204)
  async saveBrowser(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.browser(req);
    const grant = await this.create(req, this.raw(req));
    res.cookie(cookieName(), grant.token, {
      ...cookieOptions(),
      expires: grant.expiresAt,
    });
  }
  @Public()
  @AuthEntry('mobile')
  @Post('browser/restore')
  @HttpCode(200)
  async restoreBrowser(@Req() req: SessionRequest) {
    this.browser(req);
    return { data: await this.restore(this.raw(req), req) };
  }
  @Public()
  @AuthEntry('mobile')
  @Post('browser/forget')
  @HttpCode(204)
  async forgetBrowser(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.browser(req);
    await this.forget(this.raw(req));
    res.clearCookie(cookieName(), cookieOptions());
  }
  @AuthEntry('mobile')
  @Post('mobile/remember')
  @HttpCode(200)
  async saveNative(@Req() req: SessionRequest) {
    this.native(req);
    return { data: await this.create(req) };
  }
  @Public()
  @AuthEntry('mobile')
  @Post('mobile/restore')
  @HttpCode(200)
  async restoreNative(@Body() body: RestoreDto, @Req() req: SessionRequest) {
    this.native(req);
    return { data: await this.restore(body.token, req) };
  }
  @Public()
  @AuthEntry('mobile')
  @Post('mobile/forget')
  @HttpCode(204)
  async forgetNative(@Body() body: RestoreDto, @Req() req: SessionRequest) {
    this.native(req);
    await this.rates.consume('forget-ip:' + req.ip, 120, 300000);
    await this.forget(body.token);
  }
}
