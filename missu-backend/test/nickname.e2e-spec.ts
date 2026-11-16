import { randomUUID } from 'node:crypto';
import { harness, type Harness, testPassword } from './mvp-support';
const consents = ['TERMS', 'PRIVACY'].map((kind) => ({
  kind,
  policyVersion: 'dev-v1',
  agreed: true,
}));
// 시험마다 겹치지 않는 10자 이하 닉네임
const uniqueNickname = (prefix: string) =>
  prefix +
  randomUUID()
    .replaceAll('-', '')
    .slice(0, 10 - prefix.length);

describe('닉네임 중복확인 PostgreSQL 계약', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  }, 30000);
  beforeEach(() => h.beginCase());
  afterAll(async () => {
    await h?.close();
  });

  it('중복확인 API는 활동 중인 회원의 닉네임만 사용 중으로 본다', async () => {
    const owner = await h.user('nick-owner');
    const taken = uniqueNickname('Nk');
    await h.db.user.update({
      where: { id: owner.id },
      data: { nickname: taken },
    });
    const check = async (nickname: string) =>
      (
        await owner.agent
          .get('/api/v1/auth/nickname-check')
          .query({ nickname })
          .expect(200)
      ).body.data.available;
    expect(await check(taken)).toBe(false);
    expect(await check(taken.toLowerCase())).toBe(false);
    expect(await check('  ' + taken + '  ')).toBe(false);
    expect(await check(uniqueNickname('Free'))).toBe(true);
    expect(await check('탈퇴회원')).toBe(false);
    await owner.agent
      .get('/api/v1/auth/nickname-check')
      .query({ nickname: '가' })
      .expect(400);

    await h.db.user.update({
      where: { id: owner.id },
      data: { withdrawnAt: new Date() },
    });
    expect(await check(taken)).toBe(true);
  });

  it('가입과 닉네임 수정도 사용 중인 닉네임을 409로 거절한다', async () => {
    const owner = await h.user('nick-taken');
    const taken = uniqueNickname('Dup');
    await h.db.user.update({
      where: { id: owner.id },
      data: { nickname: taken },
    });

    const actor = await h.anonymous();
    const email = 'nick-' + randomUUID() + '@missu.test';
    const sent = await h
      .post(actor, '/auth/challenges')
      .send({ purpose: 'SIGNUP', target: email })
      .expect(202);
    const id = sent.body.data.challengeId;
    const verified = await h
      .post(actor, '/auth/challenges/' + id + '/verify')
      .send({ code: await h.code(id) })
      .expect(200);
    const body = {
      email,
      nickname: taken.toUpperCase(),
      password: testPassword,
      challengeId: id,
      proof: verified.body.data.proof,
      consents,
    };
    const rejected = await h.post(actor, '/auth/signup').send(body).expect(409);
    expect(rejected.body.error.code).toBe('NICKNAME_UNAVAILABLE');
    expect(await h.db.user.count({ where: { email } })).toBe(0);
    // 거절돼도 인증 증명은 소모되지 않아 다른 닉네임으로 바로 가입할 수 있다.
    const created = await h
      .post(actor, '/auth/signup')
      .send({ ...body, nickname: uniqueNickname('New') })
      .expect(201);
    h.userIds.push(created.body.data.id);

    const other = await h.user('nick-editor');
    const edit = (nickname: string) =>
      other.agent
        .patch('/api/v1/me')
        .set('Origin', 'http://localhost:3000')
        .set('X-CSRF-Token', other.csrf)
        .send({ nickname });
    const conflict = await edit(taken).expect(409);
    expect(conflict.body.error.code).toBe('NICKNAME_UNAVAILABLE');
    const mine = uniqueNickname('Me');
    await edit(mine).expect(200);
    // 자기 닉네임을 그대로 다시 저장하는 것은 허용한다.
    await edit(mine).expect(200);
  });
});
