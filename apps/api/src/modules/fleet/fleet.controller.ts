import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/identity';
import { Roles } from '../auth/auth.policy';
import { FleetQueryDto, FleetSceneDto } from './fleet.dto';
import { FleetService } from './fleet.service';

@ApiTags('fleet') @ApiCookieAuth('protarget_access') @Controller('fleet')
export class FleetController {
  constructor(private readonly fleet: FleetService) {}
  /** Read-only snapshot for the admin 3D fleet view. Positions are never returned: ship motion is a client-side simulation. */
  @Get('scene') @Roles(Role.ADMIN) @ApiOkResponse({ type: FleetSceneDto })
  scene(@Req() req: AuthRequest, @Query() query: FleetQueryDto): Promise<FleetSceneDto> {
    return this.fleet.scene(req.principal, query);
  }
}
