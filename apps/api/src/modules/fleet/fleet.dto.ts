import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { BooleanQuery, Optional } from '../../common/inventory-validation';
import type { FleetDeclaration, FleetScene, FleetScreen, FleetShip } from '@protarget/shared';

export class FleetQueryDto {
  @ApiPropertyOptional({ type: Boolean, default: false, description: 'Include inactive ships and screens' })
  @Optional() @BooleanQuery() @IsBoolean()
  includeInactive?: boolean;
}
export class FleetDeclarationDto implements FleetDeclaration {
  @ApiProperty({ format: 'uuid' }) campaignId: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Operator-declared booking status; not proof of playback.' }) status: FleetDeclaration['status'];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } }) creativeStatusCounts: FleetDeclaration['creativeStatusCounts'];
  @ApiProperty({ type: 'object', nullable: true, properties: { type: { type: 'string' }, performedAt: { type: 'string', format: 'date-time' } } })
  lastCmsOperation: FleetDeclaration['lastCmsOperation'];
}
export class FleetScreenDto implements FleetScreen {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() screenId: string;
  @ApiProperty() name: string;
  @ApiProperty() active: boolean;
  @ApiProperty({ type: String, nullable: true }) locationLabel: string | null;
  @ApiProperty({ type: Number, nullable: true }) resolutionWidth: number | null;
  @ApiProperty({ type: Number, nullable: true }) resolutionHeight: number | null;
  @ApiProperty({ enum: ['LANDSCAPE', 'PORTRAIT'], nullable: true }) orientation: FleetScreen['orientation'];
  @ApiProperty({ type: String, nullable: true }) physicalSize: string | null;
  @ApiProperty({ type: String, nullable: true }) operatingStart: string | null;
  @ApiProperty({ type: String, nullable: true }) operatingEnd: string | null;
  @ApiProperty() timezone: string;
  @ApiProperty({ type: [FleetDeclarationDto] }) declarations: FleetDeclarationDto[];
}
export class FleetShipDto implements FleetShip {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() active: boolean;
  @ApiProperty() city: string;
  @ApiProperty() timezone: string;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: [FleetScreenDto] }) screens: FleetScreenDto[];
  @ApiProperty() screensTruncated: boolean;
}
export class FleetSceneDto implements FleetScene {
  @ApiProperty({ format: 'date-time' }) asOf: string;
  @ApiProperty({ type: [FleetShipDto] }) ships: FleetShipDto[];
  @ApiProperty() shipsTruncated: boolean;
}
