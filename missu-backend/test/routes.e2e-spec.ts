import { randomUUID } from 'node:crypto';
import { harness, origin, type Actor, type Harness } from './mvp-support';
import { RoutesService } from '../src/routes/routes.service';
import { encrypt } from '../src/common/crypto';
describe('본인 하루 이동 경로 · 48시간', () => {
  let h: Harness, owner: Actor, outsider: Actor;
  beforeAll(async () => {
    h = await harness();
    owner = await h.user('route-owner');
    outsider = await h.user('route-other');
  }, 30000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(() => h.beginCase());
  const today = () =>
    new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const start = async (actor = owner, extra: Record<string, unknown> = {}) =>
    (
      await h
        .post(actor, '/me/routes/recordings')
        .send({
          clientRecordingId: randomUUID(),
          agreed: true,
          policyVersion: 'route-48h-v1',
          source: 'DEMO',
          ...extra,
        })
        .expect(201)
    ).body.data;
  const point = (at = new Date().toISOString()) => ({
    clientPointId: randomUUID(),
    recordedAt: at,
    lat: 37.582123,
    lng: 127.010321,
    accuracyM: 8,
  });
  const remove = (actor: Actor, query = 'all=true') =>
    actor.agent
      .delete('/api/v1/me/routes?' + query)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf);
  it('로그인·CSRF·명시적 위치 동의 없이는 기록하지 않는다', async () => {
    const anon = await h.anonymous();
    await anon.agent.get('/api/v1/me/routes/status').expect(401);
    await owner.agent.post('/api/v1/me/routes/recordings').send({}).expect(403);
    await h
      .post(owner, '/me/routes/recordings')
      .send({
        clientRecordingId: randomUUID(),
        agreed: false,
        policyVersion: 'route-48h-v1',
        source: 'DEVICE',
      })
      .expect(400);
  });
  it('시작 재시도는 같은 기록을 반환하고 새 시작은 이전 기록을 중지한다', async () => {
    const id = randomUUID(),
      first = await start(owner, { clientRecordingId: id }),
      again = await start(owner, { clientRecordingId: id });
    expect(again.id).toBe(first.id);
    const next = await start();
    expect(next.id).not.toBe(first.id);
    expect(
      (await h.db.routeRecording.findUniqueOrThrow({ where: { id } }))
        .stoppedAt,
    ).not.toBeNull();
    const status = await owner.agent
      .get('/api/v1/me/routes/status')
      .expect(200);
    expect(status.body.data.active.id).toBe(next.id);
  });
  it('좌표는 암호문으로 저장하고 같은 지점 재전송은 추가하지 않는다', async () => {
    const s = await start(),
      p = point();
    const endpoint = '/me/routes/recordings/' + s.id + '/points';
    const saved = await h
      .post(owner, endpoint)
      .send({ points: [p] })
      .expect(200);
    expect(saved.body.data.accepted).toBe(1);
    const retry = await h
      .post(owner, endpoint)
      .send({ points: [p] })
      .expect(200);
    expect(retry.body.data).toMatchObject({ accepted: 0, duplicates: 1 });
    const row = await h.db.routePoint.findFirstOrThrow({
      where: { recordingId: s.id },
    });
    expect(row.positionCiphertext).toMatch(/^v1\./);
    expect(row.positionCiphertext).not.toContain('37.582');
    expect(+row.expiresAt - +row.recordedAt).toBe(48 * 3600000);
    await h
      .post(owner, endpoint)
      .send({ points: [{ ...p, lat: 38 }] })
      .expect(409);
    const result = await owner.agent
      .get('/api/v1/me/routes?date=' + today())
      .expect(200);
    expect(result.body.data.points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lat: p.lat, lng: p.lng }),
      ]),
    );
  });
  it('다른 계정의 기록 번호로 쓰기·중지·조회할 수 없다', async () => {
    const s = await start(),
      p = point();
    await h
      .post(owner, '/me/routes/recordings/' + s.id + '/points')
      .send({ points: [p] })
      .expect(200);
    await h
      .post(outsider, '/me/routes/recordings/' + s.id + '/points')
      .send({ points: [point()] })
      .expect(404);
    await h
      .post(outsider, '/me/routes/recordings/' + s.id + '/stop')
      .send({})
      .expect(404);
    const others = await outsider.agent
      .get('/api/v1/me/routes?date=' + today())
      .expect(200);
    expect(others.body.data.points).toHaveLength(0);
    await remove(outsider).expect(200);
    expect(await h.db.routePoint.count({ where: { recordingId: s.id } })).toBe(
      1,
    );
  });
  it('시작 전·미래·잘못된 좌표·중복 지점·위조 소유자 입력을 거절한다', async () => {
    const s = await start(),
      path = '/me/routes/recordings/' + s.id + '/points',
      p = point();
    for (const bad of [
      { ...p, lat: 91 },
      { ...p, recordedAt: new Date(+new Date(s.startedAt) - 1).toISOString() },
      { ...p, recordedAt: new Date(Date.now() + 120000).toISOString() },
    ])
      await h
        .post(owner, path)
        .send({ points: [bad] })
        .expect(400);
    await h
      .post(owner, path)
      .send({ points: [p, p] })
      .expect(400);
    await h
      .post(owner, path)
      .send({ points: [p], userId: outsider.id })
      .expect(400);
  });
  it('한국 시간 자정 경계로 날짜를 나누며 잘못된 달력 날짜를 거절한다', async () => {
    const s = await start(),
      boundary = new Date(today() + 'T00:00:00+09:00');
    for (const recordedAt of [new Date(+boundary - 1), boundary])
      await h.db.routePoint.create({
        data: {
          recordingId: s.id,
          clientPointId: randomUUID(),
          recordedAt,
          expiresAt: new Date(+recordedAt + 48 * 3600000),
          positionCiphertext: encrypt(
            JSON.stringify({ lat: 1, lng: 2, accuracyM: 1 }),
          ),
          payloadHash: 'fixture',
        },
      });
    const response = await owner.agent
      .get('/api/v1/me/routes?date=' + today())
      .expect(200);
    expect(
      response.body.data.points.filter(
        (p: { recordingId: string }) => p.recordingId === s.id,
      ),
    ).toHaveLength(1);
    await owner.agent.get('/api/v1/me/routes?date=2026-02-30').expect(400);
  });
  it('48시간이 지난 좌표는 조회에서 제외하고 정리 작업이 삭제한다', async () => {
    const s = await start(),
      old = new Date(Date.now() - 49 * 3600000);
    const row = await h.db.routePoint.create({
      data: {
        recordingId: s.id,
        clientPointId: randomUUID(),
        recordedAt: old,
        expiresAt: new Date(+old + 48 * 3600000),
        positionCiphertext: encrypt('{"lat":1,"lng":2,"accuracyM":1}'),
        payloadHash: 'expired',
      },
    });
    const date = new Date(+old + 9 * 3600000).toISOString().slice(0, 10);
    const response = await owner.agent
      .get('/api/v1/me/routes?date=' + date)
      .expect(200);
    expect(
      response.body.data.points.find((p: { id: string }) => p.id === row.id),
    ).toBeUndefined();
    await h.app.get(RoutesService).purgeExpired();
    expect(
      await h.db.routePoint.findUnique({ where: { id: row.id } }),
    ).toBeNull();
  });
  it('중지 후 수신과 24시간이 지난 기록의 수신을 거절한다', async () => {
    const s = await start();
    await h
      .post(owner, '/me/routes/recordings/' + s.id + '/stop')
      .send({})
      .expect(200);
    await h
      .post(owner, '/me/routes/recordings/' + s.id + '/points')
      .send({ points: [point()] })
      .expect(409);
    const other = await start(),
      old = new Date(Date.now() - 25 * 3600000);
    await h.db.routeRecording.update({
      where: { id: other.id },
      data: {
        startedAt: old,
        autoStopsAt: new Date(+old + 24 * 3600000),
        expiresAt: new Date(+old + 48 * 3600000),
      },
    });
    await h
      .post(owner, '/me/routes/recordings/' + other.id + '/points')
      .send({ points: [point()] })
      .expect(409);
  });
  it('본인의 유효한 경로 지점에서만 주변 습득물을 찾는다', async () => {
    const s = await start();
    await h.item(outsider);
    await h
      .post(owner, '/me/routes/recordings/' + s.id + '/points')
      .send({ points: [point()] })
      .expect(200);
    const saved = await h.db.routePoint.findFirstOrThrow({
      where: { recordingId: s.id },
    });
    const own = await owner.agent
      .get('/api/v1/me/routes/points/' + saved.id + '/nearby')
      .expect(200);
    expect(own.body.data.length).toBeGreaterThan(0);
    await outsider.agent
      .get('/api/v1/me/routes/points/' + saved.id + '/nearby')
      .expect(404);
  });
  it('날짜 삭제는 기록을 중지하고, 전체 삭제는 본인 위치와 기록 단위를 모두 삭제한다', async () => {
    const s = await start();
    await h
      .post(owner, '/me/routes/recordings/' + s.id + '/points')
      .send({ points: [point()] })
      .expect(200);
    await remove(owner, 'date=' + today()).expect(200);
    expect(
      (await h.db.routeRecording.findUniqueOrThrow({ where: { id: s.id } }))
        .stoppedAt,
    ).not.toBeNull();
    await remove(owner, '').expect(400);
    await remove(owner).expect(200);
    expect(
      await h.db.routeRecording.count({ where: { userId: owner.id } }),
    ).toBe(0);
  });
});
