import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsIn, IsInt, IsISO8601, IsString, IsUUID, Length, Matches, Max, Min,
  ValidateNested,
} from 'class-validator';
import { CampaignGoal, CampaignStatus, CmsOperationType, Currency, Orientation, PgBillingBasis, PricingModel } from '@prisma/client';
import { BOOKING_STATUSES } from '@protarget/shared';
import type {
  BookingStatus, CampaignCommercial, CampaignDetail, CampaignIssue, CampaignPage, CampaignScreenRow, CampaignSummary,
  CampaignValidation, CmsOperation, CmsOperationPage, OrgRef, ScheduleSlot, ValidationBlocker, ValidationWarning,
} from '@protarget/shared';
import { VALIDATION_BLOCKERS, VALIDATION_WARNINGS } from '@protarget/shared';
import { Nullable, Optional, TrimText, IsTimezone, BooleanQuery, LowerUuid } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';
import { CreativeResponseDto, UserRefDto } from '../creatives/creatives.dto';

const utc = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;
const money = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
const percent = /^(?:100(?:\.0{1,2})?|[1-9]?\d(?:\.\d{1,2})?)$/;
const count = /^[1-9]\d{0,17}$/;
const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const UtcTimestamp = () => (target: object, key: string) => {
  IsISO8601({ strict: true, strictSeparator: true })(target, key);
  Matches(utc, { message: `${key} must be a UTC timestamp ending in Z` })(target, key);
};

export class CampaignQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES }) @Optional() @IsIn(BOOKING_STATUSES) status?: BookingStatus;
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() advertiserId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() agencyId?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @Optional() @TrimText() @IsString() @Length(1, 100) search?: string;
}

export class CreateCampaignDto {
  @ApiProperty({ minLength: 3, maxLength: 150 }) @TrimText() @IsString() @Length(3, 150) name: string;
  @ApiProperty({ format: 'uuid' }) @LowerUuid() @IsUUID() advertiserId: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @Nullable() @LowerUuid() @IsUUID() agencyId?: string | null;
  @ApiProperty({ format: 'uuid', description: 'Active ADMIN user owning the booking internally.' }) @LowerUuid() @IsUUID() internalOwnerId: string;
  @ApiProperty({ format: 'date-time' }) @UtcTimestamp() startAt: string;
  @ApiProperty({ format: 'date-time' }) @UtcTimestamp() endAt: string;
  @ApiProperty({ example: 'Europe/Istanbul' }) @IsTimezone() timezone: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) @Nullable() @TrimText() @IsString() @Length(0, 2000) notes?: string | null;
}

/** Every field optional; LIVE/PAUSED accept only notes and a later endAt. */
export class UpdateCampaignDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 150 }) @Optional() @TrimText() @IsString() @Length(3, 150) name?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() advertiserId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) @Nullable() @LowerUuid() @IsUUID() agencyId?: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() internalOwnerId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @Optional() @UtcTimestamp() startAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @Optional() @UtcTimestamp() endAt?: string;
  @ApiPropertyOptional() @Optional() @IsTimezone() timezone?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 }) @Nullable() @TrimText() @IsString() @Length(0, 2000) notes?: string | null;

  @ApiPropertyOptional({ enum: CampaignGoal, nullable: true }) @Nullable() @IsEnum(CampaignGoal) primaryGoal?: CampaignGoal | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '12000' }) @Nullable() @IsString() @Matches(count) targetPlayouts?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '250000' }) @Nullable() @IsString() @Matches(count) targetImpressions?: string | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1, maximum: 3600, description: 'Planned frequency; informational for manual CMS entry.' })
  @Nullable() @IsInt() @Min(1) @Max(3600) maxPlayoutsPerHourPerScreen?: number | null;

  @ApiPropertyOptional({ enum: PricingModel, nullable: true }) @Nullable() @IsEnum(PricingModel) pricingModel?: PricingModel | null;
  @ApiPropertyOptional({ enum: Currency }) @Optional() @IsEnum(Currency) currency?: Currency;
  @ApiPropertyOptional({ type: String, nullable: true, example: '125.5000' }) @Nullable() @IsString() @Matches(money) @Matches(/[1-9]/) unitPrice?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @Nullable() @IsString() @Matches(money) @Matches(/[1-9]/) budget?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @Nullable() @IsString() @Matches(money) @Matches(/[1-9]/) contractedAmount?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @Nullable() @IsString() @Matches(count) guaranteedImpressions?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @Nullable() @IsString() @Matches(count) contractedQuantity?: string | null;
  @ApiPropertyOptional({ type: String, example: '1.00' }) @Optional() @IsString() @Matches(percent) overdeliveryTolerancePct?: string;
  @ApiPropertyOptional({ enum: PgBillingBasis }) @Optional() @IsEnum(PgBillingBasis) pgBillingBasis?: PgBillingBasis;
  @ApiPropertyOptional({ type: String, nullable: true }) @Nullable() @IsString() @Matches(percent) publisherSharePct?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @Nullable() @IsString() @Matches(percent) protargetSharePct?: string | null;
}

