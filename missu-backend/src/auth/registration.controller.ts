import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Public } from './auth.guard';
import type { SessionRequest } from './session.service';
import {
  ChallengeDto,
  ResetPasswordDto,
  SignupDto,
  VerifyDto,
} from './registration.dto';
import { RegistrationService } from './registration.service';

@Public()
@Controller('api/v1/auth')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}
  @Post('challenges')
  @HttpCode(202)
  async challenge(@Body() dto: ChallengeDto, @Req() req: SessionRequest) {
    return { data: await this.registration.send(dto, req) };
  }
  @Post('challenges/:id/verify')
  @HttpCode(200)
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyDto,
    @Req() req: SessionRequest,
  ) {
    return { data: await this.registration.verify(id, dto.code, req) };
  }
  @Post('signup')
  async signup(@Body() dto: SignupDto, @Req() req: SessionRequest) {
    return { data: await this.registration.signup(dto, req.authSession!.id) };
  }
  @Post('password-reset')
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto, @Req() req: SessionRequest) {
    await this.registration.reset(dto, req.authSession!.id);
  }
}
