import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/identity';
import { Roles } from '../auth/auth.policy';
import { OrganizationsService } from '../organizations/organizations.service';

@ApiTags('portal') @ApiCookieAuth('protarget_access')
@Controller('portal') @Roles(Role.ADMIN, Role.AGENCY, Role.ADVERTISER)
export class PortalController {
  constructor(private readonly organizations: OrganizationsService) {}
  @Get('organizations/:id')
  organization(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.get(req.principal, id, true);
  }
}