export class ScreenIdsDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @LowerUuid() @IsUUID('all', { each: true }) screenIds: string[];
}
export class CreativeLinkDto {
  @ApiProperty({ format: 'uuid' }) @LowerUuid() @IsUUID() creativeId: string;
}
export class ScheduleSlotDto implements ScheduleSlot {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'ISO weekday, 1 = Monday.' }) @IsInt() @Min(1) @Max(7) dayOfWeek: number;
  @ApiProperty({ example: '08:00' }) @IsString() @Matches(hhmm) startTime: string;
  @ApiProperty({ example: '22:00', description: 'May be earlier than startTime (overnight); must differ.' }) @IsString() @Matches(hhmm) endTime: string;
}
export class ReplaceScheduleDto {
  @ApiProperty({ type: [ScheduleSlotDto], maxItems: 50 })
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ScheduleSlotDto) slots: ScheduleSlotDto[];
}
export class TransitionDto {
  @ApiProperty({ enum: BOOKING_STATUSES }) @IsIn(BOOKING_STATUSES) to: BookingStatus;
  @ApiPropertyOptional({ maxLength: 1000 }) @Optional() @TrimText() @IsString() @Length(1, 1000) reason?: string;
}
export class ScreenOptionQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() venueId?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @Optional() @TrimText() @IsString() @Length(1, 100) city?: string;
  @ApiPropertyOptional({ enum: Orientation }) @Optional() @IsEnum(Orientation) orientation?: Orientation;
  @ApiPropertyOptional({ maxLength: 100 }) @Optional() @TrimText() @IsString() @Length(1, 100) search?: string;
  @ApiPropertyOptional({ description: 'true: only screens already in the campaign.' }) @Optional() @BooleanQuery() @IsIn([true, false]) selected?: boolean;
}
export class CmsOperationQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @LowerUuid() @IsUUID() screenId?: string;
}
export class CreateCmsOperationDto {
  @ApiProperty({ format: 'uuid', description: 'Screen UUID that is part of the campaign.' }) @LowerUuid() @IsUUID() screenId: string;
  @ApiProperty({ enum: CmsOperationType }) @IsEnum(CmsOperationType) type: CmsOperationType;
  @ApiProperty({ format: 'date-time', description: 'When the operator performed it in the CMS; not in the future.' }) @UtcTimestamp() performedAt: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 }) @Nullable() @TrimText() @IsString() @Length(1, 300) cmsReference?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, description: 'Required (non-empty) for NOTE.' }) @Nullable() @TrimText() @IsString() @Length(1, 2000) note?: string | null;
}

