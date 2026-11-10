import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Orientation } from '@prisma/client';
import type { InventoryScreen, PageResult } from '@protarget/shared';
import { PaginationDto } from '../../common/pagination.dto';
import { BooleanQuery, IsTimezone, Nullable, Optional, TrimText } from '../../common/inventory-validation';
import { VenueResponseDto } from '../venues/venues.dto';

export class ScreenQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @IsUUID()
  venueId?: string;
  @ApiPropertyOptional({ type: Boolean }) @Optional() @BooleanQuery() @IsBoolean()
  active?: boolean;
}
export class CreateScreenDto {
  @ApiProperty({ maxLength: 64, pattern: '^[A-Z0-9][A-Z0-9_-]*$' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Length(1, 64) @Matches(/^[A-Z0-9][A-Z0-9_-]*$/)
  screenId: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  venueId: string;
  @ApiProperty({ maxLength: 160 }) @TrimText() @IsString() @Length(1, 160)
  name: string;
  @ApiProperty({ maxLength: 100, example: 'Europe/Istanbul' }) @TrimText() @IsString() @Length(1, 100) @IsTimezone()
  timezone: string;
  @ApiPropertyOptional({ default: true }) @Optional() @IsBoolean()
  active?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 250 }) @Nullable() @TrimText() @IsString() @Length(1, 250)
  locationLabel?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 2147483647 }) @Nullable() @IsInt() @Min(1) @Max(2147483647)
  resolutionWidth?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 2147483647 }) @Nullable() @IsInt() @Min(1) @Max(2147483647)
  resolutionHeight?: number | null;
  @ApiPropertyOptional({ enum: Orientation, nullable: true }) @Nullable() @IsEnum(Orientation)
  orientation?: Orientation | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @Nullable() @TrimText() @IsString() @Length(1, 100)
  physicalSize?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 160 }) @Nullable() @TrimText() @IsString() @Length(1, 160)
  os?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 160 }) @Nullable() @TrimText() @IsString() @Length(1, 160)
  cmsName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @Nullable() @TrimText() @IsString() @Length(1, 100)
  cmsVersion?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 }) @Nullable() @TrimText() @IsString() @Length(1, 500)
  cmsReference?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 4000 }) @Nullable() @TrimText() @IsString() @Length(1, 4000)
  notes?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 2147483647 }) @Nullable() @IsInt() @Min(1) @Max(2147483647)
  loopLengthSec?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 2147483647 }) @Nullable() @IsInt() @Min(1) @Max(2147483647)
  defaultSlotLengthSec?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' })
  @Nullable() @Matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
  operatingStart?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' })
  @Nullable() @Matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
  operatingEnd?: string | null;
}
export class UpdateScreenDto extends PartialType(CreateScreenDto, { skipNullProperties: false }) {}

export class ScreenResponseDto implements InventoryScreen {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() screenId: string;
  @ApiProperty() screenIdLocked: boolean;
  @ApiProperty({ format: 'uuid' }) venueId: string;
  @ApiProperty({ type: VenueResponseDto }) venue: VenueResponseDto;
  @ApiProperty() name: string;
  @ApiProperty() timezone: string;
  @ApiProperty() active: boolean;
  @ApiProperty({ type: String, nullable: true }) locationLabel: string | null;
  @ApiProperty({ type: 'integer', nullable: true }) resolutionWidth: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) resolutionHeight: number | null;
  @ApiProperty({ enum: Orientation, nullable: true }) orientation: Orientation | null;
  @ApiProperty({ type: String, nullable: true }) physicalSize: string | null;
  @ApiProperty({ type: String, nullable: true }) os: string | null;
  @ApiProperty({ type: String, nullable: true }) cmsName: string | null;
  @ApiProperty({ type: String, nullable: true }) cmsVersion: string | null;
  @ApiProperty({ type: String, nullable: true }) cmsReference: string | null;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: 'integer', nullable: true }) loopLengthSec: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) defaultSlotLengthSec: number | null;
  @ApiProperty({ type: String, nullable: true }) operatingStart: string | null;
  @ApiProperty({ type: String, nullable: true }) operatingEnd: string | null;
  @ApiProperty({ enum: ['NOT_CONNECTED'], description: 'Manual inventory is not connected to a CMS or player.' })
  connectionStatus: 'NOT_CONNECTED';
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}
export class ScreenPageDto implements PageResult<InventoryScreen> {
  @ApiProperty({ type: [ScreenResponseDto] }) items: ScreenResponseDto[];
  @ApiProperty({ type: 'integer' }) total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) pageSize: number;
}
