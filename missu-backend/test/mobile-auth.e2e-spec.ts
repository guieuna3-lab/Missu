import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/common/crypto';
import { harness, testPassword, type Harness } from './mvp-support';

describe('모바일 Bearer 인증', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 30000);
  beforeEach(() => h.beginCase());
  afterAll(async () => {
    await h?.close();
  });
  const api = () => request(h.app.getHttpServer());
  const login = (email: string) =>
    api()
      .post('/api/v1/auth/mobile/login')
      .send({ email, password: testPassword })
      .expect(200);

  it('기존 회원 로그인 → 내 정보 수정·조회 → 로그아웃 후 401', async () => {
    const user = await h.user('mobile');
    const result = await login(user.email);
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(result.headers['cache-control']).toBe('no-store');
    const { accessToken, expiresAt } = result.body.data;
    expect(result.body.data.user.id).toBe(user.id);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    const auth = 'Bearer ' + accessToken;
    await api()
      .patch('/api/v1/me')
      .set('Authorization', auth)
      .send({ nickname: '모바일회원' })
      .expect(200);
    const me = await api()
      .get('/api/v1/me')
      .set('Authorization', auth)
      .expect(200);
    expect(me.body.data.nickname).toBe('모바일회원');
    await api()
      .get('/api/v1/me/routes/status')
      .set('Authorization', auth)
      .expect(200);
    await api()
      .get('/api/v1/me')
      .set('Cookie', 'mishu_session=' + accessToken)
      .expect(401);
    await user.agent.get('/api/v1/me').set('Authorization', auth).expect(400);
    await api()
      .post('/api/v1/auth/logout')
      .set('Authorization', auth)
      .expect(204);
    await api().get('/api/v1/me').set('Authorization', auth).expect(401);
    await user.agent.get('/api/v1/me').expect(200);
  });

  it('익명 토큰으로 이메일 인증·가입 후 로그인하면 이전 토큰이 만료된다', async () => {
    const start = await api().post('/api/v1/auth/mobile/session').expect(201);
    const guest = 'Bearer ' + start.body.data.accessToken;
    const row = await h.db.session.findUniqueOrThrow({
      where: { tokenDigest: digest('mobile:' + start.body.data.accessToken) },
    });
    h.sessionIds.push(row.id);
    await api().get('/api/v1/me').set('Authorization', guest).expect(401);
    const email = randomUUID() + '@missu.test';
    const sent = await api()
      .post('/api/v1/auth/challenges')
      .set('Authorization', guest)
      .send({ purpose: 'SIGNUP', target: email })
      .expect(202);
    const challengeId = sent.body.data.challengeId;
    const verified = await api()
      .post('/api/v1/auth/challenges/' + challengeId + '/verify')
      .set('Authorization', guest)
      .send({ code: await h.code(challengeId) })
      .expect(200);
    const account = await api()
      .post('/api/v1/auth/signup')
      .set('Authorization', guest)
      .send({
        email,
        nickname: '새회원',
        password: testPassword,
        challengeId,
        proof: verified.body.data.proof,
        consents: ['TERMS', 'PRIVACY'].map((kind) => ({
          kind,
          policyVersion: 'dev-v1',
          agreed: true,
        })),
      })
      .expect(201);
    h.userIds.push(account.body.data.id);
    const member = await api()
      .post('/api/v1/auth/mobile/login')
      .set('Authorization', guest)
      .send({ email, password: testPassword })
      .expect(200);
    await api()
      .post('/api/v1/auth/challenges')
      .set('Authorization', guest)
      .send({ purpose: 'RESET', target: email })
      .expect(401);
    await api()
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + member.body.data.accessToken)
      .expect(200);
  });

  it('비밀번호 오류, 미사용·절대 만료, 웹 쿠키의 CSRF 정책을 구분한다', async () => {
    const user = await h.user('expire');
    await api()
      .post('/api/v1/auth/mobile/login')
      .send({ email: user.email, password: testPassword + 'X' })
      .expect(401);
    for (const cutoff of [
      { lastSeenAt: new Date(Date.now() - 31 * 60000) },
      { expiresAt: new Date(Date.now() - 1000) },
    ]) {
      const token = (await login(user.email)).body.data.accessToken;
      await h.db.session.update({
        where: { tokenDigest: digest('mobile:' + token) },
        data: cutoff,
      });
      await api()
        .get('/api/v1/me')
        .set('Authorization', 'Bearer ' + token)
        .expect(401);
    }
    await user.agent.patch('/api/v1/me').send({ nickname: '변경' }).expect(403);
  });
});
