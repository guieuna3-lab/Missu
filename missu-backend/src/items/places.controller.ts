import { Controller, Get, Query, Req } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import type { SessionRequest } from '../auth/session.service';
import { config } from '../config';
import { fail } from '../common/http';
import { ExternalHttpService } from '../integrations/external-http.service';
import { RateLimitService } from '../common/rate-limit.service';
import { PlacesDto } from './nearby.dto';

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
    if (config().placeProvider !== 'kakao')
      fail(503, 'PLACES_NOT_CONFIGURED', '장소 검색 서비스 설정이 필요합니다.');
    await this.rates.consume('places:' + req.ip, 60, 60000);
    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.searchParams.set('query', query.q);
    url.searchParams.set('size', '15');
    if (query.lat !== undefined) {
      url.searchParams.set('y', String(query.lat));
      url.searchParams.set('x', String(query.lng));
    }
    // 읽기 요청만 한 번 재시도하며 실패하면 빈 성공 결과로 위장하지 않습니다.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.http.request(url.toString(), {
          headers: { Authorization: 'KakaoAK ' + config().kakaoKey },
        });
        const body = (await response.json()) as {
          documents?: {
            id: string;
            place_name: string;
            address_name: string;
            road_address_name: string;
            x: string;
            y: string;
          }[];
        };
        if (!Array.isArray(body.documents))
          throw new Error('Invalid provider response');
        return {
          data: body.documents.map((place) => {
            const lat = Number(place.y),
              lng = Number(place.x);
            if (
              !Number.isFinite(lat) ||
              !Number.isFinite(lng) ||
              Math.abs(lat) > 90 ||
              Math.abs(lng) > 180
            )
              throw new Error('Invalid provider coordinates');
            return {
              providerPlaceId: place.id,
              name: place.place_name,
              address: place.road_address_name || place.address_name,
              lat,
              lng,
            };
          }),
        };
      } catch {
        if (attempt === 1)
          fail(503, 'EXTERNAL_UNAVAILABLE', '장소 검색을 사용할 수 없습니다.');
      }
    }
  }
}
