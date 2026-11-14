/** 경계 상자로 후보를 좁힌 뒤 구면 거리로 검증합니다. 날짜 변경선과 극점도 처리합니다. */
import { sinceFound } from './institution-records';
import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { ItemsService, publicSelect } from './items.service';
import { NearbyDto } from './nearby.dto';
import { digest, equal, sign } from '../common/crypto';
import { fail } from '../common/http';

@Injectable()
export class NearbyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly items: ItemsService,
  ) {}
  async search(query: NearbyDto) {
    const scope = digest(
      JSON.stringify([
        query.lat,
        query.lng,
        query.radiusM,
        query.category,
        query.registeredDays,
        query.q ?? '',
      ]),
    );
    let cursor:
      { id: string; distance: number; seen: number; scope: string } | undefined;
    if (query.cursor) {
      try {
        const [payload, signature, extra] = query.cursor.split('.');
        if (extra || !signature || !equal(sign(payload), signature))
          throw new Error();
        cursor = JSON.parse(
          Buffer.from(payload, 'base64url').toString('utf8'),
        ) as typeof cursor;
        if (
          !cursor ||
          cursor.scope !== scope ||
          !isUUID(cursor.id) ||
          !Number.isFinite(cursor.distance) ||
          cursor.distance < 0 ||
          !Number.isInteger(cursor.seen) ||
          cursor.seen < 1 ||
          cursor.seen >= 100
        )
          throw new Error();
      } catch {
        fail(
          400,
          'VALIDATION_ERROR',
          '지도 조건 또는 커서가 올바르지 않습니다.',
        );
      }
    }
    const angle = query.radiusM / 6371000,
      deltaLat = (angle * 180) / Math.PI;
    const minLat = Math.max(-90, query.lat - deltaLat),
      maxLat = Math.min(90, query.lat + deltaLat);
    const allLongitude = minLat === -90 || maxLat === 90;
    const deltaLng = allLongitude
      ? 180
      : (Math.asin(Math.sin(angle) / Math.cos((query.lat * Math.PI) / 180)) *
          180) /
        Math.PI;
    const normalize = (value: number) => ((value + 540) % 360) - 180;
    const minLng = normalize(query.lng - deltaLng),
      maxLng = normalize(query.lng + deltaLng),
      wraps = minLng > maxLng;
    const since =
      query.registeredDays === 'ALL'
        ? null
        : new Date(Date.now() - Number(query.registeredDays) * 86400000);
    const pattern = '%' + (query.q ?? '').replace(/[\\%_]/g, '\\$&') + '%';
    // SQL 본문은 고정이며 모든 입력은 바인딩합니다. 비공개 특징은 검색하지 않습니다.
    const rows = await this.db.$queryRawUnsafe<
      { id: string; distance: number; total: number }[]
    >(
      'WITH candidates AS (' +
        ' SELECT id, 6371000.0 * 2 * asin(sqrt(least(1.0,greatest(0.0,' +
        ' power(sin(radians(lat::float8-$1::float8)/2),2) +' +
        ' cos(radians($1::float8))*cos(radians(lat::float8))*power(sin(radians(lng::float8-$2::float8)/2),2))))) AS distance' +
        " FROM found_items WHERE NOT archived AND status IN ('AVAILABLE','RESERVED') AND lat BETWEEN $3 AND $4" +
        ' AND ($5::boolean OR ($6::boolean AND (lng >= $7 OR lng <= $8)) OR (NOT $6::boolean AND lng BETWEEN $7 AND $8))' +
        " AND ($9::text='ALL' OR category::text=$9)" +
        ' AND ($10::timestamptz IS NULL OR created_at >= $10)' +
        " AND ($11::text='' OR name ILIKE $12 OR public_features ILIKE $12)" +
        ' AND found_at BETWEEN $14 AND CURRENT_TIMESTAMP' +
        ') SELECT id, distance, (count(*) OVER ())::int AS total FROM candidates WHERE distance <= $13 ORDER BY distance,id LIMIT 101',
      query.lat,
      query.lng,
      minLat,
      maxLat,
      allLongitude,
      wraps,
      minLng,
      maxLng,
      query.category,
      since,
      query.q ?? '',
      pattern,
      query.radiusM,
      new Date(sinceFound() + 'T00:00:00+09:00'),
    );
    const available = rows
      .slice(0, 100)
      .filter(
        (row) =>
          !cursor ||
          row.distance > cursor.distance ||
          (row.distance === cursor.distance && row.id > cursor.id),
      );
    const remaining = 100 - (cursor?.seen ?? 0),
      page = available.slice(0, Math.min(query.limit, remaining));
    const details = await this.db.foundItem.findMany({
      where: { archived: false, id: { in: page.map((row) => row.id) } },
      select: publicSelect,
    });
    const byId = new Map(details.map((row) => [row.id, row]));
    const last = page.at(-1),
      seen = (cursor?.seen ?? 0) + page.length;
    let nextCursor: string | null = null;
    if (last && available.length > page.length && seen < 100) {
      const payload = Buffer.from(
        JSON.stringify({ id: last.id, distance: last.distance, seen, scope }),
      ).toString('base64url');
      nextCursor = payload + '.' + sign(payload);
    }
    return {
      data: page.flatMap((row) => {
        const detail = byId.get(row.id);
        return detail
          ? [
              {
                ...this.items.publicDto(detail),
                distanceM: Math.round(row.distance),
              },
            ]
          : [];
      }),
      meta: {
        total: rows[0]?.total ?? 0,
        nextCursor,
        truncated: rows.length > 100,
        ...(rows.length > 100
          ? { notice: '반경이나 조건을 좁혀 검색하세요.' }
          : {}),
      },
    };
  }
}
