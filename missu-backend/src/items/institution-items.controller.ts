import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Public } from '../auth/auth.guard';
import type { SessionRequest } from '../auth/session.service';
import { Trim } from '../common/dto';
import { RateLimitService } from '../common/rate-limit.service';
import { NearbyDto } from './nearby.dto';
import { InstitutionItemsService } from './institution-items.service';

class SearchInstitutionsDto {
  @Trim() @IsString() @Length(1, 80) q: string;
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
      data: await this.service.search(query.q, query.place, query.period),
    };
  }
  @Get('nearby')
  @Header('Cache-Control', 'no-store')
  async nearby(@Query() query: NearbyDto, @Req() req: SessionRequest) {
    await this.rates.consume('institution-nearby:' + req.ip, 20, 60000);
    return { data: await this.service.nearby(query) };
  }
  @Get('recent')
  async recent(@Req() req: SessionRequest) {
    await this.rates.consume('institution-search:' + req.ip, 30, 60000);
    return { data: await this.service.recent() };
  }
}
