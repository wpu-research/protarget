import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalStatus, MultiplierSourceType } from '@prisma/client';
import { IsISO8601, IsString, IsUUID, Length, Matches } from 'class-validator';
import type { InventoryMultiplier, InventoryMultiplierHistory } from '@protarget/shared';
import { Nullable, Optional, TrimText } from '../../common/inventory-validation';

export class CreateMultiplierDto {
  @ApiProperty({ type: String, example: '1.2500', description: 'Positive decimal string, maximum 99999999.9999; no exponent.' })
  @IsString() @Matches(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/) @Matches(/[1-9]/)
  value: string;
  @ApiProperty({ maxLength: 500 }) @TrimText() @IsString() @Length(1, 500)
  sourceRef: string;
  @ApiProperty({ maxLength: 2000 }) @TrimText() @IsString() @Length(1, 2000)
  changeReason: string;
}
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;
export class ApproveMultiplierDto {
  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Omit for server-now; otherwise future UTC timestamp ending in Z.' })
  @Optional() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(utcTimestamp)
  validFrom?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Nullable() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(utcTimestamp)
  validTo?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Explicit earlier open whole-screen profile to close at the new start.' })
  @Nullable() @IsUUID()
  supersedesId?: string | null;
}
export class MultiplierResponseDto implements InventoryMultiplier {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) screenId: string;
  @ApiProperty({ type: String, example: '1.2500' }) value: string;
  @ApiProperty({ enum: MultiplierSourceType }) sourceType: MultiplierSourceType;
  @ApiProperty() sourceRef: string;
  @ApiProperty({ type: String, nullable: true }) changeReason: string | null;
  @ApiProperty({ type: String, nullable: true }) confidenceNote: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validFrom: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validTo: string | null;
  @ApiProperty({ type: String, nullable: true }) daypartStart: string | null;
  @ApiProperty({ type: String, nullable: true }) daypartEnd: string | null;
  @ApiProperty({ type: [Number] }) weekdays: number[];
  @ApiProperty({ enum: ApprovalStatus }) approvalStatus: ApprovalStatus;
  @ApiProperty({ type: 'integer' }) version: number;
  @ApiProperty({ format: 'uuid' }) createdBy: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) approvedBy: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) approvedAt: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) supersedesId: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class MultiplierHistoryDto implements InventoryMultiplierHistory {
  @ApiProperty({ type: [MultiplierResponseDto] }) items: MultiplierResponseDto[];
  @ApiProperty({ type: 'integer' }) total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) pageSize: number;
  @ApiProperty({ format: 'date-time' }) asOf: string;
  @ApiProperty({ type: MultiplierResponseDto, nullable: true, description: 'Approved whole-screen profile effective at asOf, using a half-open interval.' })
  current: MultiplierResponseDto | null;
  @ApiProperty({ type: MultiplierResponseDto, nullable: true, description: 'Latest-created version, independent of current approval/effective time.' })
  latest: MultiplierResponseDto | null;
}
