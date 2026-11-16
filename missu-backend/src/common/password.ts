import { applyDecorators } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';

// 새 비밀번호 규칙: 12~128자, 영문·숫자·특수문자를 각각 1개 이상 포함한다.
// 허용 문자는 키보드의 영문·숫자·특수문자(ASCII 0x21~0x7E)뿐이며 한글·공백·이모지는 받지 않는다.
// 프론트의 MissU_Frontend/src/features/auth/password.ts와 같은 규칙을 유지한다.
// 로그인과 현재 비밀번호 확인에는 적용하지 않는다. 규칙 이전에 가입한 계정도 로그인할 수 있어야 하기 때문이다.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_PATTERN =
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!-/:-@[-`{-~])[!-~]{12,128}$/;
export const PASSWORD_RULE_MESSAGE =
  '비밀번호는 12~128자의 영문·숫자·특수문자를 각각 1개 이상 포함해야 합니다.';

export const IsNewPassword = () =>
  applyDecorators(
    IsString(),
    Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH),
    Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE }),
  );
