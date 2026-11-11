/** 사용자가 동의한 경로만 저장하고, 사용자 경계와 48시간 만료를 모든 조회에서 적용합니다. */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { decrypt, sign, encrypt } from '../common/crypto';
import { fail } from '../common/http';
import { config } from '../config';
import type { Prisma } from '../generated/prisma/client';
import { AppendRouteDto, ROUTE_POLICY, StartRouteDto } from './routes.dto';
import { NearbyService } from '../items/nearby.service';
import { NearbyDto } from '../items/nearby.dto';

const HOUR = 3600000,
  RETENTION = 48 * HOUR;
@Injectable()
export class RoutesService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  private readonly logger = new Logger(RoutesService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly nearby: NearbyService,
  ) {}
  async onModuleInit() {
    await this.purgeExpired();
    // 요청이 없어도 정리합니다. 서버가 꺼져 있으면 다음 시작 때 먼저 만료 데이터를 지웁니다.
    this.timer = setInterval(() => {
      void this.purgeExpired().catch(() =>
        this.logger.error('이동 경로 만료 정리 실패'),
      );
    }, 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async purgeExpired() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const now = new Date();
      await this.db.routePoint.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      await this.db.routeRecording.updateMany({
        where: { stoppedAt: null, autoStopsAt: { lte: now } },
        data: { stoppedAt: now },
      });
      await this.db.routeRecording.deleteMany({
        where: { expiresAt: { lte: now } },
      });
    } finally {
      this.cleaning = false;
    }
  }
  private async lock(tx: Prisma.TransactionClient, userId: string) {
    // 시작·업로드·중지·삭제를 사용자 단위로 직렬화하여 중지 직후 다시 기록되는 경쟁을 막습니다.
    await tx.$queryRawUnsafe(
      'SELECT id FROM users WHERE id=$1::uuid FOR UPDATE',
      userId,
    );
  }
  private bounds(date: string) {
    const stamp = Date.parse(date + 'T00:00:00.000Z');
    if (
      !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== date
    )
      fail(400, 'VALIDATION_ERROR', '실제 달력에 있는 날짜를 입력하세요.');
    const start = new Date(stamp - 9 * HOUR);
    return { gte: start, lt: new Date(+start + 24 * HOUR) };
  }
  async status(userId: string) {
    const now = new Date();
    const active = await this.db.routeRecording.findFirst({
      where: {
        userId,
        stoppedAt: null,
        autoStopsAt: { gt: now },
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        source: true,
        startedAt: true,
        autoStopsAt: true,
        stoppedAt: true,
      },
    });
    return {
      active,
      policyVersion: ROUTE_POLICY,
      retentionHours: 48,
      timeZone: 'Asia/Seoul',
      maxRecordingHours: 24,
    };
  }
  async start(userId: string, dto: StartRouteDto) {
    if (dto.source === 'DEMO' && config().production)
      fail(
        400,
        'DEMO_DISABLED',
        '운영 서버에서는 가상 경로를 기록하지 않습니다.',
      );
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const existing = await tx.routeRecording.findUnique({
        where: { id: dto.clientRecordingId },
      });
      if (existing) {
        if (existing.userId !== userId)
          fail(404, 'RESOURCE_NOT_FOUND', '기록을 찾을 수 없습니다.');
        if (existing.source !== dto.source)
          fail(
            409,
            'IDEMPOTENCY_CONFLICT',
            '같은 기록 번호의 입력이 변경됐습니다.',
          );
        if (existing.expiresAt <= new Date())
          fail(
            409,
            'ROUTE_EXPIRED',
            '만료된 기록 번호입니다. 새 기록을 시작하세요.',
          );
        return this.recordingDto(existing);
      }
      const now = new Date();
      await tx.routeRecording.updateMany({
        where: { userId, stoppedAt: null },
        data: { stoppedAt: now },
      });
      const row = await tx.routeRecording.create({
        data: {
          id: dto.clientRecordingId,
          userId,
          source: dto.source,
          policyVersion: dto.policyVersion,
          startedAt: now,
          autoStopsAt: new Date(+now + 24 * HOUR),
          expiresAt: new Date(+now + RETENTION),
        },
      });
      return this.recordingDto(row);
    });
  }
  private recordingDto(row: {
    id: string;
    source: string;
    startedAt: Date;
    autoStopsAt: Date;
    stoppedAt: Date | null;
  }) {
    return {
      id: row.id,
      source: row.source,
      startedAt: row.startedAt,
      autoStopsAt: row.autoStopsAt,
      stoppedAt: row.stoppedAt,
    };
  }
  async append(userId: string, id: string, dto: AppendRouteDto) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const session = await tx.routeRecording.findFirst({
          where: { id, userId },
        }),
        now = new Date();
      if (!session) fail(404, 'RESOURCE_NOT_FOUND', '기록을 찾을 수 없습니다.');
      if (session.stoppedAt || session.autoStopsAt <= now)
        fail(409, 'RECORDING_STOPPED', '위치 기록이 중지됐습니다.');
      const rows = dto.points.map((point) => {
        const recordedAt = new Date(point.recordedAt),
          expiresAt = new Date(+recordedAt + RETENTION);
        if (
          recordedAt < session.startedAt ||
          recordedAt >= session.autoStopsAt ||
          +recordedAt > +now + 60000 ||
          expiresAt <= now
        )
          fail(
            400,
            'POINT_TIME_INVALID',
            '기록 시작 이후의 유효한 위치 관측 시각만 보낼 수 있습니다.',
          );
        const position = {
          lat: point.lat,
          lng: point.lng,
          accuracyM: point.accuracyM,
        };
        return {
          clientPointId: point.clientPointId,
          recordedAt,
          expiresAt,
          payloadHash: sign(
            JSON.stringify([recordedAt.toISOString(), position]),
          ),
          positionCiphertext: encrypt(JSON.stringify(position)),
        };
      });
      const existing = await tx.routePoint.findMany({
        where: {
          recordingId: id,
          clientPointId: { in: rows.map((p) => p.clientPointId) },
        },
        select: { clientPointId: true, payloadHash: true },
      });
      const byId = new Map(
        existing.map((p) => [p.clientPointId, p.payloadHash]),
      );
      for (const point of rows)
        if (
          byId.has(point.clientPointId) &&
          byId.get(point.clientPointId) !== point.payloadHash
        )
          fail(
            409,
            'IDEMPOTENCY_CONFLICT',
            '같은 위치 번호의 내용이 변경됐습니다.',
          );
      const fresh = rows.filter((p) => !byId.has(p.clientPointId));
      const count = await tx.routePoint.count({
        where: { recording: { userId }, expiresAt: { gt: now } },
      });
      if (count + fresh.length > 6000)
        fail(
          429,
          'ROUTE_CAPACITY',
          '48시간 동안 최대 6,000개 위치를 보관할 수 있습니다.',
        );
      if (fresh.length) {
        await tx.routePoint.createMany({
          data: fresh.map((p) => ({ ...p, recordingId: id })),
        });
        const expiresAt = new Date(
          Math.max(+session.expiresAt, ...fresh.map((p) => +p.expiresAt)),
        );
        await tx.routeRecording.update({ where: { id }, data: { expiresAt } });
      }
      return {
        accepted: fresh.length,
        duplicates: existing.length,
        retentionHours: 48,
      };
    });
  }
  async stop(userId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const row = await tx.routeRecording.findFirst({ where: { id, userId } });
      if (!row) fail(404, 'RESOURCE_NOT_FOUND', '기록을 찾을 수 없습니다.');
      return this.recordingDto(
        row.stoppedAt
          ? row
          : await tx.routeRecording.update({
              where: { id },
              data: { stoppedAt: new Date() },
            }),
      );
    });
  }
  async day(userId: string, date: string) {
    const now = new Date();
    const rows = await this.db.routePoint.findMany({
      where: {
        recording: { userId },
        recordedAt: this.bounds(date),
        expiresAt: { gt: now },
      },
      include: { recording: { select: { source: true } } },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      take: 6000,
    });
    return {
      date,
      timeZone: 'Asia/Seoul',
      retentionHours: 48,
      points: rows.map((row) => ({
        id: row.id,
        recordingId: row.recordingId,
        source: row.recording.source,
        recordedAt: row.recordedAt,
        expiresAt: row.expiresAt,
        ...(JSON.parse(decrypt(row.positionCiphertext)) as {
          lat: number;
          lng: number;
          accuracyM: number;
        }),
      })),
    };
  }
  async nearbyAt(userId: string, pointId: string) {
    const point = await this.db.routePoint.findFirst({
      where: {
        id: pointId,
        recording: { userId },
        expiresAt: { gt: new Date() },
      },
    });
    if (!point)
      fail(404, 'RESOURCE_NOT_FOUND', '유효한 본인 기록을 찾을 수 없습니다.');
    const position = JSON.parse(decrypt(point.positionCiphertext)) as {
      lat: number;
      lng: number;
    };
    const query = new NearbyDto();
    query.lat = position.lat;
    query.lng = position.lng;
    query.radiusM = 500;
    query.limit = 100;
    return this.nearby.search(query);
  }
  async remove(userId: string, date?: string) {
    const range = date ? this.bounds(date) : null;
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, userId);
      await tx.routeRecording.updateMany({
        where: { userId, stoppedAt: null },
        data: { stoppedAt: new Date() },
      });
      const result = await tx.routePoint.deleteMany({
        where: {
          recording: { userId },
          ...(range ? { recordedAt: range } : {}),
        },
      });
      if (!range) await tx.routeRecording.deleteMany({ where: { userId } });
      return { deletedPoints: result.count, recordingStopped: true };
    });
  }
}
