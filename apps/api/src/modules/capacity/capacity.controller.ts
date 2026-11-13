import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { CapacityReport, PageResult, ScreenHoldView } from '@protarget/shared';
import type { AuthRequest } from '../../common/identity';
import { LowerUuidPipe } from '../../common/inventory-validation';
import { Roles } from '../auth/auth.policy';
import { CapacityService } from './capacity.service';
import { CapacityQueryDto, CreateHoldDto, HoldQueryDto, ReleaseHoldDto } from './capacity.dto';

/** Add-on "capacity" (off by default → 404 ADDON_DISABLED). Information only; never blocks a booking. */
@ApiTags('addons') @ApiCookieAuth('protarget_access') @Controller('capacity')
export class CapacityController {
  constructor(private readonly capacity: CapacityService) {}
  @Get() @Roles(Role.ADMIN)
  report(@Req() req: AuthRequest, @Query() query: CapacityQueryDto): Promise<CapacityReport> {
    return this.capacity.report(req.principal, query);
  }
  @Get('holds') @Roles(Role.ADMIN)
  holds(@Req() req: AuthRequest, @Query() query: HoldQueryDto): Promise<PageResult<ScreenHoldView>> {
    return this.capacity.holds(req.principal, query);
  }
  @Post('holds') @Roles(Role.ADMIN)
  create(@Req() req: AuthRequest, @Body() dto: CreateHoldDto): Promise<ScreenHoldView> {
    return this.capacity.createHold(req.principal, dto);
  }
  @Post('holds/:id/release') @Roles(Role.ADMIN)
  release(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: ReleaseHoldDto): Promise<ScreenHoldView> {
    return this.capacity.releaseHold(req.principal, id, dto);
  }
}
