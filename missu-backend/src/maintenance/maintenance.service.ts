/** 만료된 기술 데이터만 정리합니다. 회원·물품·대화의 보유 정책을 임의로 확정하지 않습니다. */
import { Injectable } from '@nestjs/common';
import { Client } from 'pg';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../integrations/storage.service';
import { config } from '../config';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}
  async run(apply = false) {
    const now = new Date(),
      cutoff = new Date(+now - 86400000);
    const sessions = await this.db.session.findMany({
      where: {
        // 로그인 복원 자격은 최대 7일 유효합니다. 미접속 하루만으로 지우지 않습니다.
        expiresAt: { lt: cutoff },
      },
      select: { id: true },
    });
    const sessionIds = sessions.map((x) => x.id);
    const challengeWhere = {
      OR: [
        { expiresAt: { lt: cutoff } },
        { consumedAt: { lt: cutoff } },
        { sessionId: { in: sessionIds } },
      ],
    };
    const photos = await this.db.itemPhoto.findMany({
      where: { state: 'READY', itemId: null, createdAt: { lt: cutoff } },
      take: 100,
      select: { id: true },
    });
    const plan = {
      mode: apply ? 'APPLY' : 'DRY_RUN',
      sessions: sessionIds.length,
      challenges: await this.db.authChallenge.count({ where: challengeWhere }),
      idempotency: await this.db.idempotencyRecord.count({
        where: { expiresAt: { lt: now } },
      }),
      rateLimits: await this.db.rateLimitBucket.count({
        where: { expiresAt: { lt: now } },
      }),
      temporaryPhotos: photos.length,
      photosDeleted: 0,
      outboxDeleted: 0,
    };
    if (!apply) return plan;
    // 서버가 여러 개여도 정리 작업은 한 번에 한 곳에서만 수행합니다.
    const lock = new Client({
      connectionString: config().databaseUrl,
      connectionTimeoutMillis: 5000,
    });
    await lock.connect();
    try {
      const acquired = await lock.query(
        "SELECT pg_try_advisory_lock(hashtextextended('missu-maintenance',0)) AS locked",
      );
      if (!acquired.rows[0].locked) return { ...plan, mode: 'ALREADY_RUNNING' };
      await this.db.$transaction(async (tx) => {
        await tx.authChallenge.deleteMany({ where: challengeWhere });
        await tx.session.deleteMany({ where: { id: { in: sessionIds } } });
        await tx.idempotencyRecord.deleteMany({
          where: { expiresAt: { lt: now } },
        });
        await tx.rateLimitBucket.deleteMany({
          where: { expiresAt: { lt: now } },
        });
      });
      for (const photo of photos) {
        await this.db.$transaction(
          async (tx) => {
            await tx.$queryRawUnsafe(
              'SELECT id FROM item_photos WHERE id=$1::uuid FOR UPDATE',
              photo.id,
            );
            const current = await tx.itemPhoto.findUnique({
              where: { id: photo.id },
            });
            if (
              !current ||
              current.state !== 'READY' ||
              current.itemId ||
              current.createdAt >= cutoff
            )
              return;
            await this.storage.remove(current.objectKey);
            await tx.itemPhoto.delete({ where: { id: current.id } });
            plan.photosDeleted++;
          },
          { timeout: 10000 },
        );
      }
      if (!config().production) {
        const files = await readdir(config().outboxPath).catch(() => []);
        for (const name of files) {
          if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
          const path = resolve(config().outboxPath, name);
          const value = await readFile(path, 'utf8')
            .then((content) => JSON.parse(content) as { expiresAt?: string })
            .catch(() => null);
          if (value?.expiresAt && Date.parse(value.expiresAt) < +now) {
            await unlink(path);
            plan.outboxDeleted++;
          }
        }
      }
      return plan;
    } finally {
      await lock.end();
    }
  }
}
