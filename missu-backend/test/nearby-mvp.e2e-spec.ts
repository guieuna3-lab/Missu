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
