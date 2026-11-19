import { Prisma, type VerifiedPortalItem } from '../generated/prisma/client';
import type { DatabaseService } from '../database/database.service';
import { digest, equal, sign } from '../common/crypto';
import { fail } from '../common/http';
import {
  distance,
  koreaDay,
  sinceFound,
  type InstitutionItem,
} from './institution-records';
import { itemSearch, matchesName } from './item-search';
import { compareRank, searchWhereSql, type RankedKey } from './search-order';
import type { NearbyDto } from './nearby.dto';

type Point = { storage: string; lat: number; lng: number };
type Key = RankedKey & { storage: string };
type Snapshot = {
  keys: Key[];
  points: Map<string, Point>;
  school: Map<string, InstitutionItem>;
  notices: string[];
};
type Position = RankedKey & { at: number; scope: string };
const schoolStorage = '한성대학교 상상관 글로벌원스톱센터';

/** 검색은 저장된 보관품만 읽습니다. 수집·주소 확인은 기존 백그라운드 작업이 담당합니다. */
export class SavedNearby {
  private readonly pending = new Map<
    string,
    { until: number; value: Promise<Snapshot> }
  >();
  constructor(
    private readonly db: DatabaseService,
    private readonly school: () => Promise<InstitutionItem[]>,
    private readonly item: (row: VerifiedPortalItem) => InstitutionItem,
  ) {}
  private scope(q: NearbyDto) {
    return digest(
      JSON.stringify([
        2,
        q.lat,
        q.lng,
        q.radiusM,
        q.category,
        q.registeredDays,
        q.q ?? '',
      ]),
    );
  }
  private position(q: NearbyDto): Position | undefined {
    if (!q.cursor || q.cursor === 'verified') return;
    try {
      const [body, signature, extra] = q.cursor.split('.');
      if (extra || !signature || !equal(sign(body), signature)) throw Error();
      const p = JSON.parse(
        Buffer.from(body, 'base64url').toString(),
      ) as Position;
      if (
        p.scope !== this.scope(q) ||
        !Number.isInteger(p.score) ||
        p.score > 0 ||
        p.score < -q.radiusM ||
        !Number.isFinite(p.at) ||
        p.at > Date.now() ||
        Date.now() - p.at > 3600000 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.day) ||
        !/^(hansung:\d+|lost112:[a-zA-Z0-9]+:\d+)$/.test(p.id)
      )
        throw Error();
      return p;
    } catch {
      return fail(
        400,
        'VALIDATION_ERROR',
        '주변 검색 조건이 바뀌었어요. 다시 검색해 주세요.',
      );
    }
  }
  private snapshot(q: NearbyDto, at = Date.now()) {
    const key = this.scope(q) + ':' + koreaDay(at);
    const previous = this.pending.get(key);
    if (previous && previous.until > Date.now()) return previous.value;
    for (const [k, value] of this.pending)
      if (value.until <= Date.now()) this.pending.delete(k);
    if (this.pending.size >= 16)
      this.pending.delete(this.pending.keys().next().value!);
    const value = this.read(q, at);
    const entry = { until: Date.now() + 30000, value };
    this.pending.set(key, entry);
    void value.catch(() => {
      if (this.pending.get(key) === entry) this.pending.delete(key);
    });
    return value;
  }
  private async read(q: NearbyDto, at: number): Promise<Snapshot> {
    const locations = await this.db.$queryRaw<Point[]>`
      SELECT storage,lat,lng FROM institution_place_points WHERE lat IS NOT NULL AND lng IS NOT NULL`;
    // 학교 보관처는 앱에서 사용 중인 공개 캠퍼스 좌표를 기본값으로 씁니다.
    if (!locations.some((p) => p.storage === schoolStorage))
      locations.push({ storage: schoolStorage, lat: 37.5824, lng: 127.0102 });
    const sites = locations.filter((p) => distance(q, p) <= q.radiusM);
    const points = new Map(sites.map((p) => [p.storage, p]));
    const from = sinceFound(q.registeredDays, at),
      through = koreaDay(at);
    const search = itemSearch(q.q ?? '');
    const [rows, campus] = await Promise.all([
      sites.length
        ? this.db.$queryRaw<
            { id: string; day: string; storage: string }[]
          >(Prisma.sql`
        SELECT id,day,storage FROM verified_portal_items
        WHERE stored AND storage IN (${Prisma.join(sites.map((p) => p.storage))})
          AND day BETWEEN ${from} AND ${through}
          AND ${q.category === 'ALL' ? Prisma.sql`TRUE` : Prisma.sql`category=${q.category}`}
          AND ${searchWhereSql(search, true, false)}`)
        : Promise.resolve([]),
      points.has(schoolStorage)
        ? this.school().catch(() => null)
        : Promise.resolve([]),
    ]);
    const school = new Map(
      (campus ?? [])
        .filter(
          (i) =>
            i.date >= from &&
            i.date <= through &&
            (q.category === 'ALL' || i.category === q.category) &&
            matchesName(search, i.name),
        )
        .map((i) => [i.id, i]),
    );
    const keys = [
      ...rows,
      ...[...school.values()].map((i) => ({
        id: i.id,
        day: i.date,
        storage: schoolStorage,
      })),
    ]
      .map((i) => ({
        ...i,
        score: -Math.round(distance(q, points.get(i.storage)!)),
      }))
      .sort(compareRank);
    return {
      keys,
      points,
      school,
      notices:
        campus === null ? ['한성대 저장 목록을 잠시 불러오지 못했어요.'] : [],
    };
  }
  async total(q: NearbyDto) {
    const s = await this.snapshot(q);
    return {
      status: s.notices.length ? ('partial' as const) : ('complete' as const),
      total: s.keys.length,
      incomplete: s.notices.length ? ['한성대' as const] : [],
    };
  }
  async page(q: NearbyDto) {
    const after = this.position(q),
      at = after?.at ?? Date.now();
    const s = await this.snapshot(q, at);
    const keys = s.keys
      .filter((k) => !after || compareRank(k, after) > 0)
      .slice(0, 26);
    const page = keys.slice(0, 25);
    const rows = await this.db.verifiedPortalItem.findMany({
      where: {
        stored: true,
        id: { in: page.filter((k) => !s.school.has(k.id)).map((k) => k.id) },
      },
      omit: { searchFragments: true },
    });
    const byId = new Map(
      rows.map((row) => [row.id, this.item(row as VerifiedPortalItem)]),
    );
    const items = page.flatMap((key) => {
      const item = s.school.get(key.id) ?? byId.get(key.id),
        point = s.points.get(key.storage)!;
      return item
        ? [
            {
              ...item,
              distanceM: -key.score,
              foundLocation: {
                lat: point.lat,
                lng: point.lng,
                label: '보관처 · ' + item.storage,
              },
            },
          ]
        : [];
    });
    const last = page.at(-1);
    let nextCursor: string | null = null;
    if (keys.length > 25 && last) {
      const body = Buffer.from(
        JSON.stringify({
          id: last.id,
          score: last.score,
          day: last.day,
          at,
          scope: this.scope(q),
        }),
      ).toString('base64url');
      nextCursor = body + '.' + sign(body);
    }
    return {
      items,
      notices: s.notices,
      nextCursor,
      refreshing: false,
      total: s.keys.length,
    };
  }
}
