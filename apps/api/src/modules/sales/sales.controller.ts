import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { PageResult, ProposalDocument, RateView, SalesPackageView } from '@protarget/shared';
import type { AuthRequest } from '../../common/identity';
import { LowerUuidPipe } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';
import { Roles } from '../auth/auth.policy';
import { SalesService } from './sales.service';
import { CreatePackageDto, CreateRateDto, RateQueryDto, UpdatePackageDto } from './sales.dto';

/** Add-on "sales" (off by default → 404 ADDON_DISABLED). List prices only: no discount approval, no invoice. */
@ApiTags('addons') @ApiCookieAuth('protarget_access') @Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}
  @Get('rates') @Roles(Role.ADMIN)
  rates(@Req() req: AuthRequest, @Query() query: RateQueryDto): Promise<PageResult<RateView>> { return this.sales.rates(req.principal, query); }
  @Post('rates') @Roles(Role.ADMIN)
  createRate(@Req() req: AuthRequest, @Body() dto: CreateRateDto): Promise<RateView> { return this.sales.createRate(req.principal, dto); }
  @Get('packages') @Roles(Role.ADMIN)
  packages(@Req() req: AuthRequest, @Query() query: PaginationDto): Promise<PageResult<SalesPackageView>> { return this.sales.packages(req.principal, query); }
  @Post('packages') @Roles(Role.ADMIN)
  createPackage(@Req() req: AuthRequest, @Body() dto: CreatePackageDto): Promise<SalesPackageView> { return this.sales.createPackage(req.principal, dto); }
  @Patch('packages/:id') @Roles(Role.ADMIN)
  updatePackage(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: UpdatePackageDto): Promise<SalesPackageView> {
    return this.sales.updatePackage(req.principal, id, dto);
  }
  @Get('proposals/:campaignId') @Roles(Role.ADMIN)
  proposal(@Req() req: AuthRequest, @Param('campaignId', LowerUuidPipe) id: string): Promise<ProposalDocument> { return this.sales.proposal(req.principal, id); }
}
