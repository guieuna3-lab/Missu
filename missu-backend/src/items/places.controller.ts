import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import type { SessionRequest } from '../auth/session.service';
import { config } from '../config';
import { fail } from '../common/http';
import { ExternalHttpService } from '../integrations/external-http.service';
import { RateLimitService } from '../common/rate-limit.service';
import { PlacesDto, ReversePlaceDto } from './nearby.dto';

type SearchType = 'keyword' | 'address';
type KakaoDocument = {
  id?: string;
  place_name?: string;
  address_name: string;
  road_address_name?: string;
  road_address?: { address_name: string; building_name?: string } | null;
  x: string;
  y: string;
};

function placeResult(doc: KakaoDocument, type: SearchType) {
  const lat = Number(doc.y),
    lng = Number(doc.x);
  if (
    typeof doc.y !== 'string' ||
    !doc.y.trim() ||
    typeof doc.x !== 'string' ||
    !doc.x.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    throw new Error('Invalid provider coordinates');
  if (type === 'keyword') {
    if (!doc.id || !doc.place_name) throw new Error('Invalid provider place');
    return {
      providerPlaceId: doc.id,
      name: doc.place_name,
      address: doc.road_address_name || doc.address_name || doc.place_name,
      lat,
      lng,
    };
  }
  if (!doc.address_name) throw new Error('Invalid provider address');
  const road = doc.road_address;
  return {
    providerPlaceId: 'address:' + doc.address_name,
    name: road?.building_name || doc.address_name,
    address: road?.address_name || doc.address_name,
    lat,
    lng,
  };
}

@Public()
@Controller('api/v1/places')
export class PlacesController {
  constructor(
    private readonly http: ExternalHttpService,
    private readonly rates: RateLimitService,
  ) {}

  @Get()
  async search(@Query() query: PlacesDto, @Req() req: SessionRequest) {
    if ((query.lat === undefined) !== (query.lng === undefined))
      fail(400, 'VALIDATION_ERROR', '위도와 경도를 함께 입력하세요.');
    const settings = config();
    if (settings.placeProvider !== 'kakao' || !settings.kakaoKey)
      fail(503, 'PLACES_NOT_CONFIGURED', '장소 검색 서비스 설정이 필요합니다.');
    await this.rates.consume('places:' + req.ip, 60, 60000);

    // 건물 번호나 번지가 있는 검색은 주소 좌표를 우선합니다. 결과가 없으면 다른 방식으로 한 번 더 찾습니다.
    const addressLike =
      /(?:로|길|동|리|가|읍|면)\s*(?:산\s*)?\d+(?:-\d+)?(?:\s|$)/u.test(
        query.q,
      );
    const first = addressLike ? 'address' : 'keyword';
    const data = await this.lookup(first, query, settings.kakaoKey);
    if (data.length) return { data };
    return {
      data: await this.lookup(
        addressLike ? 'keyword' : 'address',
        query,
        settings.kakaoKey,
      ),
    };
  }

  @Post('reverse')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async reverse(@Body() point: ReversePlaceDto, @Req() req: SessionRequest) {
    await this.rates.consume('places:' + req.ip, 60, 60000);
    const settings = config();
    if (settings.placeProvider !== 'kakao' || !settings.kakaoKey)
      fail(503, 'PLACES_NOT_CONFIGURED', '장소 검색 서비스 설정이 필요합니다.');
    // 미슈 요청 URL에는 기기 좌표를 남기지 않습니다. 카카오는 WGS84 경도(x), 위도(y) 순서입니다.
    const url = new URL(
      'https://dapi.kakao.com/v2/local/geo/coord2address.json',
    );
    url.searchParams.set('x', String(point.lng));
    url.searchParams.set('y', String(point.lat));
    url.searchParams.set('input_coord', 'WGS84');
    const response = await this.http.request(url.toString(), {
      headers: { Authorization: 'KakaoAK ' + settings.kakaoKey },
    });
    const body = (await response.json().catch(() => null)) as {
      documents?: {
        road_address?: { address_name?: string } | null;
        address?: { address_name?: string } | null;
      }[];
    } | null;
    if (!Array.isArray(body?.documents))
      fail(503, 'EXTERNAL_UNAVAILABLE', '주소를 확인하지 못했습니다.');
    const first = body.documents[0];
    const address =
      first?.road_address?.address_name?.trim() ||
      first?.address?.address_name?.trim() ||
      null;
    return { data: { address } };
  }

  private async lookup(type: SearchType, query: PlacesDto, key: string) {
    const url = new URL(
      'https://dapi.kakao.com/v2/local/search/' + type + '.json',
    );
    url.searchParams.set('query', query.q);
    url.searchParams.set('size', '15');
    if (
      type === 'keyword' &&
      query.lat !== undefined &&
      query.lng !== undefined
    ) {
      url.searchParams.set('y', String(query.lat));
      url.searchParams.set('x', String(query.lng));
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.http.request(url.toString(), {
          headers: { Authorization: 'KakaoAK ' + key },
        });
        const body = (await res.json()) as { documents?: KakaoDocument[] };
        if (!Array.isArray(body.documents))
          throw new Error('Invalid provider response');
        return body.documents.map((doc) => placeResult(doc, type));
      } catch {
        if (attempt === 1)
          fail(503, 'EXTERNAL_UNAVAILABLE', '장소 검색을 사용할 수 없습니다.');
      }
    }
  }
}
