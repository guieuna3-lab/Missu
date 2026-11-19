import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { SessionRequest } from '../auth/session.service';
import { RateLimitService } from '../common/rate-limit.service';
import { NotificationsService } from './notifications.service';

class EnabledDto {
  @IsBoolean() enabled!: boolean;
}
class DeviceDto {
  @IsString() @Matches(/^[a-zA-Z0-9_:-]{30,4096}$/) token!: string;
  @IsUUID() binding!: string;
}
class ListDto {
  @IsOptional() @IsString() @MaxLength(120) cursor?: string;
}
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly limits: RateLimitService,
  ) {}
  @Get() async list(@Req() req: SessionRequest, @Query() q: ListDto) {
    return {
      data: await this.notifications.list(req.authSession!.userId!, q.cursor),
    };
  }
  @Post(':id/read') async read(
    @Req() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.notifications.read(req.authSession!.userId!, id),
    };
  }
  @Get('reports/:id') async settings(
    @Req() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      data: await this.notifications.settings(req.authSession!.userId!, id),
    };
  }
  @Put('reports/:id') async setEnabled(
    @Req() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnabledDto,
  ) {
    const userId = req.authSession!.userId!;
    await this.limits.consume('match-alert:' + userId, 30, 60000);
    return {
      data: await this.notifications.setEnabled(userId, id, dto.enabled),
    };
  }
  @Post('devices') async register(
    @Req() req: SessionRequest,
    @Body() dto: DeviceDto,
  ) {
    const userId = req.authSession!.userId!;
    await this.limits.consume('push-device:' + userId, 20, 60000);
    return {
      data: await this.notifications.register(userId, dto.token, dto.binding),
    };
  }
  @Delete('devices') async unregister(
    @Req() req: SessionRequest,
    @Body() dto: DeviceDto,
  ) {
    return {
      data: await this.notifications.unregister(
        req.authSession!.userId!,
        dto.token,
        dto.binding,
      ),
    };
  }
}
