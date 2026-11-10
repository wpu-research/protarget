import { OrganizationType } from '@prisma/client';
import { IsBoolean, IsEnum, IsString, Length, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const OptionalField = () => ValidateIf((_object, value: unknown) => value !== undefined);
export const Trim = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value);

class OrganizationFieldsDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null) @Trim() @IsString() @Length(1, 160)
  brandName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null) @Trim() @IsString() @Length(1, 250)
  taxLegalLabel?: string | null;
  @ApiPropertyOptional() @OptionalField() @IsBoolean()
  active?: boolean;
  @ApiPropertyOptional() @OptionalField() @IsBoolean()
  spendVisible?: boolean;
  @ApiPropertyOptional() @OptionalField() @IsBoolean()
  revenueShareVisible?: boolean;
}

export class CreateOrganizationDto extends OrganizationFieldsDto {
  @ApiProperty() @Trim() @IsString() @Length(1, 160)
  name: string;
  @ApiProperty({ enum: OrganizationType }) @IsEnum(OrganizationType)
  type: OrganizationType;
}

export class UpdateOrganizationDto extends OrganizationFieldsDto {
  @ApiPropertyOptional() @OptionalField() @Trim() @IsString() @Length(1, 160)
  name?: string;
  @ApiPropertyOptional({ enum: OrganizationType }) @OptionalField() @IsEnum(OrganizationType)
  type?: OrganizationType;
}
