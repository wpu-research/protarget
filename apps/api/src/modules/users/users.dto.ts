import { IsBoolean, IsEmail, IsEnum, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { NormalizeEmail } from '../auth/auth.dto';
import { OptionalField, Trim } from '../organizations/organizations.dto';

export class InviteUserDto {
  @ApiProperty() @NormalizeEmail() @IsEmail() @MaxLength(254)
  email: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 120)
  name: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  orgId: string;
  @ApiProperty({ enum: Role }) @IsEnum(Role)
  role: Role;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @OptionalField() @Trim() @IsString() @Length(1, 120)
  name?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @OptionalField() @IsUUID()
  orgId?: string;
  @ApiPropertyOptional({ enum: Role }) @OptionalField() @IsEnum(Role)
  role?: Role;
  @ApiPropertyOptional() @OptionalField() @IsBoolean()
  active?: boolean;
}
