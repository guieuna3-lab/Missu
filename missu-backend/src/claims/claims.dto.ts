import {
  Matches,
  ValidateIf,
  IsDefined,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
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
  @ValidateIf(
    (dto: CreateClaimDto) =>
      dto.lostInfo === undefined ||
      dto.lostTime !== undefined ||
      dto.lostLocation !== undefined,
  )
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => LostTimeDto)
  lostTime?: LostTimeDto;
  @ValidateIf(
    (dto: CreateClaimDto) =>
      dto.lostInfo === undefined ||
      dto.lostTime !== undefined ||
      dto.lostLocation !== undefined,
  )
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  lostLocation?: LocationDto;
  @ValidateIf((dto: CreateClaimDto) => dto.lostInfo !== undefined)
  @Trim()
  @IsString()
  @Length(1, 500)
  lostInfo?: string;
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
  @IsOptional() @Trim() @IsString() @Length(0, 1000) description?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds?: string[];
  @Trim() @IsString() @Length(1, 200) reason: string;
}
export class EmptyDto {}

export class AppointmentDto {
  @Trim() @IsString() @Length(1, 200) place: string;
  @Matches(/^\d{4}\.\d{1,2}\.\d{1,2}$/) date: string;
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) time: string;
}
export class ConfirmAppointmentDto {
  @IsUUID() proposalId: string;
}
