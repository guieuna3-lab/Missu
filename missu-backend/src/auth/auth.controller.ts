/**
 * 로그인·로그아웃과 세션 교체를 처리합니다. 가입·인증번호는 RegistrationController에서 처리합니다.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { SessionService } from './session.service';
import type { SessionRequest } from './session.service';
import { AuthEntry, Public } from './auth.guard';
import { DatabaseService } from '../database/database.service';
import { LoginDto } from './auth.dto';
import { fail } from '../common/http';
import { config } from '../config';
import { RateLimitService } from '../common/rate-limit.service';

export const publicUser = (user: {
  id: string;
  email: string;
  nickname: string;
  phoneVerifiedAt: Date | null;
}) => ({
  id: user.id,
  email: user.email,
  nickname: user.nickname,
  phoneVerified: !!user.phoneVerifiedAt,
});

@Controller('api/v1/auth')
export class AuthController {
  // 존재하지 않는 계정도 해시 검사를 수행해 응답 시간으로 계정 존재를 쉽게 추측하지 못하게 합니다.
  private readonly dummyHash = hash(randomBytes(32), {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionService,
    private readonly rates: RateLimitService,
  ) {}
  @Public()
  @AuthEntry('cookie')
  @Get('csrf')
  async csrf(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.rates.consume('csrf-ip:' + req.ip, 300, 300000);
    return { data: await this.sessions.csrf(req, res) };
  }
  @Public()
  @AuthEntry('cookie')
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, issued } = await this.authenticate(dto, req, 'cookie');
    this.sessions.setCookie(res, issued.raw, issued.session.expiresAt);
    return { data: { user: publicUser(user), csrfToken: issued.csrfToken } };
  }
  @Public()
  @AuthEntry('mobile')
  @Post('mobile/login')
  @HttpCode(200)
  async mobileLogin(@Body() dto: LoginDto, @Req() req: SessionRequest) {
    const { user, issued } = await this.authenticate(dto, req, 'bearer');
    return {
      data: {
        user: publicUser(user),
        accessToken: issued.raw,
        expiresAt: issued.session.expiresAt,
      },
    };
  }
  @Public()
  @AuthEntry('mobile')
  @Post('mobile/session')
  @HttpCode(201)
  async mobileSession(@Req() req: SessionRequest) {
    // 가입·비밀번호 재설정의 인증번호와 증명을 같은 익명 세션에 묶습니다.
    await this.rates.consume('mobile-session-ip:' + req.ip, 60, 300000);
    const issued = await this.sessions.issue('bearer', null);
    return {
      data: { accessToken: issued.raw, expiresAt: issued.session.expiresAt },
    };
  }
  private async authenticate(
    dto: LoginDto,
    req: SessionRequest,
    transport: 'cookie' | 'bearer',
  ) {
    const email = dto.email.toLowerCase();
    await this.rates.consume('login-ip:' + req.ip, 100, 900000);
    await this.rates.consume('login-account:' + email, 10, 900000);
    const user = await this.db.user.findUnique({
      where: { email },
    });
    const valid = await verify(
      user?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );
    if (!user || user.withdrawnAt || !valid)
      fail(401, 'LOGIN_FAILED', '이메일 또는 비밀번호가 올바르지 않습니다.');
    const issued = await this.db.$transaction(async (tx) => {
      // 재설정과 로그인이 겹치면 이전 비밀번호로 새 세션이 생기지 않도록 다시 확인합니다.
      await tx.$queryRawUnsafe(
        'SELECT id FROM users WHERE id=$1::uuid FOR UPDATE',
        user.id,
      );
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      if (current.passwordHash !== user.passwordHash)
        fail(401, 'LOGIN_FAILED', '다시 로그인하세요.');
      if (req.authSession) {
        const expired = await tx.session.updateMany({
          where: { id: req.authSession.id, expiresAt: { gt: new Date() } },
          data: { expiresAt: new Date() },
        });
        if (!expired.count) fail(401, 'AUTH_REQUIRED', '세션이 만료됐습니다.');
      }
      return this.sessions.issue(transport, user.id, tx);
    });
    await this.rates.reset('login-account:' + email);
    return { user, issued };
  }
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.session.updateMany({
      where: req.authSession!.rememberId
        ? {
            OR: [
              { id: req.authSession!.id },
              { id: req.authSession!.rememberId },
              { rememberId: req.authSession!.rememberId },
            ],
          }
        : { id: req.authSession!.id },
      data: { expiresAt: new Date() },
    });
    if (!req.get('Authorization'))
      res.clearCookie(config().cookieName, {
        httpOnly: true,
        secure: config().production,
        sameSite: 'lax',
        path: '/',
      });
  }
}
