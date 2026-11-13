import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { DELIVERY_MAX_CSV_CHARS, DELIVERY_SOURCES, type DeliverySource } from '@protarget/shared';
import { BooleanQuery, LowerUuid, Nullable, Optional, TrimText } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';

export class DeliveryImportDto {
  @ApiProperty({ enum: DELIVERY_SOURCES }) @IsIn(DELIVERY_SOURCES) source: DeliverySource;
  @ApiProperty({ maxLength: 200 }) @TrimText() @IsString() @Length(1, 200) filename: string;
  @ApiProperty({ maxLength: DELIVERY_MAX_CSV_CHARS, description: 'CSV text with header row' })
  @IsString() @Length(1, DELIVERY_MAX_CSV_CHARS) csv: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @Optional() @Nullable() @TrimText() @IsString() @MaxLength(1000) note?: string | null;
}

export class DeliveryRecordQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() campaignId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() screenId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() batchId?: string;
  @ApiPropertyOptional({ enum: DELIVERY_SOURCES }) @Optional() @IsIn(DELIVERY_SOURCES) source?: DeliverySource;
  @ApiPropertyOptional({ type: Boolean, default: false }) @BooleanQuery() @IsBoolean() includeVoided = false;
}

export class VoidDeliveryDto {
  @ApiProperty({ minLength: 3, maxLength: 500 }) @TrimText() @IsString() @Length(3, 500) reason: string;
}
