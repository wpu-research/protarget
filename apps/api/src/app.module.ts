import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/settings/settings.module';
import { VenuesModule } from './modules/venues/venues.module';
import { ScreensModule } from './modules/screens/screens.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { MultipliersModule } from './modules/multipliers/multipliers.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { CreativesModule } from './modules/creatives/creatives.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { PlayerModule } from './modules/player/player.module';
import { ProofOfPlayModule } from './modules/proof-of-play/proof-of-play.module';
import { ManifestsModule } from './modules/manifests/manifests.module';
import { ImpressionsModule } from './modules/impressions/impressions.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { PortalModule } from './modules/portal/portal.module';
import { DealsModule } from './modules/deals/deals.module';
import { PacingModule } from './modules/pacing/pacing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OpsModule } from './modules/ops/ops.module';
import { AddonsModule } from './modules/addons/addons.module';
import { CapacityModule } from './modules/capacity/capacity.module';
import { DeliveryModule } from './modules/delivery/delivery.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    AuditModule,
    SettingsModule,
    VenuesModule,
    ScreensModule,
    FleetModule,
    MultipliersModule,
    CampaignsModule,
    CreativesModule,
    SchedulingModule,
    PlayerModule,
    ProofOfPlayModule,
    ManifestsModule,
    ImpressionsModule,
    ReportingModule,
    PortalModule,
    DealsModule,
    PacingModule,
    NotificationsModule,
    OpsModule,
    AddonsModule,
    CapacityModule,
    DeliveryModule,
  ],
})
export class AppModule {}
