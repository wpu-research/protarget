import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { VenueType } from '@prisma/client';
import { IsBoolean, IsEnum, IsString, Length } from 'class-validator';
import type { InventoryVenue, PageResult } from '@protarget/shared';
import { PaginationDto } from '../../common/pagination.dto';
import { BooleanQuery, IsTimezone, Nullable, Optional, TrimText } from '../../common/inventory-validation';

export class VenueQueryDto extends PaginationDto {
  @ApiPropertyOptional({ type: Boolean }) @Optional() @BooleanQuery() @IsBoolean()
  active?: boolean;
}
export class CreateVenueDto {
  @ApiProperty({ maxLength: 160 }) @TrimText() @IsString() @Length(1, 160)
  name: string;
  @ApiPropertyOptional({ enum: VenueType, default: VenueType.ferry }) @Optional() @IsEnum(VenueType)
  type?: VenueType;
  @ApiProperty({ maxLength: 100 }) @TrimText() @IsString() @Length(1, 100)
  country: string;
  @ApiProperty({ maxLength: 100 }) @TrimText() @IsString() @Length(1, 100)
  city: string;
  @ApiProperty({ maxLength: 100, example: 'Europe/Istanbul' }) @TrimText() @IsString() @Length(1, 100) @IsTimezone()
  timezone: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 4000 }) @Nullable() @TrimText() @IsString() @Length(1, 4000)
  notes?: string | null;
  @ApiPropertyOptional({ default: true }) @Optional() @IsBoolean()
  active?: boolean;
}
// Null is not omission for required fields; explicitly nullable fields retain their own validators.
export class UpdateVenueDto extends PartialType(CreateVenueDto, { skipNullProperties: false }) {}

export class VenueResponseDto implements InventoryVenue {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: VenueType }) type: VenueType;
  @ApiProperty() country: string;
  @ApiProperty() city: string;
  @ApiProperty() timezone: string;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty() active: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}
export class VenuePageDto implements PageResult<InventoryVenue> {
  @ApiProperty({ type: [VenueResponseDto] }) items: VenueResponseDto[];
  @ApiProperty({ type: 'integer' }) total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) pageSize: number;
}
