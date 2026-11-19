import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Public } from '../auth/auth.guard';
import type { SessionRequest } from '../auth/session.service';
import { Trim } from '../common/dto';
import { RateLimitService } from '../common/rate-limit.service';
import { SearchResultsService } from './search-results.service';

export class SearchResultsDto {
  @Trim() @IsString() @Length(1, 80) q: string;
  @IsOptional() @Trim() @IsString() @Length(0, 80) place = '';
  @IsOptional() @IsIn(['all', '7', '30']) period = 'all';
  @IsOptional() @IsIn(['recent', 'relevance']) sort: 'recent' | 'relevance' =
    'recent';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsString() @Length(1, 1000) cursor?: string;
}

@Public()
@Controller('api/v1/search-items')
export class SearchResultsController {
  constructor(
    private readonly service: SearchResultsService,
    private readonly rates: RateLimitService,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  async search(@Query() query: SearchResultsDto, @Req() req: SessionRequest) {
    await this.rates.consume('search-items:' + req.ip, 60, 60000);
    return { data: await this.service.search(query) };
  }
}
