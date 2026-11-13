import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsISO8601, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { SALES_CURRENCIES, type SalesCurrency } from '@protarget/shared';
import { LowerUuid, Nullable, Optional, TrimText } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';

/** Positive decimal, up to 14 integer and 4 fraction digits; zero is rejected (DB CHECK dailyRate > 0). */
const money = /^(?!0+(?:\.0+)?$)(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
const utc = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;

export class RateQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() screenId?: string;
}
export class CreateRateDto {
  @ApiProperty({ format: 'uuid' }) @LowerUuid() @IsUUID() screenId: string;
  @ApiProperty({ example: '1250.00', description: 'One slot for one day (decimal string)' }) @IsString() @Matches(money) dailyRate: string;
  @ApiProperty({ enum: SALES_CURRENCIES }) @IsIn(SALES_CURRENCIES) currency: SalesCurrency;
  @ApiPropertyOptional({ description: 'UTC; default now; never in the past' })
  @Optional() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(utc) validFrom?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @Optional() @Nullable() @TrimText() @IsString() @MaxLength(500) note?: string | null;
}
export class CreatePackageDto {
  @ApiProperty() @TrimText() @IsString() @Length(1, 120) name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @Optional() @Nullable() @TrimText() @IsString() @MaxLength(1000) description?: string | null;
  @ApiProperty({ type: [String] }) @LowerUuid() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID('all', { each: true }) screenIds: string[];
}
export class UpdatePackageDto {
  @ApiPropertyOptional() @Optional() @TrimText() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @Optional() @Nullable() @TrimText() @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional() @Optional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ type: [String] }) @Optional() @LowerUuid() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID('all', { each: true }) screenIds?: string[];
}
