/** 시험마다 고유 계정·제한 키를 사용하고 자신이 만든 데이터만 정리합니다. */
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { DatabaseService } from '../src/database/database.service';
import {
  RateLimitService,
  type RateLimit,
} from '../src/common/rate-limit.service';
import { digest, sign } from '../src/common/crypto';

export const testPassword = 'Missu-test-password-2026!';
export const origin = 'http://localhost:3000';
export type Actor = {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  id: string;
  email: string;
};
export async function harness() {
  if (
    process.env.MISSU_TEST_DATABASE !== '1' ||
    new URL(process.env.DATABASE_URL!).pathname !== '/missu_test'
  )
    throw new Error('전용 시험 DB가 필요합니다.');
  const run = randomUUID(),
    rateIds = new Set<string>(),
    sessionIds: string[] = [],
    userIds: string[] = [];
  let scope = 'setup';
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RateLimitService)
    .useFactory({
      inject: [DatabaseService],
      factory: (db: DatabaseService) => {
        const rates = new RateLimitService(db);
        const key = (value: string) => {
          const k = run + ':' + scope + ':' + value;
          rateIds.add(sign('rate:' + k));
          return k;
        };
        return {
          consume: (value: string, maximum: number, ms: number) =>
            rates.consume(key(value), maximum, ms),
          consumeAll: (rules: RateLimit[]) =>
            rates.consumeAll(
              rules.map((rule) => ({ ...rule, key: key(rule.key) })),
            ),
          reset: (value: string) => rates.reset(key(value)),
        };
      },
    })
    .compile();
  const app = module.createNestApplication();
  setupApp(app);
  await app.init();
  const db = app.get(DatabaseService);
  async function capture(response: request.Response) {
    const cookies = response.headers['set-cookie'];
    for (const value of Array.isArray(cookies)
      ? cookies
      : cookies
        ? [cookies]
        : []) {
      const raw = /mishu_session=([a-f0-9]{64})/.exec(value)?.[1];
      if (raw) {
        const session = await db.session.findUnique({
          where: { tokenDigest: digest(raw) },
        });
        if (session) sessionIds.push(session.id);
      }
    }
  }
  async function anonymous(): Promise<Actor> {
    const agent = request.agent(app.getHttpServer());
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    await capture(csrf);
    return { agent, csrf: csrf.body.data.csrfToken, id: '', email: '' };
  }
  const post = (actor: Actor, path: string, key = randomUUID()) =>
    actor.agent
      .post('/api/v1' + path)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .set('Idempotency-Key', key);
  async function login(actor: Actor, password = testPassword) {
    const csrf = await actor.agent.get('/api/v1/auth/csrf').expect(200);
    await capture(csrf);
    actor.csrf = csrf.body.data.csrfToken;
    const response = await post(actor, '/auth/login')
      .send({ email: actor.email, password })
      .expect(200);
    await capture(response);
    actor.csrf = response.body.data.csrfToken;
    return actor;
  }
  async function user(label: string, phone = true) {
    const email = label + '-' + randomUUID() + '@missu.test';
    const saved = await db.user.create({
      data: {
        email,
        nickname: '시험회원',
        passwordHash: await hash(testPassword, {
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: phone ? new Date() : null,
      },
    });
    userIds.push(saved.id);
    const actor = await anonymous();
    actor.id = saved.id;
    actor.email = email;
    return login(actor);
  }
  async function item(keeper: Actor, extra: Record<string, unknown> = {}) {
    return db.foundItem.create({
      data: {
        keeperId: keeper.id,
        name: '시험물품' + randomUUID().slice(0, 8),
        foundAt: new Date(Date.now() - 3600000),
        foundLabel: '한성대학교',
        lat: 37.582,
        lng: 127.01,
        storagePlace: '시험보관함',
        ...extra,
      },
    });
  }
  async function code(id: string) {
    return (
      JSON.parse(
        await readFile(resolve(process.env.OUTBOX_PATH!, id + '.json'), 'utf8'),
      ) as { code: string }
    ).code;
  }
  async function close() {
    const challenges = await db.authChallenge.findMany({
      where: {
        OR: [{ sessionId: { in: sessionIds } }, { userId: { in: userIds } }],
      },
    });
    const photos = await db.itemPhoto.findMany({
      where: { uploaderId: { in: userIds } },
    });
    const claims = await db.claim.findMany({
      where: {
        OR: [
          { requesterId: { in: userIds } },
          { item: { keeperId: { in: userIds } } },
        ],
      },
      select: { id: true },
    });
    const ids = claims.map((x) => x.id);
    await db.itemPhoto.deleteMany({ where: { uploaderId: { in: userIds } } });
    await db.abuseReport.deleteMany({ where: { claimId: { in: ids } } });
    await db.message.deleteMany({ where: { claimId: { in: ids } } });
    await db.claim.deleteMany({ where: { id: { in: ids } } });
    await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
    await db.idempotencyRecord.deleteMany({
      where: { userId: { in: userIds } },
    });
    await db.foundItemSecret.deleteMany({
      where: { item: { keeperId: { in: userIds } } },
    });
    await db.foundItem.deleteMany({ where: { keeperId: { in: userIds } } });
    await db.lostReport.deleteMany({ where: { userId: { in: userIds } } });
    await db.authChallenge.deleteMany({
      where: { id: { in: challenges.map((x) => x.id) } },
    });
    await db.consent.deleteMany({ where: { userId: { in: userIds } } });
    await db.session.deleteMany({
      where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
    });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.rateLimitBucket.deleteMany({
      where: { id: { in: [...rateIds] } },
    });
    for (const row of challenges)
      await unlink(resolve(process.env.OUTBOX_PATH!, row.id + '.json')).catch(
        () => {},
      );
    for (const row of photos)
      await unlink(resolve(process.env.STORAGE_PATH!, row.objectKey)).catch(
        () => {},
      );
    await app.close();
  }
  return {
    app,
    db,
    userIds,
    sessionIds,
    rateIds,
    anonymous,
    login,
    user,
    item,
    post,
    code,
    close,
    beginCase: () => {
      scope = randomUUID();
    },
  };
}
export type Harness = Awaited<ReturnType<typeof harness>>;
export const claimBody = () => ({
  features: '안쪽 별무늬가 있습니다.',
  lostTime: {
    start: new Date(Date.now() - 7200000).toISOString(),
    end: new Date(Date.now() - 3600000).toISOString(),
    precision: 'APPROX',
  },
  lostLocation: { label: '한성대학교', lat: 37.582, lng: 127.01 },
});
