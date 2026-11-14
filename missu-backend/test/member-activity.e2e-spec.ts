import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  harness,
  type Harness,
  type Actor,
  origin,
  testPassword,
  claimBody,
} from './mvp-support';

describe('팀 화면의 회원 활동 API', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => h.beginCase());
  const write = (
    user: Actor,
    method: 'put' | 'patch' | 'delete',
    path: string,
  ) =>
    user.agent[method]('/api/v1' + path)
      .set('Origin', origin)
      .set('X-CSRF-Token', user.csrf);
  const photo = (user: Actor) =>
    h.db.itemPhoto.create({
      data: {
        uploaderId: user.id,
        objectKey: randomUUID(),
        mime: 'image/jpeg',
        byteSize: 100,
        width: 8,
        height: 8,
      },
    });

  it('분실 신고는 재로그인 후에도 남고 작성자만 수정·삭제한다', async () => {
    const owner = await h.user('lost-owner'),
      other = await h.user('lost-other');
    const body = {
      ...claimBody(),
      name: '시연 열쇠',
      category: 'KEY',
      placeName: '중앙도서관',
    };
    const key = randomUUID(),
      path = '/lost-reports';
    const {
      body: {
        data: { id },
      },
    } = await h.post(owner, path, key).send(body).expect(201);
    const retry = await h.post(owner, path, key).send(body).expect(201);
    expect(retry.body.data.id).toBe(id);
    const detail = path + '/' + id;
    await write(other, 'put', detail).send(body).expect(404);
    await write(other, 'delete', detail).expect(404);
    expect((await other.agent.get('/api/v1' + path)).body.data).toEqual([]);
    await h.post(owner, '/auth/logout').expect(204);
    const mobile = await request(h.app.getHttpServer())
      .post('/api/v1/auth/mobile/login')
      .send({ email: owner.email, password: testPassword })
      .expect(200);
    const req = request(h.app.getHttpServer()),
      bearer = 'Bearer ' + mobile.body.data.accessToken;
    const list = await req
      .get('/api/v1' + path)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id,
        placeName: body.placeName,
        category: 'KEY',
      }),
    ]);
    const edit = await req
      .put('/api/v1' + detail)
      .set('Authorization', bearer)
      .send({ ...body, name: '수정한 지갑', category: 'WALLET', features: '' })
      .expect(200);
    expect(edit.body.data).toMatchObject({
      features: null,
      category: 'WALLET',
      name: '수정한 지갑',
    });
    await req
      .delete('/api/v1' + detail)
      .set('Authorization', bearer)
      .expect(204);
    await req
      .get('/api/v1' + detail)
      .set('Authorization', bearer)
      .expect(404);
    expect(
      (await req.get('/api/v1' + path).set('Authorization', bearer)).body.data,
    ).toEqual([]);
  });

  it('작성자가 선택한 습득물 글과 사진만 숨기고 대기 요청을 종료한다', async () => {
    const keeper = await h.user('delete-keeper'),
      other = await h.user('delete-other');
    const selected = await h.item(keeper),
      keep = await h.item(keeper);
    const path = '/items/' + selected.id;
    const attached = await photo(keeper);
    await h.db.itemPhoto.update({
      where: { id: attached.id },
      data: { state: 'ATTACHED', itemId: selected.id, sortOrder: 0 },
    });
    const detail = await other.agent.get('/api/v1' + path).expect(200);
    const claim = await h
      .post(other, path + '/claims')
      .send(claimBody())
      .expect(201);
    await write(other, 'delete', path).expect(404);
    await write(keeper, 'delete', path).expect(204);
    await other.agent.get('/api/v1' + path).expect(404);
    await keeper.agent.get('/api/v1' + path + '/manage').expect(404);
    await other.agent.get(detail.body.data.photos[0].url).expect(404);
    const history = await keeper.agent
      .get('/api/v1/me/history?type=MY_ITEMS')
      .expect(200);
    expect(history.body.data.map((r: { id: string }) => r.id)).toEqual([
      keep.id,
    ]);
    const request = await other.agent
      .get('/api/v1/claims/' + claim.body.data.claimId)
      .expect(200);
    expect(request.body.data.status).toBe('CLOSED');
    await h
      .post(other, path + '/claims')
      .send(claimBody())
      .expect(404);
  });

  it('승인된 물품은 수령 확인 후 글을 삭제하고 완료한 반환 내역은 유지한다', async () => {
    const keeper = await h.user('return-keeper'),
      other = await h.user('return-other');
    const item = await h.item(keeper),
      path = '/items/' + item.id;
    const claim = await h
      .post(other, path + '/claims')
      .send(claimBody())
      .expect(201);
    const c = '/claims/' + claim.body.data.claimId;
    await h
      .post(keeper, c + '/decision')
      .send({ decision: 'APPROVE' })
      .expect(200);
    await write(keeper, 'delete', path).expect(409);
    await h.post(keeper, c + '/handover').expect(200);
    await write(keeper, 'delete', path).expect(409);
    await h.post(other, c + '/receipt').expect(200);
    await write(keeper, 'delete', path).expect(204);
    expect(
      (await other.agent.get('/api/v1' + c).expect(200)).body.data.status,
    ).toBe('RETURNED');
  });

  it('습득물 사진 재정렬과 실패한 수정은 원자적으로 처리한다', async () => {
    const keeper = await h.user('edit-keeper'),
      other = await h.user('edit-other');
    const item = await h.item(keeper),
      path = '/items/' + item.id;
    const a = await photo(keeper),
      b = await photo(keeper),
      foreign = await photo(other);
    await h.db.itemPhoto.update({
      where: { id: a.id },
      data: { state: 'ATTACHED', itemId: item.id, sortOrder: 0 },
    });
    const body = {
      name: '파란 지갑',
      category: 'WALLET_BAG',
      appCategory: 'WALLET',
      foundAt: item.foundAt.toISOString(),
      foundLocation: claimBody().lostLocation,
      storagePlace: '안내 데스크',
      photoIds: [b.id, a.id],
      privateFeatures: '내부 표시',
    };
    await write(other, 'put', path).send(body).expect(404);
    const saved = await write(keeper, 'put', path).send(body).expect(200);
    expect(saved.body.data.photos.map((p: { id: string }) => p.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(saved.body.data.appCategory).toBe('WALLET');
    await write(keeper, 'put', path)
      .send({ ...body, name: '실패해야 함', photoIds: [foreign.id] })
      .expect(409);
    const reread = await keeper.agent
      .get('/api/v1' + path + '/manage')
      .expect(200);
    expect(reread.body.data.name).toBe(body.name);
    expect(reread.body.data.photos.map((p: { id: string }) => p.id)).toEqual([
      b.id,
      a.id,
    ]);
  });

  it('의심 신고의 첨부와 접수증은 신고자에게 귀속된다', async () => {
    const keeper = await h.user('report-keeper'),
      member = await h.user('report-member'),
      other = await h.user('report-other');
    const item = await h.item(keeper);
    const claim = await h
      .post(member, '/items/' + item.id + '/claims')
      .send(claimBody())
      .expect(201);
    const path = '/claims/' + claim.body.data.claimId;
    await h
      .post(keeper, path + '/decision')
      .send({ decision: 'APPROVE' })
      .expect(200);
    const own = await photo(member),
      foreign = await photo(other);
    const body = {
      reason: '의심스러운 거래',
      description: '시험용 신고 설명',
      photoIds: [own.id],
    };
    const bad = await h
      .post(member, path + '/reports')
      .send({ ...body, photoIds: [foreign.id] });
    expect([400, 409]).toContain(bad.status);
    const submitted = await h
      .post(member, path + '/reports')
      .send(body)
      .expect(201);
    const receipt = '/api/v1/reports/' + submitted.body.data.reportId;
    expect(
      (await member.agent.get(receipt).expect(200)).body.data,
    ).toMatchObject({ description: body.description, photoCount: 1 });
    await keeper.agent.get(receipt).expect(404);
    expect(
      (await h.db.itemPhoto.findUniqueOrThrow({ where: { id: own.id } })).state,
    ).toBe('EVIDENCE');
  });

  it('닉네임 변경, 번호 해제, 비밀번호 변경과 탈퇴가 다음 로그인에 반영된다', async () => {
    const user = await h.user('account'),
      item = await h.item(user);
    const edited = await write(user, 'patch', '/me')
      .send({ nickname: '바꾼이름' })
      .expect(200);
    expect(edited.body.data.nickname).toBe('바꾼이름');
    await write(user, 'delete', '/me/phone').expect(204);
    expect((await user.agent.get('/api/v1/me')).body.data.phoneVerified).toBe(
      false,
    );
    const changed = 'Changed-missu-test-2026!';
    await write(user, 'patch', '/me/password')
      .send({ currentPassword: testPassword, newPassword: changed })
      .expect(204);
    await user.agent.get('/api/v1/me').expect(401);
    await h.login(user, changed);
    await write(user, 'delete', '/me').expect(204);
    await user.agent.get('/api/v1/me').expect(401);
    await user.agent.get('/api/v1/items/' + item.id).expect(404);
    const old = await h.anonymous();
    await h
      .post(old, '/auth/login')
      .send({ email: user.email, password: changed })
      .expect(401);
  });
});
