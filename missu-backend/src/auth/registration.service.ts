/** 인증번호·세션·대상을 함께 검증합니다. 증명 소비와 가입/비밀번호 변경은 하나의 트랜잭션입니다. */
import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { hash } from '@node-rs/argon2';
import { randomInt, randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { decrypt, digest, encrypt, equal, sign, token } from '../common/crypto';
import { fail } from '../common/http';
import { RateLimitService } from '../common/rate-limit.service';
import { DeliveryService } from '../integrations/delivery.service';
import {
  ChallengeDto,
  ConsentDto,
  ResetPasswordDto,
  SignupDto,
} from './registration.dto';
import type { SessionRequest } from './session.service';

// @node-rs/argon2의 2는 Argon2id입니다. isolatedModules에서도 실행 가능한 숫자 값을 사용합니다.
const passwordHash = (value: string) =>
  hash(value, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
type Tx = Prisma.TransactionClient;

@Injectable()
export class RegistrationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly delivery: DeliveryService,
    private readonly rates: RateLimitService,
  ) {}
  private consent(value: ConsentDto | undefined, kind: string) {
    if (
      !value ||
      value.kind !== kind ||
      value.agreed !== true ||
      value.policyVersion !== config().policyVersion
    )
      fail(400, 'CONSENT_REQUIRED', '현재 정책 버전의 필수 동의가 필요합니다.');
  }
  private async locks(
    tx: Tx,
    sessionId: string,
    purpose: string,
    targetDigest: string,
    userId?: string | null,
  ) {
    const keys = [
      '2:session:' + sessionId + ':' + purpose,
      '3:target:' + targetDigest,
    ];
    if (purpose === 'PHONE' && userId) keys.push('1:phone:' + userId);
    for (const key of keys.sort())
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        key,
      );
  }
  async send(dto: ChallengeDto, req: SessionRequest) {
    const session = req.authSession!;
    let target = dto.target.toLowerCase();
    if (dto.purpose === 'PHONE') {
      if (!session.userId) fail(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
      this.consent(dto.consent, 'PHONE');
      target = dto.target.replace(/[ -]/g, '');
      if (!/^01[016789]\d{7,8}$/.test(target))
        fail(400, 'VALIDATION_ERROR', '국내 휴대전화 번호를 입력하세요.');
    } else if (!isEmail(target))
      fail(400, 'VALIDATION_ERROR', '이메일 형식을 확인하세요.');
    const targetDigest = sign('target:' + target);
    const hourly = {
      maximum: 5,
      windowMs: 3600000,
      reason: '인증번호 요청이 시간당 한도에 도달했습니다.',
    };
    const sms = {
      maximum: 3,
      windowMs: 60000,
      renewOnAccepted: true,
      reason: '인증 문자를 연속 3회 요청했습니다.',
    };
    // 문자와 이메일의 한도를 분리합니다. 문자는 마지막 접수 시각을 기준으로 1분 후 풀립니다.
    const nextAllowedAt = await this.rates.consumeAll(
      dto.purpose === 'PHONE'
        ? [
            { key: 'sms-user:' + session.userId, ...sms },
            { key: 'sms-target:' + targetDigest, ...sms },
            {
              key: 'sms-ip:' + req.ip,
              maximum: 5,
              windowMs: 60000,
              reason: '이 네트워크의 문자 요청이 분당 한도에 도달했습니다.',
            },
          ]
        : [
            { key: 'otp-ip:' + req.ip, ...hourly },
            { key: 'otp-session:' + session.id, ...hourly },
            { key: 'otp-target:' + targetDigest, ...hourly },
            {
              key: 'otp-cooldown:' + dto.purpose + ':' + targetDigest,
              maximum: 1,
              windowMs: 60000,
              reason: '인증번호 재요청은 60초 간격으로 가능합니다.',
            },
          ],
    );
    const id = randomUUID(),
      code = randomInt(0, 1000000).toString().padStart(6, '0');
    const expiresAt = new Date(
      Date.now() + (dto.purpose === 'PHONE' ? 180000 : 600000),
    );
    const account =
      dto.purpose === 'RESET'
        ? await this.db.user.findUnique({ where: { email: target } })
        : null;
    await this.db.$transaction(async (tx) => {
      await this.locks(
        tx,
        session.id,
        dto.purpose,
        targetDigest,
        session.userId,
      );
      const validSession = await tx.session.findUnique({
        where: { id: session.id },
      });
      if (!validSession || validSession.expiresAt <= new Date())
        fail(401, 'AUTH_REQUIRED', '세션이 만료됐습니다.');
      await tx.authChallenge.updateMany({
        where: {
          purpose: dto.purpose,
          consumedAt: null,
          OR: [
            { sessionId: session.id },
            ...(dto.purpose === 'PHONE' ? [{ userId: session.userId! }] : []),
          ],
        },
        data: { consumedAt: new Date() },
      });
      if (dto.purpose === 'PHONE') {
        // 새 번호 인증을 요청하면 이전 번호의 인증 상태를 먼저 해제합니다.
        await tx.user.update({
          where: { id: session.userId! },
          data: { phoneCiphertext: null, phoneVerifiedAt: null },
        });
        await tx.consent.upsert({
          where: {
            userId_kind_policyVersion: {
              userId: session.userId!,
              kind: 'PHONE',
              policyVersion: config().policyVersion,
            },
          },
          create: {
            userId: session.userId!,
            kind: 'PHONE',
            policyVersion: config().policyVersion,
          },
          update: {},
        });
      }
      await tx.authChallenge.create({
        data: {
          id,
          sessionId: session.id,
          userId: dto.purpose === 'PHONE' ? session.userId : account?.id,
          purpose: dto.purpose,
          targetCiphertext: encrypt(target),
          targetDigest,
          codeDigest: sign('otp:' + id + ':' + code),
          expiresAt,
        },
      });
    });
    try {
      // 없는 계정의 재설정도 같은 202 응답을 주되 실제 발송은 하지 않습니다.
      if (dto.purpose !== 'RESET' || account)
        await this.delivery.send(id, dto.purpose, target, code, expiresAt);
      await this.db.authChallenge.update({
        where: { id },
        data: { deliveryStatus: 'SENT' },
      });
    } catch {
      await this.db.authChallenge.update({
        where: { id },
        data: { deliveryStatus: 'FAILED', consumedAt: new Date() },
      });
      fail(503, 'EXTERNAL_UNAVAILABLE', '인증번호 발송을 접수하지 못했습니다.');
    }
    const retryAfter =
      dto.purpose === 'PHONE'
        ? Math.max(0, Math.ceil((nextAllowedAt - Date.now()) / 1000))
        : 60;
    return { challengeId: id, retryAfter, expiresAt };
  }
  private async locked(tx: Tx, id: string, sessionId: string) {
    const initial = await tx.authChallenge.findUnique({ where: { id } });
    if (!initial || initial.sessionId !== sessionId)
      fail(404, 'RESOURCE_NOT_FOUND', '인증 요청을 찾을 수 없습니다.');
    await this.locks(
      tx,
      sessionId,
      initial.purpose,
      initial.targetDigest,
      initial.userId,
    );
    await tx.$queryRawUnsafe(
      'SELECT id FROM auth_challenges WHERE id=$1::uuid FOR UPDATE',
      id,
    );
    const value = await tx.authChallenge.findUniqueOrThrow({ where: { id } });
    if (
      value.consumedAt ||
      value.expiresAt <= new Date() ||
      value.deliveryStatus !== 'SENT' ||
      value.attempts >= 5
    )
      fail(400, 'CHALLENGE_INVALID', '만료되었거나 사용할 수 없는 인증입니다.');
    return value;
  }
  async verify(id: string, code: string, req: SessionRequest) {
    const result = await this.db.$transaction(async (tx) => {
      const challenge = await this.locked(tx, id, req.authSession!.id);
      if (challenge.verifiedAt)
        fail(409, 'CHALLENGE_ALREADY_VERIFIED', '이미 확인한 인증입니다.');
      if (!equal(challenge.codeDigest, sign('otp:' + id + ':' + code))) {
        await tx.authChallenge.update({
          where: { id },
          data: { attempts: { increment: 1 } },
        });
        // 오류를 트랜잭션 밖에서 반환해 실패 횟수 기록이 롤백되지 않게 합니다.
        return { wrong: true as const };
      }
      if (challenge.purpose === 'PHONE') {
        if (
          !req.authSession!.userId ||
          challenge.userId !== req.authSession!.userId
        )
          fail(404, 'RESOURCE_NOT_FOUND', '인증 요청을 찾을 수 없습니다.');
        await tx.user.update({
          where: { id: challenge.userId! },
          data: {
            phoneCiphertext: challenge.targetCiphertext,
            phoneVerifiedAt: new Date(),
          },
        });
        await tx.authChallenge.update({
          where: { id },
          data: { verifiedAt: new Date(), consumedAt: new Date() },
        });
        return { verified: true as const };
      }
      const proof = token();
      await tx.authChallenge.update({
        where: { id },
        data: { verifiedAt: new Date(), proofDigest: digest(proof) },
      });
      return { verified: true as const, proof };
    });
    if ('wrong' in result)
      fail(400, 'CODE_INVALID', '인증번호가 올바르지 않습니다.');
    return result;
  }
  private async proof(
    tx: Tx,
    id: string,
    sessionId: string,
    proof: string,
    purpose: string,
  ) {
    const value = await this.locked(tx, id, sessionId);
    if (
      value.purpose !== purpose ||
      !value.verifiedAt ||
      !value.proofDigest ||
      !equal(digest(proof), value.proofDigest)
    )
      fail(400, 'PROOF_INVALID', '인증 증명이 올바르지 않습니다.');
    return value;
  }
  async signup(dto: SignupDto, sessionId: string) {
    this.consent(
      dto.consents.find((x) => x.kind === 'TERMS'),
      'TERMS',
    );
    this.consent(
      dto.consents.find((x) => x.kind === 'PRIVACY'),
      'PRIVACY',
    );
    try {
      return await this.db.$transaction(async (tx) => {
        const challenge = await this.proof(
          tx,
          dto.challengeId,
          sessionId,
          dto.proof,
          'SIGNUP',
        );
        const email = dto.email.toLowerCase();
        if (decrypt(challenge.targetCiphertext) !== email)
          fail(400, 'PROOF_INVALID', '인증한 이메일과 다릅니다.');
        if (await tx.user.findUnique({ where: { email } }))
          fail(409, 'EMAIL_UNAVAILABLE', '사용할 수 없는 이메일입니다.');
        // 비싼 해시 계산은 유효한 인증 증명을 확인한 뒤에만 수행합니다.
        const password = await passwordHash(dto.password);
        const user = await tx.user.create({
          data: {
            email,
            nickname: dto.nickname,
            passwordHash: password,
            emailVerifiedAt: new Date(),
          },
        });
        await tx.consent.createMany({
          data: dto.consents.map((x) => ({
            userId: user.id,
            kind: x.kind,
            policyVersion: x.policyVersion,
          })),
        });
        await tx.authChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });
        return { id: user.id };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(409, 'EMAIL_UNAVAILABLE', '사용할 수 없는 이메일입니다.');
      throw error;
    }
  }
  async reset(dto: ResetPasswordDto, sessionId: string) {
    await this.db.$transaction(async (tx) => {
      const challenge = await this.proof(
        tx,
        dto.challengeId,
        sessionId,
        dto.proof,
        'RESET',
      );
      const user = await tx.user.findUnique({
        where: { email: decrypt(challenge.targetCiphertext) },
      });
      if (!user || user.withdrawnAt || user.id !== challenge.userId)
        fail(400, 'PROOF_INVALID', '인증 증명이 올바르지 않습니다.');
      await tx.$queryRawUnsafe(
        'SELECT id FROM users WHERE id=$1::uuid FOR UPDATE',
        user.id,
      );
      const password = await passwordHash(dto.newPassword);
      const changed = await tx.user.updateMany({
        where: { id: user.id, email: user.email, withdrawnAt: null },
        data: { passwordHash: password },
      });
      if (!changed.count)
        fail(400, 'PROOF_INVALID', '인증 증명이 올바르지 않습니다.');
      await tx.authChallenge.updateMany({
        where: {
          targetDigest: challenge.targetDigest,
          purpose: 'RESET',
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      // 즉시 무효화하되 인증 제한 이력을 보존하기 위해 세션 행은 정리 작업까지 남깁니다.
      await tx.session.updateMany({
        where: { OR: [{ userId: user.id }, { id: sessionId }] },
        data: { expiresAt: new Date() },
      });
    });
  }
}
