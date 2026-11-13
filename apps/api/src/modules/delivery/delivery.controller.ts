import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { DeliveryBatchView, DeliveryPreview, DeliveryRecordView, PageResult } from '@protarget/shared';
import type { AuthRequest } from '../../common/identity';
import { LowerUuidPipe } from '../../common/inventory-validation';
import { Roles } from '../auth/auth.policy';
import { DeliveryService } from './delivery.service';
import { DeliveryImportDto, DeliveryRecordQueryDto, VoidDeliveryDto } from './delivery.dto';

/** Add-on "proofOfPlay" (off by default → 404 ADDON_DISABLED). Imported rows are labelled by source and never merged. */
@ApiTags('addons') @ApiCookieAuth('protarget_access') @Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}
  @Post('imports/preview') @HttpCode(200) @Roles(Role.ADMIN)
  preview(@Req() req: AuthRequest, @Body() dto: DeliveryImportDto): Promise<DeliveryPreview> {
    return this.delivery.preview(req.principal, dto);
  }
  @Post('imports') @Roles(Role.ADMIN)
  import(@Req() req: AuthRequest, @Body() dto: DeliveryImportDto): Promise<DeliveryBatchView> {
    return this.delivery.import(req.principal, dto);
  }
  @Get('imports') @Roles(Role.ADMIN)
  batches(@Req() req: AuthRequest, @Query() query: DeliveryRecordQueryDto): Promise<PageResult<DeliveryBatchView>> {
    return this.delivery.batches(req.principal, query);
  }
  @Get('records') @Roles(Role.ADMIN)
  records(@Req() req: AuthRequest, @Query() query: DeliveryRecordQueryDto): Promise<PageResult<DeliveryRecordView>> {
    return this.delivery.records(req.principal, query);
  }
  @Post('records/:id/void') @HttpCode(200) @Roles(Role.ADMIN)
  void(@Req() req: AuthRequest, @Param('id', LowerUuidPipe) id: string, @Body() dto: VoidDeliveryDto): Promise<DeliveryRecordView> {
    return this.delivery.void(req.principal, id, dto);
  }
}
