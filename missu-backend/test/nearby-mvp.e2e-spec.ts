import { randomUUID } from 'node:crypto';
import { harness, type Harness, type Actor } from './mvp-support';
import { ExternalHttpService } from '../src/integrations/external-http.service';

describe('근처 지도·장소 검색 계약', () => {
  let h: Harness, keeper: Actor;
  beforeAll(async () => {
    h = await harness();
    keeper = await h.user('map');
  }, 30000);
  beforeEach(() => h.beginCase());
  afterAll(async () => {
    await h?.close();
  });
  it('반경·종류·기간을 함께 적용하고 실제 거리순으로 정렬한다', async () => {
    const name = '거리' + randomUUID().slice(0, 8);
    const near = await h.item(keeper, {
      name,
      lat: 37.582,
      lng: 127.01,
      category: 'ELECTRONICS',
    });
    await h.item(keeper, {
      name,
      lat: 37.583,
      lng: 127.01,
      category: 'ELECTRONICS',
    });
    await h.item(keeper, {
      name,
      lat: 38,
      lng: 127.01,
      category: 'ELECTRONICS',
    });
    await h.item(keeper, { name, category: 'WALLET_BAG' });
    await h.item(keeper, {
      name,
      category: 'ELECTRONICS',
      createdAt: new Date(Date.now() - 8 * 86400000),
    });
    const response = await keeper.agent
      .get('/api/v1/items/nearby')
      .query({
        lat: 37.582,
        lng: 127.01,
        radiusM: 500,
        q: name,
        category: 'ELECTRONICS',
        registeredDays: '7',
      })
      .expect(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].id).toBe(near.id);
    expect(response.body.data[0].distanceM).toBe(0);
    expect(response.body.data[1].distanceM).toBeGreaterThan(100);
    expect(response.body.data[0].keeperId).toBeUndefined();
    await keeper.agent
      .get('/api/v1/items/nearby')
      .query({ lat: 91, lng: 127 })
      .expect(400);
    await keeper.agent
      .get('/api/v1/items/nearby')
      .query({ lat: 37, lng: 127, radiusM: 999 })
      .expect(400);
    await keeper.agent
      .get('/api/v1/items/nearby')
      .query({ lng: 127 })
      .expect(400);
    await keeper.agent
      .get('/api/v1/items/nearby')
      .query({ lat: '', lng: 127 })
      .expect(400);
  });
  it('최대 100건과 커서·범위 축소 안내를 적용한다', async () => {
    const name = '다수' + randomUUID().slice(0, 8);
    await h.db.foundItem.createMany({
      data: Array.from({ length: 103 }, (_, i) => ({
        keeperId: keeper.id,
        name,
        foundAt: new Date(Date.now() - 1000),
        foundLabel: '시험지역',
        lat: 37.582 + i / 1000000,
        lng: 127.01,
        storagePlace: '시험보관함',
      })),
    });
    const query = { lat: 37.582, lng: 127.01, q: name, limit: 50 };
    const first = await keeper.agent
      .get('/api/v1/items/nearby')
      .query(query)
      .expect(200);
    const second = await keeper.agent
      .get('/api/v1/items/nearby')
      .query({ ...query, cursor: first.body.meta.nextCursor })
      .expect(200);
    expect(first.body.data).toHaveLength(50);
    expect(second.body.data).toHaveLength(50);
    expect(
      new Set(
        [...first.body.data, ...second.body.data].map(
          (x: { id: string }) => x.id,
        ),
      ).size,
    ).toBe(100);
    expect(second.body.meta.nextCursor).toBeNull();
    expect(first.body.meta.truncated).toBe(true);
    expect(first.body.meta.total).toBe(103);
    expect(second.body.meta.total).toBe(103);
    await keeper.agent
      .get('/api/v1/items/nearby')
      .query({ ...query, radiusM: 500, cursor: first.body.meta.nextCursor })
      .expect(400);
  });
  it('날짜 변경선과 극점 부근에서도 반경 검색을 한다', async () => {
    const name = '경계' + randomUUID().slice(0, 8);
    await h.item(keeper, { name, lat: 0, lng: -179.999 });
    const crossed = await keeper.agent
      .get('/api/v1/items/nearby')
      .query({ lat: 0, lng: 179.999, radiusM: 500, q: name })
      .expect(200);
    expect(crossed.body.data).toHaveLength(1);
    await h.item(keeper, { name, lat: 89.999, lng: -90 });
    const pole = await keeper.agent
      .get('/api/v1/items/nearby')
      .query({ lat: 90, lng: 90, radiusM: 500, q: name })
      .expect(200);
    expect(pole.body.data).toHaveLength(1);
  });
  it('미설정 장소 서비스는 명확히 실패하고 카카오 응답은 공개 장소 DTO로 변환한다', async () => {
    await keeper.agent.get('/api/v1/places').query({ q: '한성대' }).expect(503);
    await keeper.agent
      .get('/api/v1/places')
      .query({ q: '한성대', lat: 37 })
      .expect(400);
    const beforeProvider = process.env.PLACE_PROVIDER,
      beforeKey = process.env.KAKAO_REST_API_KEY;
    process.env.PLACE_PROVIDER = 'kakao';
    process.env.KAKAO_REST_API_KEY = 'synthetic-test-key';
    const call = jest
      .spyOn(h.app.get(ExternalHttpService), 'request')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              documents: [
                {
                  id: 'fixture-1',
                  place_name: '시험장소',
                  address_name: '시험주소',
                  road_address_name: '',
                  x: '127.01',
                  y: '37.582',
                },
              ],
            }),
          ),
      );
    try {
      const response = await keeper.agent
        .get('/api/v1/places')
        .query({ q: '한성대', lat: 37.582, lng: 127.01 })
        .expect(200);
      expect(response.body.data[0]).toEqual({
        providerPlaceId: 'fixture-1',
        name: '시험장소',
        address: '시험주소',
        lat: 37.582,
        lng: 127.01,
      });
      expect(call.mock.calls[0][0]).toContain(
        'https://dapi.kakao.com/v2/local/search/keyword.json?',
      );
      // 실제 GPS를 보내지 않고도 공공시설의 도로명·지번 조회 결과로 분실 신고를 저장할 수 있습니다.
      const rawAddress = {
        address_name: '서울 중구 태평로1가 31',
        x: '126.9784',
        y: '37.5666',
        road_address: {
          address_name: '서울 중구 세종대로 110',
          building_name: '서울특별시청',
        },
      };
      const payload = (documents: unknown[]) =>
        new Response(JSON.stringify({ documents }));
      for (const q of ['세종대로 110', '태평로1가 31']) {
        call.mockClear().mockImplementation(async () => payload([rawAddress]));
        const found = await keeper.agent
          .get('/api/v1/places')
          .query({ q })
          .expect(200);
        expect(call).toHaveBeenCalledTimes(1);
        expect(new URL(call.mock.calls[0][0]).pathname).toBe(
          '/v2/local/search/address.json',
        );
        expect(found.body.data).toEqual([
          {
            providerPlaceId: 'address:' + rawAddress.address_name,
            name: '서울특별시청',
            address: '서울 중구 세종대로 110',
            lat: 37.5666,
            lng: 126.9784,
          },
        ]);
        const chosen = found.body.data[0] as {
          name: string;
          address: string;
          lat: number;
          lng: number;
        };
        const filed = await h
          .post(keeper, '/lost-reports')
          .send({
            name: '검색으로 선택한 장소',
            placeName: chosen.name,
            category: 'KEY',
            lostTime: {
              start: '2026-10-01T02:00:00.000Z',
              end: '2026-10-01T02:00:00.000Z',
              precision: 'EXACT',
            },
            lostLocation: {
              label: chosen.address,
              lat: chosen.lat,
              lng: chosen.lng,
            },
          })
          .expect(201);
        const restored = await keeper.agent
          .get('/api/v1/lost-reports/' + filed.body.data.id)
          .expect(200);
        expect(restored.body.data).toMatchObject({
          placeName: chosen.name,
          lostLocation: {
            label: chosen.address,
            lat: chosen.lat,
            lng: chosen.lng,
          },
        });
      }
      call
        .mockClear()
        .mockImplementationOnce(async () => payload([]))
        .mockImplementationOnce(async () =>
          payload([{ ...rawAddress, road_address: null }]),
        );
      const fallback = await keeper.agent
        .get('/api/v1/places')
        .query({ q: '태평로' })
        .expect(200);
      expect(call.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
        '/v2/local/search/keyword.json',
        '/v2/local/search/address.json',
      ]);
      expect(fallback.body.data[0].address).toBe(rawAddress.address_name);
      call.mockImplementation(async () => payload([]));
      const empty = await keeper.agent
        .get('/api/v1/places')
        .query({ q: '일치하지 않는 장소' })
        .expect(200);
      expect(empty.body.data).toEqual([]);
      call.mockImplementation(async () => payload([{ ...rawAddress, x: ' ' }]));
      await keeper.agent
        .get('/api/v1/places')
        .query({ q: '세종대로 110' })
        .expect(503);
      const point = { lat: 37.5666, lng: 126.9784 };
      const reverse = () => h.post(keeper, '/places/reverse').send(point);
      call.mockClear().mockImplementation(async () =>
        payload([
          {
            road_address: rawAddress.road_address,
            address: { address_name: rawAddress.address_name },
          },
        ]),
      );
      const resolved = await reverse().expect(200);
      expect(resolved.headers['cache-control']).toBe('no-store');
      expect(resolved.body.data.address).toBe('서울 중구 세종대로 110');
      const upstream = new URL(call.mock.calls[0][0]);
      expect(upstream.pathname).toBe('/v2/local/geo/coord2address.json');
      expect(upstream.searchParams.get('x')).toBe(String(point.lng));
      expect(upstream.searchParams.get('y')).toBe(String(point.lat));

      const photo = await h.db.itemPhoto.create({
        data: {
          uploaderId: keeper.id,
          objectKey: randomUUID(),
          mime: 'image/jpeg',
          byteSize: 200,
          width: 8,
          height: 8,
        },
      });
      const item = await h
        .post(keeper, '/items')
        .send({
          name: '위치 주소 시험',
          foundAt: new Date(Date.now() - 3600000).toISOString(),
          foundLocation: {
            ...point,
            label: resolved.body.data.address + ' · 1층',
          },
          storagePlace: '안내소',
          photoIds: [photo.id],
        })
        .expect(201);
      const detail = await keeper.agent
        .get('/api/v1/items/' + item.body.data.id)
        .expect(200);
      expect(detail.body.data.foundLocation).toEqual({
        ...point,
        label: '서울 중구 세종대로 110 · 1층',
      });
      call.mockImplementation(async () =>
        payload([
          {
            road_address: null,
            address: { address_name: rawAddress.address_name },
          },
        ]),
      );
      expect((await reverse().expect(200)).body.data.address).toBe(
        rawAddress.address_name,
      );
      call.mockImplementation(async () => payload([]));
      expect((await reverse().expect(200)).body.data.address).toBeNull();
      await h
        .post(keeper, '/places/reverse')
        .send({ lat: 91, lng: 0 })
        .expect(400);
      call.mockImplementation(async () => new Response('{}'));
      await reverse().expect(503);
      call.mockRejectedValue(new Error('simulated provider outage'));
      await keeper.agent
        .get('/api/v1/places')
        .query({ q: '한성대' })
        .expect(503);
    } finally {
      call.mockRestore();
      if (beforeProvider === undefined) delete process.env.PLACE_PROVIDER;
      else process.env.PLACE_PROVIDER = beforeProvider;
      if (beforeKey === undefined) delete process.env.KAKAO_REST_API_KEY;
      else process.env.KAKAO_REST_API_KEY = beforeKey;
    }
  });
});
