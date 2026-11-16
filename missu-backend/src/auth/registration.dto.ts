import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Trim, Type } from '../common/dto';
import { IsNewPassword } from '../common/password';

export class ConsentDto {
  @IsIn(['TERMS', 'PRIVACY', 'PHONE']) kind: 'TERMS' | 'PRIVACY' | 'PHONE';
  @Trim() @IsString() @Length(1, 80) policyVersion: string;
  @Equals(true) agreed: boolean;
}
export class ChallengeDto {
  @IsIn(['SIGNUP', 'RESET', 'PHONE']) purpose: 'SIGNUP' | 'RESET' | 'PHONE';
  @Trim() @IsString() @Length(1, 254) target: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentDto)
  consent?: ConsentDto;
}
export class VerifyDto {
  @IsString() @Matches(/^\d{6}$/) code: string;
}
export class ProofDto {
  @IsUUID() challengeId: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) proof: string;
}
export class SignupDto extends ProofDto {
  @Trim() @IsEmail() @Length(3, 254) email: string;
  @Trim() @IsString() @Length(2, 10) nickname: string;
  @IsNewPassword() password: string;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ConsentDto)
  consents: ConsentDto[];
}
export class ResetPasswordDto extends ProofDto {
  @IsNewPassword() newPassword: string;
}
