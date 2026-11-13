import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
/** Ek özellik "teslimat raporları" (varsayılan kapalı). */
@Module({ controllers: [ReportingController], providers: [ReportingService] })
export class ReportingModule {}
