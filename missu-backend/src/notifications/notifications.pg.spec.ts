import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from './notifications.service';
import { similarItem } from './match-rule';
import { koreaDay } from '../items/institution-records';
import { digest } from '../common/crypto';

const url = process.env.SEARCH_ORDER_TEST_DATABASE_URL;
(url ? describe : describe.skip)('분실 알림의 동의·소유권·중복·재시도', () => {
  let db: DatabaseService, service: NotificationsService;
  const user = randomUUID(),
    other = randomUUID(),
    report = randomUUID();
  const created: string[] = [];
  const phone = 'fake_token_for_notifications_test_1234567890';
  beforeAll(async () => {
    const u = new URL(url!);
    if (
      u.hostname !== '127.0.0.1' ||
      u.port !== '55439' ||
      u.pathname !== '/sort_test'
    )
      throw Error('isolated DB only');
    process.env.DATABASE_URL = url;
    process.env.PII_KEY = '1'.repeat(64);
    process.env.SIGNING_KEY = '2'.repeat(64);
    db = new DatabaseService();
    await db.$connect();
    service = new NotificationsService(db);
    for (const id of [user, other])
      await db.user.create({
        data: {
          id,
          email: id + '@example.test',
          nickname: '알림검사',
          passwordHash: 'test-only',
          emailVerifiedAt: new Date(),
        },
      });
    await db.lostReport.create({
      data: {
        id: report,
        userId: user,
        name: '검정 핸드폰',
        category: 'ELECTRONICS',
        lostStart: new Date(Date.now() - 86400000),
        lostEnd: new Date(),
        timePrecision: 'APPROX',
        lostLabel: '강남역',
        placeName: '강남역',
        lat: 37.4979,
        lng: 127.0276,
      },
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await db.lostReport.deleteMany({
      where: { userId: { in: [user, other] } },
    });
    await db.foundItem.deleteMany({
      where: { keeperId: { in: [user, other] } },
    });
    for (const id of created)
      await db.$executeRaw`DELETE FROM match_item_events WHERE item_id=${id}`;
    await db.user.deleteMany({ where: { id: { in: [user, other] } } });
    await db.$disconnect();
  });
  async function item(name: string, overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    created.push(id);
    await db.foundItem.create({
      data: {
        id,
        keeperId: other,
        name,
        category: 'ELECTRONICS',
        foundAt: new Date(),
        foundLabel: '강남역',
        storagePlace: '다른센터',
        lat: 37.4979,
        lng: 127.0276,
        ...overrides,
      },
    });
    return id;
  }
  it('다른 회원은 신고 설정과 알림을 변경할 수 없다', async () => {
    await expect(service.setEnabled(other, report, true)).rejects.toThrow();
    expect((await service.list(other)).items).toEqual([]);
    await expect(service.read(other, randomUUID())).rejects.toThrow();
  });
  it('동의 전 물품과 자기 물품·멀리 있는 물품·반환품을 제외하고 동의 후 새 동의어 물품을 한 번 알린다', async () => {
    await item('아이폰');
    await service.setEnabled(user, report, true);
    jest.spyOn(service.sender, 'configured').mockReturnValue(true);
    await service.register(user, phone, randomUUID());
    const match = await item('아이폰');
    await item('아이폰 케이스');
    await item('아이폰', { keeperId: user });
    await item('아이폰', {
      foundLabel: '부산역',
      storagePlace: '부산센터',
      lat: 35.1,
      lng: 129.0,
    });
    const returned = await item('갤럭시폰');
    await db.foundItem.update({
      where: { id: returned },
      data: { status: 'RETURNED' },
    });
    await service.collect();
    await service.collect();
    const page = await service.list(user);
    expect(page.items.map((n) => n.itemId)).toEqual([match]);
    const send = jest.spyOn(service.sender, 'send').mockResolvedValue('retry');
    await service.deliver();
    expect(send).toHaveBeenCalledTimes(1);
    await service.deliver();
    expect(send).toHaveBeenCalledTimes(1);
    await service.setEnabled(user, report, false);
    const remaining = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM push_deliveries WHERE token_hash=${digest(phone)}`;
    expect(Number(remaining[0].count)).toBe(0);
  });
  it('같은 기기를 다른 계정에 연결하면 이전 계정의 발송 예약이 사라진다', async () => {
    await service.setEnabled(user, report, true);
    await item('갤럭시폰');
    await service.collect();
    const binding = randomUUID();
    await service.register(other, phone, binding);
    const remaining = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM push_deliveries WHERE token_hash=${digest(phone)}`;
    expect(Number(remaining[0].count)).toBe(0);
    await service.unregister(user, phone, binding);
    await service.unregister(other, phone, randomUUID());
    const device = await db.$queryRaw<
      { user_id: string }[]
    >`SELECT user_id FROM push_devices WHERE token_hash=${digest(phone)}`;
    expect(device[0].user_id).toBe(other);
    await service.unregister(other, phone, binding);
  });
  it('같은 시각에 저장된 60개 알림도 다음 페이지에서 누락·중복하지 않는다', async () => {
    for (let i = 0; i < 60; i++)
      await db.$executeRaw`INSERT INTO match_notifications(id,user_id,report_id,item_id,item_name,created_at) VALUES(${randomUUID()}::uuid,${user}::uuid,${report}::uuid,${'NOTICEQA' + i},'시험물품','2026-11-01T00:00:00.000Z'::timestamptz)`;
    const first = await service.list(user);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.list(user, first.nextCursor!);
    expect(
      new Set([...first.items, ...second.items].map((n) => n.id)).size,
    ).toBe(62);
    await expect(service.list(user, 'bad')).rejects.toThrow();
    await service.read(user, first.items[0].id);
    expect((await service.list(user)).items[0].readAt).not.toBeNull();
  });
});

// 외부기관 갱신도 같은 알림 대기열을 사용하며, 같은 보관 상태 재확인은 새 이벤트가 아닙니다.
(url ? describe : describe.skip)('기관 수집 알림 트리거', () => {
  it('기관 최초 보관 확인과 학교 신규 게시글만 대기열에 저장한다', async () => {
    const u = new URL(url!);
    if (
      u.hostname !== '127.0.0.1' ||
      u.port !== '55439' ||
      u.pathname !== '/sort_test'
    )
      throw Error('isolated DB only');
    process.env.DATABASE_URL = url;
    const db = new DatabaseService();
    await db.$connect();
    const user = randomUUID(),
      report = randomUUID(),
      item = 'ALERTQA' + randomUUID(),
      school = 'SCHOOLQA' + randomUUID();
    try {
      await expect(
        db.$transaction(async (tx) => {
          await tx.user.create({
            data: {
              id: user,
              email: user + '@example.test',
              nickname: '알림검사',
              passwordHash: 'test-only',
              emailVerifiedAt: new Date(),
            },
          });
          await tx.lostReport.create({
            data: {
              id: report,
              userId: user,
              name: '지갑',
              category: 'WALLET',
              lostStart: new Date(),
              lostEnd: new Date(),
              timePrecision: 'APPROX',
              lostLabel: '한성대학교',
              lat: 37.5824,
              lng: 127.0102,
            },
          });
          await tx.$executeRaw`INSERT INTO match_alert_preferences(report_id) VALUES(${report}::uuid)`;
          await tx.$executeRaw`INSERT INTO verified_portal_items(id,name,source,storage,place_key,day,category,stored,checked_at) VALUES(${item},'지갑','포털기관','한성대학교','한성대학교',${koreaDay()},'WALLET',false,now())`;
          expect(
            await tx.$queryRaw`SELECT item_id FROM match_item_events WHERE item_id=${item}`,
          ).toEqual([]);
          await tx.$executeRaw`UPDATE verified_portal_items SET stored=true WHERE id=${item}`;
          expect(
            await tx.$queryRaw`SELECT item_id FROM match_item_events WHERE item_id=${item}`,
          ).toHaveLength(1);
          await tx.$executeRaw`DELETE FROM match_item_events WHERE item_id=${item}`;
          await tx.$executeRaw`UPDATE verified_portal_items SET stored=true,checked_at=now() WHERE id=${item}`;
          expect(
            await tx.$queryRaw`SELECT item_id FROM match_item_events WHERE item_id=${item}`,
          ).toEqual([]);
          const json = JSON.stringify([
            {
              id: school,
              name: '지갑',
              category: 'WALLET',
              date: koreaDay(),
              storage: '한성대학교',
            },
          ]);
          await tx.$executeRaw`INSERT INTO institution_school_snapshot(id,items,checked_at) VALUES(1,${json}::jsonb,now()) ON CONFLICT(id) DO UPDATE SET items=institution_school_snapshot.items || EXCLUDED.items,checked_at=now()`;
          expect(
            await tx.$queryRaw`SELECT item_id FROM match_item_events WHERE item_id=${school}`,
          ).toHaveLength(1);
          await tx.$executeRaw`DELETE FROM match_item_events WHERE item_id=${school}`;
          await tx.$executeRaw`UPDATE institution_school_snapshot SET items=items,checked_at=now() WHERE id=1`;
          expect(
            await tx.$queryRaw`SELECT item_id FROM match_item_events WHERE item_id=${school}`,
          ).toEqual([]);
          throw Error('ROLLBACK_TRIGGER_TEST');
        }),
      ).rejects.toThrow('ROLLBACK_TRIGGER_TEST');
    } finally {
      await db.$disconnect();
    }
  });
});

describe('알림 후보 기준', () => {
  const report = {
    name: '검정반지갑',
    category: 'WALLET',
    lostStart: new Date('2026-11-01T00:00:00+09:00'),
    userId: 'me',
    lat: 37.5824,
    lng: 127.0102,
    place: '한성대학교 상상관',
  };
  it('붙여 쓴 색상·물품명도 찾고, 먼 곳의 같은 색 물품만으로는 알리지 않는다', () => {
    expect(
      similarItem(report, {
        id: '1',
        name: '지갑',
        category: 'WALLET',
        day: koreaDay(),
        lat: 37.5824,
        lng: 127.0102,
      }),
    ).toBe(true);
    expect(
      similarItem(report, {
        id: '2',
        name: '지갑',
        category: 'WALLET',
        day: koreaDay(),
        place: '부산역',
      }),
    ).toBe(false);
    expect(
      similarItem(
        { ...report, name: '아이폰' },
        {
          id: '3',
          name: '아이폰 케이스',
          category: 'ELECTRONICS',
          day: koreaDay(),
          place: '한성대학교',
        },
      ),
    ).toBe(false);
    expect(
      similarItem(
        { ...report, name: '검정 아이폰 케이스' },
        {
          id: '4',
          name: '아이폰 케이스',
          category: 'ELECTRONICS',
          day: koreaDay(),
          place: '한성대학교',
        },
      ),
    ).toBe(true);
    expect(
      similarItem(
        { ...report, name: '아이폰 케이스' },
        {
          id: '5',
          name: '아이폰',
          category: 'ELECTRONICS',
          day: koreaDay(),
          place: '한성대학교',
        },
      ),
    ).toBe(false);
  });
});
