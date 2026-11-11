import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreativeStatus } from '@prisma/client';
import { IsEnum, IsString, IsUUID, Length, Matches } from 'class-validator';
import type { CreativePage, CreativeSummary, UserRef } from '@protarget/shared';
import { LowerUuid, Optional, TrimText } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';

export class CreativeQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() advertiserId?: string;
  @ApiPropertyOptional({ enum: CreativeStatus }) @Optional() @IsEnum(CreativeStatus) status?: CreativeStatus;
  @ApiPropertyOptional({ maxLength: 100 }) @Optional() @TrimText() @IsString() @Length(1, 100) search?: string;
}
/** Multipart text fields that accompany the `file` part. */
export class UploadCreativeDto {
  @ApiProperty({ format: 'uuid' }) @LowerUuid() @IsUUID() advertiserId: string;
  @ApiPropertyOptional({ type: String, example: '10', description: 'Images only: display seconds 1–300, up to 3 decimals. Rejected for video (measured).' })
  @Optional() @IsString() @Matches(/^(?:[1-9]\d{0,2})(?:\.\d{1,3})?$/)
  displayDurationSeconds?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Earlier creative of the same advertiser this version replaces.' })
  @Optional() @LowerUuid() @IsUUID() replacesId?: string;
}
export class RejectCreativeDto {
  @ApiProperty({ maxLength: 1000 }) @TrimText() @IsString() @Length(1, 1000) reason: string;
}
export class RevokeCreativeDto {
  @ApiProperty({ maxLength: 1000 }) @TrimText() @IsString() @Length(1, 1000) reason: string;
}
export class UserRefDto implements UserRef {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}
export class CreativeResponseDto implements CreativeSummary {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty({ format: 'uuid' }) advertiserId: string;
  @ApiProperty() originalFilename: string;
  @ApiProperty({ enum: ['video/mp4', 'image/png', 'image/jpeg', 'application/octet-stream'] }) mime: string;
  @ApiProperty({ enum: ['VIDEO', 'IMAGE'], nullable: true }) kind: 'VIDEO' | 'IMAGE' | null;
  @ApiProperty({ type: String, nullable: true, example: '15.000' }) durationSeconds: string | null;
  @ApiProperty() durationManual: boolean;
  @ApiProperty({ type: 'integer', nullable: true }) width: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) height: number | null;
  @ApiProperty({ type: String, nullable: true }) sizeBytes: string | null;
  @ApiProperty({ type: String, nullable: true }) checksum: string | null;
  @ApiProperty({ type: String, nullable: true }) videoCodec: string | null;
  @ApiProperty({ enum: CreativeStatus }) status: CreativeStatus;
  @ApiProperty({ type: String, nullable: true }) rejectionReason: string | null;
  @ApiProperty({ type: 'integer' }) version: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) replacesId: string | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) uploadedBy: UserRefDto | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) approvedBy: UserRefDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) approvedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt: string | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) revokedBy: UserRefDto | null;
  @ApiProperty({ type: String, nullable: true }) revocationReason: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class CreativePageDto implements CreativePage {
  @ApiProperty({ type: [CreativeResponseDto] }) items: CreativeResponseDto[];
  @ApiProperty({ type: 'integer' }) total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) pageSize: number;
}
