import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DeliveryService } from '../src/integrations/delivery.service';
import { harness, type Harness, testPassword } from './mvp-support';
const consents = ['TERMS', 'PRIVACY'].map((kind) => ({
  kind,
  policyVersion: 'dev-v1',
  agreed: true,
}));

describe('가입·인증·재설정 PostgreSQL 계약', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 30000);
  beforeEach(() => h.beginCase());
  afterAll(async () => {
    await h?.close();
  });
  it('이메일 인증·필수 동의 후 가입하고 인증 증명은 재사용하지 못한다', async () => {
    const actor = await h.anonymous(),
      stranger = await h.anonymous();
    const email = 'signup-' + randomUUID() + '@missu.test';
    const sent = await h
      .post(actor, '/auth/challenges')
      .send({ purpose: 'SIGNUP', target: email })
      .expect(202);
    const id = sent.body.data.challengeId;
    expect(sent.body.data.code).toBeUndefined();
    const code = await h.code(id);
    await h
      .post(stranger, '/auth/challenges/' + id + '/verify')
      .send({ code })
      .expect(404);
    const wrong = code === '000000' ? '111111' : '000000';
    await h
      .post(actor, '/auth/challenges/' + id + '/verify')
      .send({ code: wrong })
      .expect(400);
    expect(
      (await h.db.authChallenge.findUniqueOrThrow({ where: { id } })).attempts,
    ).toBe(1);
    const verified = await h
      .post(actor, '/auth/challenges/' + id + '/verify')
      .send({ code })
      .expect(200);
    const body = {
      email,
      nickname: '새회원',
      password: testPassword,
      challengeId: id,
      proof: verified.body.data.proof,
      consents,
    };
    await h
      .post(actor, '/auth/signup')
      .send({ ...body, email: 'other@missu.test' })
      .expect(400);
    await h
      .post(actor, '/auth/signup')
      .send({ ...body, consents: [] })
      .expect(400);
    await h
      .post(actor, '/auth/signup')
      .send({ ...body, password: 'short' })
      .expect(400);
    const created = await h.post(actor, '/auth/signup').send(body).expect(201);
    actor.id = created.body.data.id;
    actor.email = email;
    h.userIds.push(actor.id);
    expect(await h.db.consent.count({ where: { userId: actor.id } })).toBe(2);
    expect(
      (await h.db.user.findUniqueOrThrow({ where: { id: actor.id } }))
        .passwordHash,
    ).not.toBe(testPassword);
    await h.post(actor, '/auth/signup').send(body).expect(400);
    await h.login(actor);
    expect(
      (await actor.agent.get('/api/v1/me').expect(200)).body.data.phoneVerified,
    ).toBe(false);
    await h
      .post(actor, '/auth/challenges')
      .send({ purpose: 'PHONE', target: '01012345678' })
      .expect(400);
    const phone = await h
      .post(actor, '/auth/challenges')
      .send({
        purpose: 'PHONE',
        target: '01012345678',
        consent: { kind: 'PHONE', agreed: true, policyVersion: 'dev-v1' },
      })
      .expect(202);
    await h
      .post(
        actor,
        '/auth/challenges/' + phone.body.data.challengeId + '/verify',
      )
      .send({ code: await h.code(phone.body.data.challengeId) })
      .expect(200);
    const me = await actor.agent.get('/api/v1/me').expect(200);
    expect(me.body.data.phoneVerified).toBe(true);
    expect(me.body.data.phoneCiphertext).toBeUndefined();
    await h
      .post(actor, '/auth/challenges')
      .send({
        purpose: 'PHONE',
        target: '01012345679',
        consent: { kind: 'PHONE', agreed: true, policyVersion: 'dev-v1' },
      })
      .expect(202);
    expect(
      (await actor.agent.get('/api/v1/me').expect(200)).body.data.phoneVerified,
    ).toBe(false);
  });
  it('코드 오입력 5회와 만료된 인증을 차단한다', async () => {
    const actor = await h.anonymous();
    const sent = await h
      .post(actor, '/auth/challenges')
      .send({ purpose: 'SIGNUP', target: randomUUID() + '@missu.test' })
      .expect(202);
    const id = sent.body.data.challengeId,
      code = await h.code(id),
      wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await h
        .post(actor, '/auth/challenges/' + id + '/verify')
        .send({ code: wrong })
        .expect(400);
    expect(
      (await h.db.authChallenge.findUniqueOrThrow({ where: { id } })).attempts,
    ).toBe(5);
    await h
      .post(actor, '/auth/challenges/' + id + '/verify')
      .send({ code })
      .expect(400);
    await h.db.authChallenge.update({
      where: { id },
      data: { attempts: 0, expiresAt: new Date(Date.now() - 1) },
    });
    await h
      .post(actor, '/auth/challenges/' + id + '/verify')
      .send({ code })
      .expect(400);
  });
  it('인증 확인과 가입을 동시에 재전송해도 한 번만 성공한다', async () => {
    const actor = await h.anonymous(),
      email = randomUUID() + '@missu.test';
    const sent = await h
      .post(actor, '/auth/challenges')
      .send({ purpose: 'SIGNUP', target: email })
      .expect(202);
    const id = sent.body.data.challengeId,
      code = await h.code(id);
    const verifications = await Promise.all(
      [1, 2].map(() =>
        h.post(actor, '/auth/challenges/' + id + '/verify').send({ code }),
      ),
    );
    expect(verifications.map((x) => x.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const proof = verifications.find((x) => x.status === 200)!.body.data.proof;
    const body = {
      email,
      nickname: '동시가입',
      password: testPassword,
      challengeId: id,
      proof,
      consents,
    };
    const signups = await Promise.all(
      [1, 2].map(() => h.post(actor, '/auth/signup').send(body)),
    );
    expect(signups.map((x) => x.status).sort((a, b) => a - b)).toEqual([
      201, 400,
    ]);
    h.userIds.push(signups.find((x) => x.status === 201)!.body.data.id);
    expect(await h.db.user.count({ where: { email } })).toBe(1);
  });
  it('60초 재발송 제한과 새 코드 발급 시 이전 코드 폐기를 적용한다', async () => {
    const actor = await h.anonymous(),
      body = { purpose: 'SIGNUP', target: randomUUID() + '@missu.test' };
    const first = await h
      .post(actor, '/auth/challenges')
      .send(body)
      .expect(202);
    await h.post(actor, '/auth/challenges').send(body).expect(429);
    await h.db.rateLimitBucket.updateMany({
      where: { id: { in: [...h.rateIds] } },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const second = await h
      .post(actor, '/auth/challenges')
      .send(body)
      .expect(202);
    expect(second.body.data.challengeId).not.toBe(first.body.data.challengeId);
    await h
      .post(
        actor,
        '/auth/challenges/' + first.body.data.challengeId + '/verify',
      )
      .send({ code: await h.code(first.body.data.challengeId) })
      .expect(400);
  });
  it('발송 실패를 성공으로 처리하지 않는다', async () => {
    const actor = await h.anonymous();
    const sender = jest
      .spyOn(h.app.get(DeliveryService), 'send')
      .mockRejectedValueOnce(new Error('simulated outage'));
    try {
      await h
        .post(actor, '/auth/challenges')
        .send({ purpose: 'SIGNUP', target: randomUUID() + '@missu.test' })
        .expect(503);
    } finally {
      sender.mockRestore();
    }
  });
  it('동시 문자 요청은 한 건만 발송하고, 재발송 대기 중 눌러도 시간당 횟수를 소모하지 않는다', async () => {
    const actor = await h.user('phone-retry', false);
    const body = {
      purpose: 'PHONE',
      target: '01012345678',
      consent: { kind: 'PHONE', agreed: true, policyVersion: 'dev-v1' },
    };
    const send = () => h.post(actor, '/auth/challenges').send(body);
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    for (let i = 0; i < 5; i++) {
      const denied = await send().expect(429);
      expect(denied.body.error.message).toMatch(/재요청.*\d+초 후/);
    }
    for (let i = 1; i < 5; i++) {
      // 이번 시험의 60초 대기만 만료시켜 시간당 한도를 그대로 검증합니다.
      await h.db.rateLimitBucket.updateMany({
        where: {
          id: { in: [...h.rateIds] },
          expiresAt: { lte: new Date(Date.now() + 60000) },
        },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      await send().expect(202);
    }
    const blocked = await send().expect(429);
    expect(blocked.body.error.message).toMatch(/시간당 한도.*\d+분 후/);
    expect(
      await h.db.authChallenge.count({
        where: { userId: actor.id, purpose: 'PHONE' },
      }),
    ).toBe(5);
  });
  it('비밀번호 재설정 후 모든 기존 로그인과 인증 세션을 무효화한다', async () => {
    const user = await h.user('reset'),
      otherLogin = await h.anonymous();
    otherLogin.email = user.email;
    await h.login(otherLogin);
    const actor = await h.anonymous();
    const sent = await h
      .post(actor, '/auth/challenges')
      .send({ purpose: 'RESET', target: user.email })
      .expect(202);
    const unknown = await h
      .post(actor, '/auth/challenges')
      .send({ purpose: 'RESET', target: randomUUID() + '@missu.test' })
      .expect(202);
    expect(Object.keys(unknown.body.data)).toEqual(Object.keys(sent.body.data));
    await expect(
      access(
        resolve(
          process.env.OUTBOX_PATH!,
          unknown.body.data.challengeId + '.json',
        ),
      ),
    ).rejects.toThrow();
    // 같은 세션의 새 발송은 이전 인증을 폐기하므로 알려진 계정의 재설정은 별도 세션에서 검증합니다.
    const resetActor = await h.anonymous();
    await h.db.rateLimitBucket.updateMany({
      where: { id: { in: [...h.rateIds] } },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const retry = await h
      .post(resetActor, '/auth/challenges')
      .send({ purpose: 'RESET', target: user.email })
      .expect(202);
    const id = retry.body.data.challengeId;
    const verify = await h
      .post(resetActor, '/auth/challenges/' + id + '/verify')
      .send({ code: await h.code(id) })
      .expect(200);
    const newPassword = 'New-missu-password-2026!';
    await h
      .post(resetActor, '/auth/password-reset')
      .send({ challengeId: id, proof: verify.body.data.proof, newPassword })
      .expect(204);
    await user.agent.get('/api/v1/me').expect(401);
    await otherLogin.agent.get('/api/v1/me').expect(401);
    const fresh = await h.anonymous();
    fresh.email = user.email;
    await h
      .post(fresh, '/auth/login')
      .send({ email: user.email, password: testPassword })
      .expect(401);
    await h.login(fresh, newPassword);
  });
  it('발송 횟수 제한을 세션이 달라도 IP 기준으로 적용한다', async () => {
    for (let i = 0; i < 5; i++) {
      const actor = await h.anonymous();
      await h
        .post(actor, '/auth/challenges')
        .send({ purpose: 'SIGNUP', target: randomUUID() + '@missu.test' })
        .expect(202);
    }
    const actor = await h.anonymous();
    await h
      .post(actor, '/auth/challenges')
      .send({ purpose: 'SIGNUP', target: randomUUID() + '@missu.test' })
      .expect(429);
  });
  it('잘못된 비밀번호 10회 이후 로그인을 제한한다', async () => {
    const actor = await h.anonymous(),
      email = randomUUID() + '@missu.test';
    for (let i = 0; i < 10; i++)
      await h
        .post(actor, '/auth/login')
        .send({ email, password: testPassword })
        .expect(401);
    await h
      .post(actor, '/auth/login')
      .send({ email, password: testPassword })
      .expect(429);
  });
});
