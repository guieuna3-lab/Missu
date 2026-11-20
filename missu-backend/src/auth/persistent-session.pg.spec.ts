import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { APP_GUARD } from '@nestjs/core';
import { hash } from '@node-rs/argon2';
import { AuthController } from './auth.controller';
import { PersistentSessionController } from './persistent-session.controller';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../common/rate-limit.service';
import { UsersController } from '../users/users.controller';
import { setupApp } from '../setup-app';
import { digest } from '../common/crypto';
import type { INestApplication } from '@nestjs/common';

const url = process.env.SEARCH_ORDER_TEST_DATABASE_URL;
(url ? describe : describe.skip)('로그인 복원과 폐기', () => {
  let app: INestApplication, db: DatabaseService;
  const ids: string[] = [];
  const origin = 'http://localhost:3000';
  const pass = 'Persistent-QA-password-2026!';
  beforeAll(async () => {
    if (url !== 'postgresql://postgres@127.0.0.1:55439/sort_test')
      throw Error('isolated DB only');
    process.env.DATABASE_URL = url;
    process.env.PII_KEY = '1'.repeat(64);
    process.env.SIGNING_KEY = '2'.repeat(64);
    process.env.NODE_ENV = 'test';
    const module = await Test.createTestingModule({
      controllers: [
        AuthController,
        PersistentSessionController,
        UsersController,
      ],
      providers: [
        DatabaseService,
        SessionService,
        RateLimitService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(DatabaseService);
  });
  afterAll(async () => {
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });
  const api = () => request(app.getHttpServer());
  async function member() {
    const row = await db.user.create({
      data: {
        email: randomUUID() + '@qa.missu.test',
        nickname: '복원시험' + ids.length,
        passwordHash: await hash(pass),
        emailVerifiedAt: new Date(),
      },
    });
    ids.push(row.id);
    const r = await api()
      .post('/api/v1/auth/mobile/login')
      .send({ email: row.email, password: pass })
      .expect(200);
    return { ...row, token: r.body.data.accessToken as string };
  }
  it('웹 복원 자격은 HttpOnly 쿠키에만 발급하고 Origin·헤더를 검사한다', async () => {
    const m = await member();
    const path = '/api/v1/auth/browser/save';
    await api()
      .post(path)
      .set('Authorization', 'Bearer ' + m.token)
      .expect(403);
    await api()
      .post(path)
      .set('Authorization', 'Bearer ' + m.token)
      .set('Origin', 'https://other.test')
      .set('X-Missu-Session', '1')
      .expect(403);
    const result = await api()
      .post(path)
      .set('Authorization', 'Bearer ' + m.token)
      .set('Origin', origin)
      .set('X-Missu-Session', '1')
      .expect(204);
    const cookie = result.headers['set-cookie'][0].split(';')[0];
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(result.headers['cache-control']).toBe('no-store');
    await api()
      .post('/api/v1/auth/browser/restore')
      .set('Cookie', cookie)
      .expect(403);
    await db.session.update({
      where: { tokenDigest: digest('mobile:' + m.token) },
      data: { lastSeenAt: new Date(Date.now() - 31 * 60000) },
    });
    await api()
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + m.token)
      .expect(401);
    const restored = await api()
      .post('/api/v1/auth/browser/restore')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-Missu-Session', '1')
      .expect(200);
    expect(restored.body.data.user.id).toBe(m.id);
    const access = restored.body.data.accessToken;
    await api()
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + access)
      .expect(200);
    await api()
      .post('/api/v1/auth/browser/forget')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-Missu-Session', '1')
      .expect(204);
    await api()
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + access)
      .expect(401);
    await api()
      .post('/api/v1/auth/browser/restore')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-Missu-Session', '1')
      .expect(401);
  });
  it('네이티브 복원 자격은 업무 토큰으로 쓸 수 없고, 로그아웃은 같은 기기의 모든 토큰을 만료한다', async () => {
    const m = await member();
    await api()
      .post('/api/v1/auth/mobile/remember')
      .set('Origin', origin)
      .set('Authorization', 'Bearer ' + m.token)
      .expect(403);
    const r = await api()
      .post('/api/v1/auth/mobile/remember')
      .set('Authorization', 'Bearer ' + m.token)
      .expect(200);
    const token = r.body.data.token;
    await api()
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
    const one = await api()
      .post('/api/v1/auth/mobile/restore')
      .send({ token })
      .expect(200);
    const two = await api()
      .post('/api/v1/auth/mobile/restore')
      .send({ token })
      .expect(200);
    await api()
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer ' + one.body.data.accessToken)
      .expect(204);
    await api()
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + two.body.data.accessToken)
      .expect(401);
    await api().post('/api/v1/auth/mobile/restore').send({ token }).expect(401);
  });
  it('비밀번호 변경과 절대 만료 후에는 저장된 자격으로 복원하지 못한다', async () => {
    const m = await member();
    const r = await api()
      .post('/api/v1/auth/mobile/remember')
      .set('Authorization', 'Bearer ' + m.token)
      .expect(200);
    const token = r.body.data.token;
    await api()
      .patch('/api/v1/me/password')
      .set('Authorization', 'Bearer ' + m.token)
      .send({ currentPassword: pass, newPassword: pass + 'X' })
      .expect(204);
    await api().post('/api/v1/auth/mobile/restore').send({ token }).expect(401);
    const other = await member();
    const grant = await api()
      .post('/api/v1/auth/mobile/remember')
      .set('Authorization', 'Bearer ' + other.token)
      .expect(200);
    await db.session.update({
      where: { tokenDigest: digest('remember:' + grant.body.data.token) },
      data: { expiresAt: new Date(0) },
    });
    await api()
      .post('/api/v1/auth/mobile/restore')
      .send({ token: grant.body.data.token })
      .expect(401);
  });
});