export class OrgRefDto implements OrgRef {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() type: string;
}
export class CommercialDto implements CampaignCommercial {
  @ApiProperty({ enum: PricingModel, nullable: true }) pricingModel: PricingModel | null;
  @ApiProperty({ enum: Currency }) currency: Currency;
  @ApiProperty({ type: String, nullable: true }) unitPrice: string | null;
  @ApiProperty({ type: String, nullable: true }) budget: string | null;
  @ApiProperty({ type: String, nullable: true }) contractedAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) guaranteedImpressions: string | null;
  @ApiProperty({ type: String, nullable: true }) contractedQuantity: string | null;
  @ApiProperty() overdeliveryTolerancePct: string;
  @ApiProperty({ enum: PgBillingBasis }) pgBillingBasis: PgBillingBasis;
  @ApiProperty({ type: String, nullable: true }) publisherSharePct: string | null;
  @ApiProperty({ type: String, nullable: true }) protargetSharePct: string | null;
}
export class CampaignSummaryDto implements CampaignSummary {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: CampaignStatus }) status: CampaignStatus;
  @ApiProperty({ type: OrgRefDto }) advertiser: OrgRefDto;
  @ApiProperty({ type: OrgRefDto, nullable: true }) agency: OrgRefDto | null;
  @ApiProperty({ type: UserRefDto }) internalOwner: UserRefDto;
  @ApiProperty({ format: 'date-time' }) startAt: string;
  @ApiProperty({ format: 'date-time' }) endAt: string;
  @ApiProperty() timezone: string;
  @ApiProperty({ enum: CampaignGoal, nullable: true }) primaryGoal: CampaignGoal | null;
  @ApiProperty({ type: String, nullable: true }) targetPlayouts: string | null;
  @ApiProperty({ type: String, nullable: true }) targetImpressions: string | null;
  @ApiProperty({ type: 'integer' }) screenCount: number;
  @ApiProperty({ type: 'integer' }) creativeCount: number;
  @ApiProperty() flightEnded: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
  @ApiProperty({ format: 'date-time', description: 'Server time of the last effective plan change; CMS_UPLOADED must be recorded after it.' }) planChangedAt: string;
}
export class CmsLastOperationDto {
  @ApiProperty({ enum: CmsOperationType }) type: CmsOperationType;
  @ApiProperty({ format: 'date-time' }) performedAt: string;
}
export class CampaignScreenDto implements CampaignScreenRow {
  @ApiProperty({ format: 'uuid' }) screenId: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty() venueName: string;
  @ApiProperty() city: string;
  @ApiProperty() active: boolean;
  @ApiProperty() venueActive: boolean;
  @ApiProperty() timezone: string;
  @ApiProperty({ type: 'integer', nullable: true }) resolutionWidth: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) resolutionHeight: number | null;
  @ApiProperty({ enum: Orientation, nullable: true }) orientation: Orientation | null;
  @ApiProperty({ type: String, nullable: true }) operatingStart: string | null;
  @ApiProperty({ type: String, nullable: true }) operatingEnd: string | null;
  @ApiProperty({ type: 'integer', nullable: true }) loopLengthSec: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) defaultSlotLengthSec: number | null;
  @ApiProperty({ type: String, nullable: true }) currentMultiplier: string | null;
  @ApiProperty({ type: String, nullable: true }) weeklyWindowHours: string | null;
  @ApiProperty({ type: CmsLastOperationDto, nullable: true }) lastCmsOperation: CmsLastOperationDto | null;
  @ApiProperty({ description: 'A CMS_UPLOADED record exists that was recorded after planChangedAt.' }) cmsUploaded: boolean;
  @ApiProperty({ description: 'CMS_UPLOADED records exist, but none after planChangedAt (plan changed since).' }) cmsUploadStale: boolean;
}
export class ScreenOptionDto extends CampaignScreenDto {
  @ApiProperty() selected: boolean;
}
export class ScreenOptionPageDto {
  @ApiProperty({ type: [ScreenOptionDto] }) items: ScreenOptionDto[];
  @ApiProperty({ type: 'integer' }) total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) pageSize: number;
}
export class ScheduleSlotResponseDto implements ScheduleSlot {
  @ApiProperty({ type: 'integer' }) dayOfWeek: number;
  @ApiProperty() startTime: string;
  @ApiProperty() endTime: string;
}
export class CampaignDetailDto extends CampaignSummaryDto implements CampaignDetail {
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: 'integer', nullable: true }) maxPlayoutsPerHourPerScreen: number | null;
  @ApiProperty({ type: CommercialDto }) commercial: CommercialDto;
  @ApiProperty({ type: [CampaignScreenDto] }) screens: CampaignScreenDto[];
  @ApiProperty({ type: [CreativeResponseDto] }) creatives: CreativeResponseDto[];
  @ApiProperty({ type: [ScheduleSlotResponseDto] }) schedule: ScheduleSlotResponseDto[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) launchedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt: string | null;
}
export class CampaignPageDto implements CampaignPage {
  @ApiProperty({ type: [CampaignSummaryDto] }) items: CampaignSummaryDto[];
  @ApiProperty({ type: 'integer' }) total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) pageSize: number;
}
export class BlockerDto implements CampaignIssue<ValidationBlocker> {
  @ApiProperty({ enum: VALIDATION_BLOCKERS }) code: ValidationBlocker;
  @ApiProperty({ type: [String] }) screens: string[];
}
export class WarningDto implements CampaignIssue<ValidationWarning> {
  @ApiProperty({ enum: VALIDATION_WARNINGS }) code: ValidationWarning;
  @ApiProperty({ type: [String] }) screens: string[];
}
export class CampaignValidationDto implements CampaignValidation {
  @ApiProperty({ type: [BlockerDto] }) blockers: BlockerDto[];
  @ApiProperty({ type: [WarningDto] }) warnings: WarningDto[];
  @ApiProperty({ type: [String], description: 'Active screens with no CMS_UPLOADED record recorded after planChangedAt; blocks LIVE.' }) missingCmsUpload: string[];
  @ApiProperty({ format: 'date-time' }) checkedAt: string;
}
export class CmsOperationDto implements CmsOperation {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) screenId: string;
  @ApiProperty() screenCode: string;
  @ApiProperty({ enum: CmsOperationType }) type: CmsOperationType;
  @ApiProperty({ format: 'date-time' }) performedAt: string;
  @ApiProperty({ format: 'date-time' }) recordedAt: string;
  @ApiProperty({ type: UserRefDto }) actor: UserRefDto;
  @ApiProperty({ type: String, nullable: true }) cmsReference: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ enum: ['OPERATOR_DECLARED'] }) source: 'OPERATOR_DECLARED';
}
export class CmsOperationPageDto implements CmsOperationPage {
  @ApiProperty({ type: [CmsOperationDto] }) items: CmsOperationDto[];
  @ApiProperty({ type: 'integer' }) total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) pageSize: number;
}
export class ActivityItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() action: string;
  @ApiProperty({ type: UserRefDto, nullable: true }) user: UserRefDto | null;
  @ApiProperty({ format: 'date-time' }) timestamp: string;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true }) metadata: unknown;
}
export class ActivityPageDto {
  @ApiProperty({ type: [ActivityItemDto] }) items: ActivityItemDto[];
  @ApiProperty({ type: 'integer' }) total: number;
  @ApiProperty({ type: 'integer' }) page: number;
  @ApiProperty({ type: 'integer' }) pageSize: number;
}
