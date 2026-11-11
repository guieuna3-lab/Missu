import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Trim, Type } from '../common/dto';
export class ProfileDto {
  @Trim() @IsString() @Length(2, 10) nickname: string;
}
export class HistoryDto {
  @IsIn(['MY_ITEMS', 'LOST_REPORTS', 'MY_CLAIMS', 'RECEIVED_CLAIMS']) type:
    'MY_ITEMS' | 'LOST_REPORTS' | 'MY_CLAIMS' | 'RECEIVED_CLAIMS';
  @IsOptional() @IsString() @Length(1, 1000) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}

export class ChangePasswordDto {
  @IsString() @Length(12, 128) currentPassword: string;
  @IsString() @Length(12, 128) newPassword: string;
}
