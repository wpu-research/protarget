import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { CatalogPage } from '@protarget/shared';
import type { AuthRequest } from '../../common/identity';
import { Roles } from '../auth/auth.policy';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './catalog.dto';

/** Add-on "buyerCatalog" (off by default → 404 ADDON_DISABLED). Read-only; no booking request is accepted. */
@ApiTags('addons') @ApiCookieAuth('protarget_access') @Controller('portal/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('screens') @Roles(Role.AGENCY, Role.ADVERTISER)
  screens(@Req() req: AuthRequest, @Query() query: CatalogQueryDto): Promise<CatalogPage> {
    return this.catalog.screens(req.principal, query);
  }
}
