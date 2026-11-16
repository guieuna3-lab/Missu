import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from './auth.guard';
import type { SessionRequest } from './session.service';
import {
  ChallengeDto,
  NicknameCheckDto,
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
  // 가입·닉네임 수정 화면의 중복확인 버튼용. 실제 저장 시에도 서버가 다시 검사한다.
  @Get('nickname-check')
  async nicknameCheck(
    @Query() dto: NicknameCheckDto,
    @Req() req: SessionRequest,
  ) {
    return {
      data: await this.registration.nicknameAvailable(dto.nickname, req),
    };
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
