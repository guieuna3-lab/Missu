import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Public } from '../auth/auth.guard';
import type { SessionRequest } from '../auth/session.service';
import { Trim } from '../common/dto';
import { RateLimitService } from '../common/rate-limit.service';
import { NearbyDto } from './nearby.dto';
import { InstitutionItemsService } from './institution-items.service';

class InstitutionPageDto {
  @ApiPropertyOptional({
    description: '직전 기관 목록이 반환한 다음 페이지 값',
  })
  @IsOptional()
  @IsString()
  @Length(1, 180)
  cursor?: string;
}
class SearchInstitutionsDto extends InstitutionPageDto {
  @Trim() @IsString() @Length(1, 80) q: string;
  @IsOptional() @Trim() @IsString() @Length(0, 80) place = '';
  @IsOptional() @IsIn(['all', '7', '30']) period = 'all';
}
class InstitutionPreviewDto {
  @IsOptional() @Trim() @IsString() @Length(0, 80) q = '';
  @IsOptional() @Trim() @IsString() @Length(0, 80) place = '';
  @IsOptional() @IsIn(['all', '7', '30']) period = 'all';
}

@Public()
@Controller('api/v1/institution-items')
export class InstitutionItemsController {
  constructor(
    private readonly service: InstitutionItemsService,
    private readonly rates: RateLimitService,
  ) {}
  @Get()
  async search(
    @Query() query: SearchInstitutionsDto,
    @Req() req: SessionRequest,
  ) {
    await this.rates.consume('institution-search:' + req.ip, 30, 60000);
    return {
      data: await this.service.search(
        query.q,
        query.place,
        query.period,
        query.cursor,
      ),
    };
  }
  @Get('inventory-total')
  @Header('Cache-Control', 'no-store')
  async inventoryTotal(@Req() req: SessionRequest) {
    await this.rates.consume('institution-inventory:' + req.ip, 30, 60000);
    return { data: await this.service.inventoryTotal() };
  }
  @Get('sync-status')
  @Header('Cache-Control', 'no-store')
  async syncStatus(@Req() req: SessionRequest) {
    await this.rates.consume('institution-sync-status:' + req.ip, 30, 60000);
    return { data: await this.service.syncStatus() };
  }
  @Get('nearby')
  @Header('Cache-Control', 'no-store')
  async nearby(@Query() query: NearbyDto, @Req() req: SessionRequest) {
    await this.rates.consume('institution-nearby:' + req.ip, 20, 60000);
    return { data: await this.service.nearby(query) };
  }
  @Get('nearby-total')
  @Header('Cache-Control', 'no-store')
  async nearbyTotal(@Query() query: NearbyDto, @Req() req: SessionRequest) {
    await this.rates.consume('nearby-total:' + req.ip, 60, 60000);
    return { data: this.service.nearbyTotal(query) };
  }
  @Get('detail/:id')
  async detail(@Param('id') id: string, @Req() req: SessionRequest) {
    await this.rates.consume('institution-detail:' + req.ip, 60, 60000);
    return { data: await this.service.detail(id) };
  }
  @Get('preview')
  async preview(
    @Query() query: InstitutionPreviewDto,
    @Req() req: SessionRequest,
  ) {
    await this.rates.consume('institution-preview:' + req.ip, 30, 60000);
    return {
      data: await this.service.preview(query.q, query.place, query.period),
    };
  }
  @Get('registrations')
  async registrations(
    @Query() query: SearchInstitutionsDto,
    @Req() req: SessionRequest,
  ) {
    await this.rates.consume('institution-registrations:' + req.ip, 30, 60000);
    // 명칭·보관처 조회는 기간 제한을 지원하지 않아 기간 검색에는 무관한 수를 보내지 않습니다.
    return {
      data: {
        total:
          query.period === 'all'
            ? await this.service.portalRegistrations(query.q, query.place)
            : null,
      },
    };
  }
  @Get('search-total')
  @Header('Cache-Control', 'no-store')
  async searchTotal(
    @Query() query: SearchInstitutionsDto,
    @Req() req: SessionRequest,
  ) {
    await this.rates.consume('institution-total:' + req.ip, 30, 60000);
    return {
      data: await this.service.searchTotal(query.q, query.place, query.period),
    };
  }
  @Get('recent')
  async recent(@Req() req: SessionRequest, @Query() query: InstitutionPageDto) {
    await this.rates.consume('institution-search:' + req.ip, 30, 60000);
    return { data: await this.service.recent(query.cursor) };
  }
}
