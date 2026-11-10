import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PortalController } from './portal.controller';

@Module({ imports: [OrganizationsModule], controllers: [PortalController] })
export class PortalModule {}
