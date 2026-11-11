import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionRequest } from '../auth/session.service';
import { fail } from '../common/http';
import { RateLimitService } from '../common/rate-limit.service';
import { RoutesService } from './routes.service';
import {
  AppendRouteDto,
  DeleteRouteDto,
  RouteDayDto,
  StartRouteDto,
  StopRouteDto,
} from './routes.dto';

@ApiTags('본인 이동 경로 · 48시간')
@Controller('api/v1/me/routes')
export class RoutesController {
  constructor(
    private readonly routes: RoutesService,
    private readonly rates: RateLimitService,
  ) {}
  @Get('status') async status(@Req() req: SessionRequest) {
    return { data: await this.routes.status(req.authSession!.userId!) };
  }
  @Post('recordings') async start(
    @Req() req: SessionRequest,
    @Body() dto: StartRouteDto,
  ) {
    await this.rates.consume(
      'route-start:' + req.authSession!.userId,
      30,
      3600000,
    );
    return { data: await this.routes.start(req.authSession!.userId!, dto) };
  }
  @Post('recordings/:id/points')
  @HttpCode(200)
  async append(
    @Req() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AppendRouteDto,
  ) {
    await this.rates.consume(
      'route-points:' + req.authSession!.userId,
      120,
      60000,
    );
    return {
      data: await this.routes.append(req.authSession!.userId!, id, dto),
    };
  }
  @Post('recordings/:id/stop')
  @HttpCode(200)
  async stop(
    @Req() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StopRouteDto,
  ) {
    return { data: await this.routes.stop(req.authSession!.userId!, id) };
  }
  @Get('points/:id/nearby')
  async nearby(
    @Req() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.routes.nearbyAt(req.authSession!.userId!, id);
  }
  @Get() async day(@Req() req: SessionRequest, @Query() dto: RouteDayDto) {
    return { data: await this.routes.day(req.authSession!.userId!, dto.date) };
  }
  @Delete() async remove(
    @Req() req: SessionRequest,
    @Query() dto: DeleteRouteDto,
  ) {
    if (Boolean(dto.date) === Boolean(dto.all))
      fail(400, 'VALIDATION_ERROR', 'date 또는 all=true 중 하나를 지정하세요.');
    return {
      data: await this.routes.remove(req.authSession!.userId!, dto.date),
    };
  }
}
