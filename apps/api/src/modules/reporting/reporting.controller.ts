import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { CampaignDeliveryReport, PageResult, ReportCampaignListItem } from '@protarget/shared';
import type { AuthRequest } from '../../common/identity';
import { LowerUuidPipe } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';
import { Roles } from '../auth/auth.policy';
import { ReportingService } from './reporting.service';

/** Add-on "reporting" (off by default → 404 ADDON_DISABLED). Read-only; sources are shown side by side, never summed. */
@ApiTags('addons') @ApiCookieAuth('protarget_access') @Controller()
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}
  @Get('reports/campaigns/:id/delivery') @Roles(Role.ADMIN)
  admin(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string): Promise<CampaignDeliveryReport> {
    return this.reporting.adminReport(req.principal, id);
  }
  @Get('portal/reports/campaigns') @Roles(Role.AGENCY, Role.ADVERTISER)
  portalList(@Req() req: AuthRequest, @Query() query: PaginationDto): Promise<PageResult<ReportCampaignListItem>> {
    return this.reporting.portalCampaigns(req.principal, query);
  }
  @Get('portal/reports/campaigns/:id/delivery') @Roles(Role.AGENCY, Role.ADVERTISER)
  portal(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string): Promise<CampaignDeliveryReport> {
    return this.reporting.portalReport(req.principal, id);
  }
}
