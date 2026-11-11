/**
 * HTTP 주소와 서비스 함수를 연결합니다.
 * GET은 조회, POST는 등록이며, 로그인 검사와 입력 검증이 끝난 요청만 서비스로 전달됩니다.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import type { SessionRequest } from '../auth/session.service';
import { CreateItemDto, SearchItemsDto } from './items.dto';
import { ItemsService } from './items.service';
import { ApiHeader } from '@nestjs/swagger';
import { NearbyService } from './nearby.service';
import { NearbyDto } from './nearby.dto';

@Controller('api/v1/items')
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly nearby: NearbyService,
  ) {}
  @Public()
  @Get()
  search(@Query() query: SearchItemsDto) {
    return this.items.search(query);
  }
  @Public()
  @Get('nearby')
  nearbySearch(@Query() query: NearbyDto) {
    return this.nearby.search(query);
  }
  @Public()
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.items.detail(id) };
  }
  @Get(':id/manage')
  async manage(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
  ) {
    return { data: await this.items.manage(id, req.authSession!.userId!) };
  }
  @Put(':id')
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: SessionRequest,
    @Body() dto: CreateItemDto,
  ) {
    return {
      data: await this.items.edit(
        id,
        req.authSession!.userId!,
        dto,
        String(req.headers['x-request-id']),
      ),
    };
  }
  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: '재시도할 때 동일한 UUID를 재사용합니다.',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  async create(
    @Body() dto: CreateItemDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: SessionRequest,
  ) {
    return {
      data: await this.items.create(
        dto,
        req.authSession!.userId!,
        key,
        String(req.headers['x-request-id']),
      ),
    };
  }
}
