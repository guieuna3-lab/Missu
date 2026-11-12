import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Trim, Type } from '../common/dto';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
const Coordinate = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? NaN : Number(value),
  );
export class NearbyDto {
  @Coordinate() @IsNumber() @Min(-90) @Max(90) lat: number;
  @Coordinate() @IsNumber() @Min(-180) @Max(180) lng: number;
  @Type(() => Number) @IsIn([500, 1000, 3000]) radiusM = 1000;
  @IsOptional() @IsIn(['ALL', 'ELECTRONICS', 'WALLET_BAG']) category:
    'ALL' | 'ELECTRONICS' | 'WALLET_BAG' = 'ALL';
  @IsOptional() @IsIn(['ALL', '7', '30']) registeredDays = 'ALL';
  @IsOptional() @Trim() @IsString() @Length(0, 80) q?: string;
  @IsOptional() @IsString() @Length(1, 1000) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 100;
}
export class PlacesDto {
  @Trim() @IsString() @Length(1, 80) q: string;
  @IsOptional() @Coordinate() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Coordinate() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

export class ReversePlaceDto {
  @ApiProperty({ minimum: -90, maximum: 90 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;
  @ApiProperty({ minimum: -180, maximum: 180 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}
