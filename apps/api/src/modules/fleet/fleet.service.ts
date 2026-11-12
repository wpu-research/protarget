import { Injectable } from '@nestjs/common';
import { FLEET_SCREEN_LIMIT, FLEET_SHIP_LIMIT } from '@protarget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Principal } from '../../common/identity';
import { inventoryTransaction } from '../../common/inventory-validation';
import { SessionService } from '../auth/session.service';
import { FleetQueryDto, FleetSceneDto, FleetScreenDto } from './fleet.dto';
import { declarationSelect, presentDeclarations } from './fleet.presenter';

@Injectable()
export class FleetService {
  constructor(private readonly db: PrismaService, private readonly sessions: SessionService) {}

  scene(actor: Principal, query: FleetQueryDto): Promise<FleetSceneDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const all = query.includeInactive === true;
      const venues = await tx.venue.findMany({
        where: { type: 'ferry', ...(all ? {} : { active: true }) },
        select: { id: true, name: true, active: true, city: true, timezone: true, notes: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }], take: FLEET_SHIP_LIMIT + 1,
      });
      const shown = venues.slice(0, FLEET_SHIP_LIMIT);
      const ships = [];
      for (const venue of shown) {
        const screens = await tx.screen.findMany({
          where: { venueId: venue.id, deletedAt: null, ...(all ? {} : { active: true }) },
          select: {
            id: true, screenId: true, name: true, active: true, locationLabel: true, resolutionWidth: true,
            resolutionHeight: true, orientation: true, physicalSize: true, operatingStart: true, operatingEnd: true,
            timezone: true, campaignScreens: { select: declarationSelect },
          },
          orderBy: [{ screenId: 'asc' }, { id: 'asc' }], take: FLEET_SCREEN_LIMIT + 1,
        });
        const shownScreens = screens.slice(0, FLEET_SCREEN_LIMIT);
        const campaignIds = [...new Set(shownScreens.flatMap(s => s.campaignScreens.map(c => c.campaign.id)))];
        const operations = campaignIds.length === 0 ? [] : await tx.campaignCmsOperation.findMany({
          where: { campaignId: { in: campaignIds }, screenId: { in: shownScreens.map(s => s.id) } },
          select: { campaignId: true, screenId: true, type: true, performedAt: true },
          orderBy: { performedAt: 'desc' }, take: 5000,
        });
        ships.push({
          ...venue,
          screens: shownScreens.map((s): FleetScreenDto => ({
            id: s.id, screenId: s.screenId, name: s.name, active: s.active, locationLabel: s.locationLabel,
            resolutionWidth: s.resolutionWidth, resolutionHeight: s.resolutionHeight, orientation: s.orientation,
            physicalSize: s.physicalSize, operatingStart: s.operatingStart, operatingEnd: s.operatingEnd,
            timezone: s.timezone, declarations: presentDeclarations(s.id, s.campaignScreens, operations),
          })),
          screensTruncated: screens.length > FLEET_SCREEN_LIMIT,
        });
      }
      return { asOf: new Date().toISOString(), ships, shipsTruncated: venues.length > FLEET_SHIP_LIMIT };
    });
  }
}
