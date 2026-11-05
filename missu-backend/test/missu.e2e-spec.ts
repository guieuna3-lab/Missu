import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import sharp from 'sharp';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { DatabaseService } from '../src/database/database.service';

// 실제 PostgreSQL 시험 DB를 사용해 저장·권한·동시 등록을 함께 검사합니다.
describe('MissU PostgreSQL API', () => {
  let app: INestApplication, db: DatabaseService, png: Buffer;
  let keeper: Actor, visitor: Actor;
  let itemId: string, photoId: string;
  const userIds: string[] = [],
    suffix = randomUUID().slice(0, 8),
    password = 'Test-password-2026!';
  const secret = '나만 아는 안쪽 각인 ' + suffix;
  const origin = 'http://localhost:3000';
  type Actor = {
    agent: ReturnType<typeof request.agent>;
    csrf: string;
    id: string;
    email: string;
  };
  const baseItem = (photoIds: string[]) => ({
    name: '시험이어폰' + suffix,
    publicFeatures: '파란 별무늬',
    foundAt: '2026-11-01T12:00:00+09:00',
    foundLocation: { label: '한성대학교 도서관', lat: 37.582, lng: 127.01 },
    photoIds,
    storagePlace: '도서관 안내데스크',
    privateFeatures: secret,
  });
  const change = (actor: Actor, path: string, key = randomUUID()) =>
    actor.agent
      .post('/api/v1' + path)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .set('Idempotency-Key', key);
  async function actor(label: string): Promise<Actor> {
    const email = `${label}-${suffix}@missu.test`;
    const user = await db.user.create({
      data: {
        email,
        nickname: '시험' + label,
        passwordHash: await hash(password, {
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const agent = request.agent(app.getHttpServer());
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ email, password })
      .expect(200);
    return { agent, csrf: login.body.data.csrfToken, id: user.id, email };
  }
  async function upload(a: Actor) {
    const res = await change(a, '/uploads')
      .attach('file', png, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    return res.body.data.photoId as string;
  }
  beforeAll(async () => {
    if (
      process.env.MISSU_TEST_DATABASE !== '1' ||
      !process.env.DATABASE_URL?.includes('/missu_test')
    )
      throw new Error('전용 시험 DB에서만 실행할 수 있습니다.');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(DatabaseService);
    png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#4080ff' },
    })
      .png()
      .withMetadata()
      .toBuffer();
    keeper = await actor('보관자');
    visitor = await actor('방문자');
    photoId = await upload(keeper);
  }, 30000);
  afterAll(async () => {
    if (db && userIds.length) {
      const photos = await db.itemPhoto.findMany({
        where: { uploaderId: { in: userIds } },
      });
      await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
      await db.idempotencyRecord.deleteMany({
        where: { userId: { in: userIds } },
      });
      await db.itemPhoto.deleteMany({ where: { uploaderId: { in: userIds } } });
      await db.foundItemSecret.deleteMany({
        where: { item: { keeperId: { in: userIds } } },
      });
      await db.foundItem.deleteMany({ where: { keeperId: { in: userIds } } });
      await db.lostReport.deleteMany({ where: { userId: { in: userIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      for (const photo of photos)
        await unlink(resolve(process.env.STORAGE_PATH!, photo.objectKey)).catch(
          () => {},
        );
    }
    await app?.close();
  });
  it('DB 준비 상태를 확인한다', async () => {
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
  it('비회원 등록을 차단한다', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/items')
      .send(baseItem([photoId]))
      .expect(401);
  });
  it('CSRF 토큰과 접속 출처를 확인한다', async () => {
    await keeper.agent
      .post('/api/v1/items')
      .set('Origin', origin)
      .send(baseItem([photoId]))
      .expect(403);
    await change(keeper, '/items')
      .set('Origin', 'https://untrusted.invalid')
      .send(baseItem([photoId]))
      .expect(403);
  });
  it('로그인 후 이전 CSRF 토큰을 폐기한다', async () => {
    const agent = request.agent(app.getHttpServer());
    const before = await agent.get('/api/v1/auth/csrf').expect(200);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', before.body.data.csrfToken)
      .send({ email: keeper.email, password })
      .expect(200);
    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', before.body.data.csrfToken)
      .send({})
      .expect(403);
  });
  it('가짜 이미지와 과대 파일을 거절한다', async () => {
    await change(keeper, '/uploads')
      .attach('file', Buffer.from('not an image'), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(415);
    await change(keeper, '/uploads')
      .attach('file', png, {
        filename: 'photo.svg',
        contentType: 'image/svg+xml',
      })
      .expect(415);
    await change(keeper, '/uploads')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(413);
  });
  it.each([
    ['사진 없음', { photoIds: [] }],
    ['보관 장소 없음', { storagePlace: ' ' }],
    ['좌표 범위', { foundLocation: { label: '장소', lat: 91, lng: 0 } }],
    ['미래 시각', { foundAt: '2099-01-01T00:00:00Z' }],
    ['시간대 없음', { foundAt: '2026-01-01T00:00:00' }],
    ['위치 없음', { foundLocation: undefined }],
    ['위치 배열', { foundLocation: [] }],
    ['사용자 ID 위조', { keeperId: randomUUID() }],
  ])('필수 입력 검사: %s', async (_label, override) => {
    await change(keeper, '/items')
      .send({ ...baseItem([photoId]), ...override })
      .expect(400);
  });
  it('사진 등록과 공개/관리 상세의 정보 분리를 검증한다', async () => {
    const created = await change(keeper, '/items')
      .send(baseItem([photoId]))
      .expect(201);
    itemId = created.body.data.id;
    const publicResult = await request(app.getHttpServer())
      .get('/api/v1/items/' + itemId)
      .expect(200);
    expect(publicResult.body.data.name).toBe(baseItem([]).name);
    expect(publicResult.body.data.keeperId).toBeUndefined();
    expect(publicResult.body.data.privateFeatures).toBeUndefined();
    expect(JSON.stringify(publicResult.body)).not.toContain(secret);
    const encrypted = await db.foundItemSecret.findUniqueOrThrow({
      where: { itemId },
    });
    expect(encrypted.featuresCiphertext).not.toContain(secret);
    const managed = await keeper.agent
      .get(`/api/v1/items/${itemId}/manage`)
      .expect(200);
    expect(managed.body.data.privateFeatures).toBe(secret);
    await visitor.agent.get(`/api/v1/items/${itemId}/manage`).expect(404);
    const photo = await request(app.getHttpServer())
      .get(publicResult.body.data.photos[0].url)
      .expect(200);
    const metadata = await sharp(photo.body as Buffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    await request(app.getHttpServer())
      .get(
        publicResult.body.data.photos[0].url.replace(
          /signature=./,
          'signature=x',
        ),
      )
      .expect(404);
  });
  it('외부 사용자 사진과 이미 사용한 사진을 거절하고 생성도 취소한다', async () => {
    const before = await db.foundItem.count({ where: { keeperId: keeper.id } });
    const foreign = await upload(visitor);
    await change(keeper, '/items')
      .send(baseItem([foreign]))
      .expect(409);
    await change(keeper, '/items')
      .send(baseItem([photoId]))
      .expect(409);
    expect(await db.foundItem.count({ where: { keeperId: keeper.id } })).toBe(
      before,
    );
  });
  it('동시 재전송은 등록 한 건만 만들고 다른 본문은 충돌로 처리한다', async () => {
    const id = await upload(keeper),
      key = randomUUID(),
      body = baseItem([id]);
    const [a, b] = await Promise.all([
      change(keeper, '/items', key).send(body),
      change(keeper, '/items', key).send(body),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(
      await db.foundItem.count({ where: { photos: { some: { id } } } }),
    ).toBe(1);
    await change(keeper, '/items', key)
      .send({ ...body, name: '다른 물품' })
      .expect(409);
  });
  it('이름·공개 특징·장소를 검색하고 비공개 특징은 검색하지 않는다', async () => {
    const search = await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ q: suffix, place: '한성대학교' })
      .expect(200);
    expect(search.body.data.length).toBeGreaterThanOrEqual(2);
    const privateSearch = await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ q: secret })
      .expect(200);
    expect(privateSearch.body.data).toEqual([]);
    const empty = await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ q: suffix, place: '존재하지않는장소' })
      .expect(200);
    expect(empty.body.data).toEqual([]);
    const wildcard = await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ q: '%' })
      .expect(200);
    expect(wildcard.body.data).toEqual([]);
  });
  it('페이지 커서의 변조와 다른 검색조건 재사용을 막는다', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ q: suffix, limit: 1 })
      .expect(200);
    const cursor = first.body.meta.nextCursor;
    expect(cursor).toBeTruthy();
    const second = await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ q: suffix, limit: 1, cursor })
      .expect(200);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ q: '다른검색', cursor })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/items')
      .query({ q: suffix, cursor: cursor + 'x' })
      .expect(400);
  });
  it('분실 신고를 본인에게만 보여주고 시간 범위를 검증한다', async () => {
    const body = {
      name: '분실지갑' + suffix,
      features: '안쪽 스티커',
      lostTime: {
        start: '2026-11-01T10:00:00Z',
        end: '2026-11-01T11:00:00Z',
        precision: 'APPROX',
      },
      lostLocation: { label: '학교', lat: 37.58, lng: 127.01 },
    };
    const created = await change(visitor, '/lost-reports')
      .send(body)
      .expect(201);
    await visitor.agent
      .get('/api/v1/lost-reports/' + created.body.data.id)
      .expect(200);
    await keeper.agent
      .get('/api/v1/lost-reports/' + created.body.data.id)
      .expect(404);
    await change(visitor, '/lost-reports')
      .send({
        ...body,
        lostTime: { ...body.lostTime, end: '2026-10-01T00:00:00Z' },
      })
      .expect(400);
    const history = await visitor.agent
      .get('/api/v1/me/history?type=LOST_REPORTS')
      .expect(200);
    expect(history.body.data.map((r: { id: string }) => r.id)).toContain(
      created.body.data.id,
    );
    const otherHistory = await keeper.agent
      .get('/api/v1/me/history?type=LOST_REPORTS')
      .expect(200);
    expect(otherHistory.body.data).toEqual([]);
  });
  it('DB 연결을 다시 열어도 등록한 물품이 유지된다', async () => {
    await db.$disconnect();
    await db.$connect();
    const res = await request(app.getHttpServer())
      .get('/api/v1/items/' + itemId)
      .expect(200);
    expect(res.body.data.id).toBe(itemId);
  });
  it('로그아웃하면 서버에서 세션을 무효화한다', async () => {
    await change(visitor, '/auth/logout').send({}).expect(204);
    await visitor.agent.get('/api/v1/me').expect(401);
  });
});
