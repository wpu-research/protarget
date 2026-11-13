import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { CAPACITY_MAX_DAYS } from '@protarget/shared';
import { BooleanQuery, LowerUuid, Nullable, Optional, TrimText } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';

const utc = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;
const UtcTimestamp = () => (target: object, key: string) => {
  IsISO8601({ strict: true, strictSeparator: true })(target, key);
  Matches(utc, { message: `${key} must be a UTC timestamp ending in Z` })(target, key);
};

export class CapacityQueryDto extends PaginationDto {
  @ApiProperty({ example: '2026-11-13', description: 'First UTC day (YYYY-MM-DD)' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/) from: string;
  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: CAPACITY_MAX_DAYS })
  @Type(() => Number) @IsInt() @Min(1) @Max(CAPACITY_MAX_DAYS) days = 7;
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() venueId?: string;
}

export class HoldQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() screenId?: string;
  @ApiPropertyOptional({ type: Boolean, default: false, description: 'Only holds that still count' })
  @BooleanQuery() @IsBoolean() activeOnly = false;
}

export class CreateHoldDto {
  @ApiProperty({ format: 'uuid' }) @LowerUuid() @IsUUID() screenId: string;
  @ApiProperty({ minLength: 1, maxLength: 120 }) @TrimText() @IsString() @Length(1, 120) label: string;
  @ApiProperty() @UtcTimestamp() startAt: string;
  @ApiProperty() @UtcTimestamp() endAt: string;
  @ApiProperty({ minimum: 1, maximum: 100 }) @IsInt() @Min(1) @Max(100) slots: number;
  @ApiProperty() @UtcTimestamp() expiresAt: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @Optional() @Nullable() @TrimText() @IsString() @Length(0, 1000) note?: string | null;
}

export class ReleaseHoldDto {
  @ApiProperty({ minLength: 3, maxLength: 500 }) @TrimText() @IsString() @Length(3, 500) reason: string;
}
