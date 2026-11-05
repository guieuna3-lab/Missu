import { randomUUID } from 'node:crypto';
import { harness, type Harness, type Actor, claimBody } from './mvp-support';

describe('주인 확인·대화·반환 PostgreSQL 계약', () => {
  let h: Harness,
    keeper: Actor,
    requester: Actor,
    second: Actor,
    stranger: Actor;
  beforeAll(async () => {
    h = await harness();
    keeper = await h.user('keeper');
    requester = await h.user('requester');
    second = await h.user('second');
    stranger = await h.user('stranger', false);
  }, 30000);
  beforeEach(() => h.beginCase());
  afterAll(async () => {
    await h?.close();
  });
  const create = async (actor: Actor, itemId: string) =>
    (
      await h
        .post(actor, '/items/' + itemId + '/claims')
        .send(claimBody())
        .expect(201)
    ).body.data.claimId as string;
  it('전화 미인증·자기 물품·잘못된 입력·중복 활성 요청을 차단한다', async () => {
    const item = await h.item(keeper);
    await h
      .post(stranger, '/items/' + item.id + '/claims')
      .send(claimBody())
      .expect(403);
    await h
      .post(keeper, '/items/' + item.id + '/claims')
      .send(claimBody())
      .expect(409);
    await h
      .post(requester, '/items/' + item.id + '/claims')
      .send({ ...claimBody(), features: '  ' })
      .expect(400);
    await h
      .post(requester, '/items/' + item.id + '/claims')
      .send({ ...claimBody(), userId: keeper.id })
      .expect(400);
    await create(requester, item.id);
    await h
      .post(requester, '/items/' + item.id + '/claims')
      .send(claimBody())
      .expect(409);
  });
  it('같은 등록을 동시에 재전송해도 요청은 하나만 생긴다', async () => {
    const item = await h.item(keeper),
      key = randomUUID(),
      body = claimBody();
    const responses = await Promise.all(
      [1, 2].map(() =>
        h
          .post(requester, '/items/' + item.id + '/claims', key)
          .send(body)
          .expect(201),
      ),
    );
    expect(responses[0].body).toEqual(responses[1].body);
    expect(await h.db.claim.count({ where: { itemId: item.id } })).toBe(1);
    await h
      .post(requester, '/items/' + item.id + '/claims', key)
      .send({ ...body, features: '다른 내용' })
      .expect(409);
  });
  it('승인 전 대화와 제3자 접근을 차단하고 신고는 요청 상태를 바꾸지 않는다', async () => {
    const item = await h.item(keeper),
      id = await create(requester, item.id);
    await stranger.agent.get('/api/v1/claims/' + id).expect(404);
    await requester.agent.get('/api/v1/claims/' + id + '/messages').expect(409);
    await h
      .post(requester, '/claims/' + id + '/messages')
      .send({ body: '안녕하세요', clientMessageId: randomUUID() })
      .expect(409);
    await h
      .post(requester, '/claims/' + id + '/reports')
      .send({ reason: '신고' })
      .expect(404);
    const report = await h
      .post(keeper, '/claims/' + id + '/reports')
      .send({ reason: '특징이 맞지 않습니다.' })
      .expect(201);
    const again = await h
      .post(keeper, '/claims/' + id + '/reports')
      .send({ reason: '다른 사유로 재접수' })
      .expect(201);
    expect(again.body.data.reportId).toBe(report.body.data.reportId);
    expect((await h.db.claim.findUniqueOrThrow({ where: { id } })).status).toBe(
      'PENDING',
    );
    const receipt = await keeper.agent
      .get('/api/v1/reports/' + report.body.data.reportId)
      .expect(200);
    expect(receipt.body.data.reason).toBe('특징이 맞지 않습니다.');
    await requester.agent
      .get('/api/v1/reports/' + report.body.data.reportId)
      .expect(404);
    await h
      .post(keeper, '/claims/' + id + '/decision')
      .send({ decision: 'REJECT' })
      .expect(400);
    await h
      .post(keeper, '/claims/' + id + '/decision')
      .send({ decision: 'REJECT', reason: '소유 특징이 다릅니다.' })
      .expect(200);
    await requester.agent.get('/api/v1/claims/' + id + '/messages').expect(409);
    await create(requester, item.id);
  });
  it('동시 승인에서는 한 요청만 승인하고 나머지는 CLOSED가 된다', async () => {
    const item = await h.item(keeper),
      a = await create(requester, item.id),
      b = await create(second, item.id);
    const responses = await Promise.all(
      [a, b].map((id) =>
        h
          .post(keeper, '/claims/' + id + '/decision')
          .send({ decision: 'APPROVE' }),
      ),
    );
    expect(responses.map((x) => x.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const rows = await h.db.claim.findMany({ where: { itemId: item.id } });
    expect(rows.map((x) => x.status).sort()).toEqual(['APPROVED', 'CLOSED']);
    expect(
      (await h.db.foundItem.findUniqueOrThrow({ where: { id: item.id } }))
        .status,
    ).toBe('RESERVED');
    const closed = rows.find((x) => x.status === 'CLOSED')!;
    await expect(
      h.db.claim.update({
        where: { id: closed.id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('DB에도 거절 사유 필수 규칙을 적용한다', async () => {
    const item = await h.item(keeper),
      id = await create(second, item.id);
    await expect(
      h.db.claim.update({
        where: { id },
        data: { status: 'REJECTED', decisionReason: null },
      }),
    ).rejects.toThrow();
    await h
      .post(keeper, '/claims/' + id + '/decision')
      .send({ decision: 'REJECT', reason: '확인 특징이 다릅니다.' })
      .expect(200);
  });
  it('대화→보관자 전달→요청자 수령 순서를 지키고 완료 후 쓰기와 검색 노출을 막는다', async () => {
    const item = await h.item(keeper),
      id = await create(requester, item.id);
    const approveKey = randomUUID();
    const approval = await h
      .post(keeper, '/claims/' + id + '/decision', approveKey)
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(
      (
        await h
          .post(keeper, '/claims/' + id + '/decision', approveKey)
          .send({ decision: 'APPROVE' })
          .expect(200)
      ).body,
    ).toEqual(approval.body);
    await h
      .post(requester, '/claims/' + id + '/decision')
      .send({ decision: 'APPROVE' })
      .expect(404);
    await h
      .post(requester, '/claims/' + id + '/receipt')
      .send({})
      .expect(409);
    const payload = {
      body: '도서관에서 만나요.',
      clientMessageId: randomUUID(),
    };
    const message = await h
      .post(requester, '/claims/' + id + '/messages')
      .send(payload)
      .expect(201);
    expect(
      (
        await h
          .post(requester, '/claims/' + id + '/messages')
          .send(payload)
          .expect(201)
      ).body,
    ).toEqual(message.body);
    await h
      .post(requester, '/claims/' + id + '/messages')
      .send({ ...payload, body: '변경' })
      .expect(409);
    await h
      .post(stranger, '/claims/' + id + '/messages')
      .send(payload)
      .expect(404);
    await h
      .post(requester, '/claims/' + id + '/handover')
      .send({})
      .expect(404);
    await h
      .post(keeper, '/claims/' + id + '/handover')
      .send({ extra: true })
      .expect(400);
    const handover = await h
      .post(keeper, '/claims/' + id + '/handover')
      .send({})
      .expect(200);
    expect(handover.body.data.itemStatus).toBe('RESERVED');
    await h
      .post(keeper, '/claims/' + id + '/handover')
      .send({})
      .expect(200);
    await h
      .post(keeper, '/claims/' + id + '/receipt')
      .send({})
      .expect(404);
    const received = await h
      .post(requester, '/claims/' + id + '/receipt')
      .send({})
      .expect(200);
    expect(received.body.data.itemStatus).toBe('RETURNED');
    await h
      .post(requester, '/claims/' + id + '/receipt')
      .send({})
      .expect(200);
    await h
      .post(requester, '/claims/' + id + '/messages')
      .send({ body: '새 메시지', clientMessageId: randomUUID() })
      .expect(409);
    // 이미 저장한 메시지의 재전송은 반환 후에도 같은 결과만 돌려줍니다.
    await h
      .post(requester, '/claims/' + id + '/messages')
      .send(payload)
      .expect(201);
    const messages = await keeper.agent
      .get('/api/v1/claims/' + id + '/messages')
      .expect(200);
    expect(messages.body.data.messages).toHaveLength(1);
    const detail = await requester.agent
      .get('/api/v1/claims/' + id)
      .expect(200);
    expect(detail.body.data.status).toBe('RETURNED');
    expect(detail.body.data.phone).toBeUndefined();
    expect(detail.body.data.privateFeatures).toBeUndefined();
    const items = await requester.agent
      .get('/api/v1/items')
      .query({ q: item.name })
      .expect(200);
    expect(items.body.data).toHaveLength(0);
    const nearby = await requester.agent
      .get('/api/v1/items/nearby')
      .query({ lat: 37.582, lng: 127.01, q: item.name })
      .expect(200);
    expect(nearby.body.data).toHaveLength(0);
    for (const [actor, type] of [
      [requester, 'MY_CLAIMS'],
      [keeper, 'RECEIVED_CLAIMS'],
    ] as const) {
      const history = await actor.agent
        .get('/api/v1/me/history')
        .query({ type })
        .expect(200);
      expect(
        history.body.data.find((x: { id: string }) => x.id === id)?.status,
      ).toBe('RETURNED');
    }
    const outsider = await stranger.agent
      .get('/api/v1/me/history')
      .query({ type: 'MY_CLAIMS' })
      .expect(200);
    expect(outsider.body.data).toHaveLength(0);
  });
  it('대화의 최근/이전/이후 페이지가 겹치거나 다른 요청의 커서를 받아들이지 않는다', async () => {
    const item = await h.item(keeper),
      id = await create(second, item.id);
    await h
      .post(keeper, '/claims/' + id + '/decision')
      .send({ decision: 'APPROVE' })
      .expect(200);
    for (let i = 1; i <= 5; i++)
      await h
        .post(second, '/claims/' + id + '/messages')
        .send({ body: String(i), clientMessageId: randomUUID() })
        .expect(201);
    const recent = await second.agent
      .get('/api/v1/claims/' + id + '/messages')
      .query({ limit: 2 })
      .expect(200);
    expect(
      recent.body.data.messages.map((x: { body: string }) => x.body),
    ).toEqual(['4', '5']);
    const before = await second.agent
      .get('/api/v1/claims/' + id + '/messages')
      .query({ limit: 2, before: recent.body.data.previousCursor })
      .expect(200);
    expect(
      before.body.data.messages.map((x: { body: string }) => x.body),
    ).toEqual(['2', '3']);
    await h
      .post(second, '/claims/' + id + '/messages')
      .send({ body: '6', clientMessageId: randomUUID() })
      .expect(201);
    const after = await second.agent
      .get('/api/v1/claims/' + id + '/messages')
      .query({ after: recent.body.data.nextCursor })
      .expect(200);
    expect(
      after.body.data.messages.map((x: { body: string }) => x.body),
    ).toEqual(['6']);
    await second.agent
      .get('/api/v1/claims/' + id + '/messages')
      .query({ after: 'bad' })
      .expect(400);
    await keeper.agent
      .get('/api/v1/claims/' + id + '/messages')
      .query({ after: recent.body.data.nextCursor })
      .expect(400);
    await h
      .post(second, '/claims/' + id + '/messages')
      .send({ body: 'x'.repeat(201), clientMessageId: randomUUID() })
      .expect(400);
  });
});
