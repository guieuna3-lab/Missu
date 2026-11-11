import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
export const ROUTE_POLICY = 'route-48h-v1';
export class StartRouteDto {
  @IsUUID() clientRecordingId: string;
  @Equals(true) agreed: boolean;
  @Equals(ROUTE_POLICY) policyVersion: string;
  @IsIn(['DEVICE', 'DEMO']) source: 'DEVICE' | 'DEMO';
}
export class RoutePointDto {
  @IsUUID() clientPointId: string;
  @IsDateString({ strict: true }) recordedAt: string;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat: number;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng: number;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(5000)
  accuracyM: number;
}
export class AppendRouteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((point: RoutePointDto) => point.clientPointId)
  @ValidateNested({ each: true })
  @Type(() => RoutePointDto)
  points: RoutePointDto[];
}
export class RouteDayDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
}
export class DeleteRouteDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @Equals('true') all?: string;
}
export class StopRouteDto {}
