import {
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocationDto, LostTimeDto, Trim, Type } from '../common/dto';
export class CreateClaimDto {
  @Trim() @IsString() @Length(1, 300) features: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => LostTimeDto)
  lostTime: LostTimeDto;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  lostLocation: LocationDto;
}
export class DecisionDto {
  @IsIn(['APPROVE', 'REJECT']) decision: 'APPROVE' | 'REJECT';
  @IsOptional() @Trim() @IsString() @Length(1, 300) reason?: string;
}
export class MessageDto {
  @Trim() @IsString() @Length(1, 200) body: string;
  @IsUUID() clientMessageId: string;
}
export class MessagesQueryDto {
  @IsOptional() @IsString() @Length(1, 1000) after?: string;
  @IsOptional() @IsString() @Length(1, 1000) before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 50;
}
export class ReportDto {
  @Trim() @IsString() @Length(1, 200) reason: string;
}
export class EmptyDto {}
