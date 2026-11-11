/**
 * 습득물 등록·검색·분실 신고에서 허용하는 입력만 정의합니다.
 * 등록자 ID는 입력받지 않고 로그인 세션에서 결정하므로 다른 사람을 사칭해 등록할 수 없습니다.
 */
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsEnum,
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
import { Category } from '../generated/prisma/enums';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LocationDto, LostTimeDto, Trim, Type } from '../common/dto';

export class CreateItemDto {
  @Trim() @IsString() @Length(1, 20) name: string;
  @IsOptional() @IsEnum(Category) category?: Category;
  @IsOptional() @Trim() @IsString() @Length(0, 100) publicFeatures?: string;
  @IsDateString({ strict: true }) foundAt: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  foundLocation: LocationDto;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds: string[];
  @Trim() @IsString() @Length(1, 200) storagePlace: string;
  @IsOptional() @Trim() @IsString() @Length(0, 100) pickupGuide?: string;
  @IsOptional() @Trim() @IsString() @Length(0, 300) privateFeatures?: string;
}
export class SearchItemsDto {
  @ApiPropertyOptional({
    description:
      '공백으로 구분한 모든 단어가 물품명 또는 공개 특징에 포함되어야 합니다.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(0, 80)
  q?: string;
  @IsOptional() @Trim() @IsString() @Length(0, 200) place?: string;
  @IsOptional() @IsDateString({ strict: true }) foundFrom?: string;
  @IsOptional() @IsDateString({ strict: true }) foundTo?: string;
  @IsOptional() @IsString() @Length(1, 1000) cursor?: string;
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 50,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
export class CreateLostReportDto {
  @Trim() @IsString() @Length(1, 20) name: string;
  @IsOptional() @Trim() @IsString() @Length(0, 100) features?: string;
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
