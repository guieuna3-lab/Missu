/** 로그인 입력입니다. 비밀번호는 앞뒤 공백도 비밀번호의 일부이므로 trim하지 않습니다. */
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../common/dto';
export class LoginDto {
  @Trim() @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(12) @MaxLength(128) password: string;
}
