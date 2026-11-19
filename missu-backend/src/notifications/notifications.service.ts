import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { decrypt, digest, encrypt } from '../common/crypto';
import { fail } from '../common/http';
import { Prisma } from '../generated/prisma/client';
import { FirebaseSender } from './firebase-sender';
import { similarItem, type MatchItem, type MatchReport } from './match-rule';

type Report = MatchReport & { id: string; enabledAt: Date };
type Event = { item_id: string; item: MatchItem; created_at: Date };
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(NotificationsService.name);
  readonly sender = new FirebaseSender();
  constructor(private readonly db: DatabaseService) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async settings(userId: string, reportId: string) {
    await this.ownedReport(userId, reportId);
    const rows = await this.db.$queryRaw<
      { report_id: string }[]
    >`SELECT report_id FROM match_alert_preferences WHERE report_id=${reportId}::uuid`;
    return {
      enabled: rows.length > 0,
      pushAvailable: this.sender.configured(),
    };
  }
  private async ownedReport(userId: string, reportId: string) {
    const report = await this.db.lostReport.findFirst({
      where: { id: reportId, userId },
    });
    if (!report) fail(404, 'NOT_FOUND', '분실 신고를 찾을 수 없어요.');
    return report;
  }
  async setEnabled(userId: string, reportId: string, enabled: boolean) {
    await this.ownedReport(userId, reportId);
    await this.db.$transaction(async (tx) => {
      // 해제 시 이미 예약된 푸시도 함께 취소합니다.
      if (enabled)
        await tx.$executeRaw`INSERT INTO match_alert_preferences(report_id) VALUES(${reportId}::uuid) ON CONFLICT DO NOTHING`;
      else {
        await tx.$executeRaw`DELETE FROM match_alert_preferences WHERE report_id=${reportId}::uuid`;
        await tx.$executeRaw`DELETE FROM push_deliveries d USING match_notifications n WHERE d.notification_id=n.id AND n.report_id=${reportId}::uuid`;
      }
    });
    return { enabled };
  }
  async register(userId: string, token: string, binding: string) {
    if (!this.sender.configured())
      fail(
        503,
        'PUSH_UNAVAILABLE',
        '휴대폰 알림 연결을 준비 중이에요. 앱 안의 알림은 사용할 수 있어요.',
      );
    const hash = digest(token);
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId},0))`;
      // 다른 계정으로 로그인하면 이전 수신 예약을 지운 뒤 현재 계정에 연결합니다.
      await tx.$executeRaw`DELETE FROM push_deliveries d USING push_devices p WHERE d.token_hash=p.token_hash AND p.token_hash=${hash} AND (p.user_id<>${userId}::uuid OR p.binding<>${binding}::uuid)`;
      await tx.$executeRaw`INSERT INTO push_devices(token_hash,user_id,token_ciphertext,binding) VALUES(${hash},${userId}::uuid,${encrypt(token)},${binding}::uuid)
        ON CONFLICT(token_hash) DO UPDATE SET user_id=EXCLUDED.user_id,token_ciphertext=EXCLUDED.token_ciphertext,binding=EXCLUDED.binding,updated_at=now()`;
      await tx.$executeRaw`DELETE FROM push_devices WHERE user_id=${userId}::uuid AND token_hash IN(SELECT token_hash FROM push_devices WHERE user_id=${userId}::uuid ORDER BY updated_at DESC OFFSET 5)`;
    });
    return { registered: true };
  }
  async unregister(userId: string, token: string, binding: string) {
    // 늦게 도착한 이전 로그인 해제가 새 로그인 연결을 지우지 않게 합니다.
    await this.db
      .$executeRaw`DELETE FROM push_devices WHERE user_id=${userId}::uuid AND token_hash=${digest(token)} AND binding=${binding}::uuid`;
    return { registered: false };
  }
  async list(userId: string, before?: string) {
    let cursor: { at: Date; id: string } | undefined;
    if (before) {
      const [at, id, extra] = before.split('_');
      if (
        extra ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          id ?? '',
        ) ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) ||
        !Number.isFinite(Date.parse(at))
      )
        fail(400, 'VALIDATION_ERROR', '알림 목록을 다시 열어 주세요.');
      cursor = { at: new Date(at), id };
    }
    const rows = await this.db.$queryRaw<
      {
        id: string;
        reportId: string;
        itemId: string;
        itemName: string;
        createdAt: Date;
        readAt: Date | null;
      }[]
    >(Prisma.sql`
      SELECT id,report_id AS "reportId",item_id AS "itemId",item_name AS "itemName",created_at AS "createdAt",read_at AS "readAt"
      FROM match_notifications WHERE user_id=${userId}::uuid ${cursor ? Prisma.sql`AND (created_at < ${cursor.at} OR (created_at=${cursor.at} AND id<${cursor.id}::uuid))` : Prisma.sql``}
      ORDER BY created_at DESC,id DESC LIMIT 51`);
    return {
      items: rows.slice(0, 50),
      nextCursor:
        rows.length > 50
          ? rows[49].createdAt.toISOString() + '_' + rows[49].id
          : null,
    };
  }
  async read(userId: string, id: string) {
    const n = await this.db
      .$executeRaw`UPDATE match_notifications SET read_at=coalesce(read_at,now()) WHERE id=${id}::uuid AND user_id=${userId}::uuid`;
    if (!n) fail(404, 'NOT_FOUND', '알림을 찾을 수 없어요.');
    return { read: true };
  }
  async collect() {
    return this.db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { ok: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(20261120,2) AS ok`;
        if (!lock.ok) return 0;
        const events = await tx.$queryRaw<
          Event[]
        >`SELECT item_id,item,created_at FROM match_item_events ORDER BY created_at,item_id LIMIT 200 FOR UPDATE SKIP LOCKED`;
        if (!events.length) return 0;
        const reports = await tx.$queryRaw<
          Report[]
        >`SELECT r.id,r.user_id AS "userId",r.name,r.category,r.lost_start AS "lostStart",r.lat::float8 AS lat,r.lng::float8 AS lng,coalesce(r.place_name,r.lost_label) AS place,p.enabled_at AS "enabledAt" FROM lost_reports r JOIN match_alert_preferences p ON r.id=p.report_id WHERE r.lost_start>=now()-interval '6 months'`;
        const points = await tx.$queryRaw<
          { storage: string; lat: number; lng: number }[]
        >`SELECT storage,lat,lng FROM institution_place_points WHERE lat IS NOT NULL AND lng IS NOT NULL`;
        const geo = new Map(points.map((p) => [p.storage, p]));
        const ids = events.map((e) => e.item_id);
        const active = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id::text FROM found_items WHERE id::text IN(${Prisma.join(ids)}) AND NOT archived AND status='AVAILABLE'
        UNION ALL SELECT id FROM verified_portal_items WHERE id IN(${Prisma.join(ids)}) AND stored
        UNION ALL SELECT i->>'id' FROM institution_school_snapshot, jsonb_array_elements(items) i WHERE i->>'id' IN(${Prisma.join(ids)})`);
        const available = new Set(active.map((r) => r.id));
        for (const event of events) {
          const point = event.item.storage
            ? geo.get(event.item.storage)
            : undefined;
          if (point && event.item.lat === undefined) {
            event.item.lat = point.lat;
            event.item.lng = point.lng;
          }
          if (available.has(event.item_id))
            for (const report of reports) {
              if (
                report.enabledAt > event.created_at ||
                !similarItem(report, event.item)
              )
                continue;
              const id = randomUUID();
              const inserted =
                await tx.$executeRaw`INSERT INTO match_notifications(id,user_id,report_id,item_id,item_name) VALUES(${id}::uuid,${report.userId}::uuid,${report.id}::uuid,${event.item_id},${event.item.name}) ON CONFLICT(report_id,item_id) DO NOTHING`;
              if (inserted)
                await tx.$executeRaw`INSERT INTO push_deliveries(notification_id,token_hash,binding) SELECT ${id}::uuid,token_hash,binding FROM push_devices WHERE user_id=${report.userId}::uuid AND updated_at>now()-interval '90 days'`;
            }
        }
        await tx.$executeRaw(
          Prisma.sql`DELETE FROM match_item_events WHERE item_id IN(${Prisma.join(ids)})`,
        );
        return events.length;
      },
      { timeout: 20000 },
    );
  }
  async deliver() {
    if (!this.sender.configured()) return;
    // 짧은 임대 시간을 먼저 저장해 여러 서버가 같은 예약을 동시에 발송하지 않게 합니다.
    const rows = await this.db.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        {
          notification_id: string;
          token_hash: string;
          binding: string;
          token_ciphertext: string;
        }[]
      >`
        SELECT d.notification_id,d.token_hash,d.binding,p.token_ciphertext FROM push_deliveries d
        JOIN push_devices p ON p.token_hash=d.token_hash AND p.binding=d.binding
        JOIN match_notifications n ON n.id=d.notification_id AND n.user_id=p.user_id
        JOIN match_alert_preferences a ON a.report_id=n.report_id
        WHERE d.retry_at<=now() AND d.attempts<6 AND n.created_at>now()-interval '1 day'
        ORDER BY d.retry_at LIMIT 10 FOR UPDATE OF d SKIP LOCKED`;
      for (const d of due)
        await tx.$executeRaw`UPDATE push_deliveries SET attempts=attempts+1,retry_at=now()+interval '2 minutes' WHERE notification_id=${d.notification_id}::uuid AND token_hash=${d.token_hash}`;
      return due;
    });
    for (const d of rows) {
      const result = await this.sender.send(
        decrypt(d.token_ciphertext),
        d.binding,
        d.notification_id,
      );
      if (result === 'invalid')
        await this.db
          .$executeRaw`DELETE FROM push_devices WHERE token_hash=${d.token_hash} AND binding=${d.binding}::uuid`;
      else if (result === 'sent')
        await this.db
          .$executeRaw`DELETE FROM push_deliveries WHERE notification_id=${d.notification_id}::uuid AND token_hash=${d.token_hash}`;
    }
    await this.db
      .$executeRaw`DELETE FROM push_deliveries WHERE attempts>=6 AND retry_at<=now()`;
    await this.db
      .$executeRaw`DELETE FROM push_deliveries d USING match_notifications n WHERE d.notification_id=n.id AND n.created_at<now()-interval '1 day'`;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let i = 0; i < 5; i++) if ((await this.collect()) < 200) break;
      await this.deliver();
    } catch {
      this.logger.warn('분실 신고 알림 작업을 다음 주기에 재시도합니다.');
    } finally {
      this.busy = false;
    }
  }
}
