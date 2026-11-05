/**
 * DTO는 API가 받을 수 있는 입력의 형식입니다. 글자 수, 좌표, 시각을 서버에서 다시 검사합니다.
 * 시각은 시간대를 포함해 받고 PostgreSQL에는 UTC 기준으로 저장합니다.
 */
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { TimePrecision } from '../generated/prisma/enums';
import { fail } from './http';

export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
export class LocationDto {
  @Trim() @IsString() @Length(1, 200) label: string;
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;
}
export class LostTimeDto {
  @IsDateString({ strict: true }) start: string;
  @IsDateString({ strict: true }) end: string;
  @IsEnum(TimePrecision) precision: TimePrecision;
}
export function validTime(value: string) {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value))
    fail(
      400,
      'VALIDATION_ERROR',
      '시각에는 시간대를 포함하세요. 예: 2026-11-01T12:00:00+09:00',
    );
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now())
    fail(400, 'VALIDATION_ERROR', '올바른 과거 시각을 입력하세요.');
  return date;
}
export function lostTimes(value: LostTimeDto) {
  const lostStart = validTime(value.start),
    lostEnd = validTime(value.end);
  if (
    lostEnd < lostStart ||
    (value.precision === 'EXACT' && +lostEnd !== +lostStart)
  )
    fail(400, 'VALIDATION_ERROR', '분실 시간 범위가 올바르지 않습니다.');
  return { lostStart, lostEnd, timePrecision: value.precision };
}
export { Type };
