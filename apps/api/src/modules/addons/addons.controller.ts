import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { Role } from '@prisma/client';
import { ADDON_KEYS, isAddonKey, type AddonKey, type AddonState } from '@protarget/shared';
import { missing } from '../../common/inventory-validation';
import type { AuthRequest } from '../../common/identity';
import { Roles } from '../auth/auth.policy';
import { AddonsService } from './addons.service';

export class UpdateAddonDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}
export class AddonStateDto implements AddonState {
  @ApiProperty({ enum: ADDON_KEYS }) key: AddonKey;
  @ApiProperty() area: number;
  @ApiProperty({ enum: ['WORKING', 'PLACEHOLDER'] }) kind: 'WORKING' | 'PLACEHOLDER';
  @ApiProperty() ready: boolean;
  @ApiProperty({ type: [String] }) prerequisites: string[];
  @ApiProperty() enabled: boolean;
  @ApiProperty() storedOn: boolean;
  @ApiProperty({ type: String, nullable: true }) updatedAt: string | null;
}

@ApiTags('addons') @ApiCookieAuth('protarget_access') @Controller('addons')
export class AddonsController {
  constructor(private readonly addons: AddonsService) {}
  @Get() @Roles(Role.ADMIN) @ApiOkResponse({ type: [AddonStateDto] })
  list(@Req() req: AuthRequest): Promise<AddonState[]> {
    return this.addons.list(req.principal);
  }
  @Patch(':key') @Roles(Role.ADMIN) @ApiOkResponse({ type: AddonStateDto })
  update(@Req() req: AuthRequest, @Param('key') key: string, @Body() dto: UpdateAddonDto): Promise<AddonState> {
    if (!isAddonKey(key)) throw missing('Add-on');
    return this.addons.setEnabled(req.principal, key, dto.enabled);
  }
}
