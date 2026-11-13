import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { CatalogPage, CatalogScreen } from '@protarget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { forbidden, Principal, unauthenticated } from '../../common/identity';
import { inventoryTransaction } from '../../common/inventory-validation';
import { SessionService } from '../auth/session.service';
import { AddonsService } from '../addons/addons.service';
import { CatalogQueryDto } from './catalog.dto';

/** Only fields a buyer may see; internal ones (owner, notes, CMS, rates history) are never selected. */
export const catalogScreenSelect = {
  id: true, screenId: true, name: true, resolutionWidth: true, resolutionHeight: true, orientation: true, physicalSize: true,
  loopLengthSec: true, defaultSlotLengthSec: true, operatingStart: true, operatingEnd: true, timezone: true,
  venue: { select: { id: true, name: true, city: true, type: true } },
} satisfies Prisma.ScreenSelect;
type Row = Prisma.ScreenGetPayload<{ select: typeof catalogScreenSelect }>;
type Price = { screenId: string; dailyRate: Prisma.Decimal; currency: 'TRY' | 'USD'; validFrom: Date };

export function presentCatalogScreen(row: Row, price: Price | undefined): CatalogScreen {
  return {
    id: row.id, code: row.screenId, name: row.name, venue: row.venue,
    resolutionWidth: row.resolutionWidth, resolutionHeight: row.resolutionHeight, orientation: row.orientation, physicalSize: row.physicalSize,
    loopLengthSec: row.loopLengthSec, defaultSlotLengthSec: row.defaultSlotLengthSec,
    operatingStart: row.operatingStart, operatingEnd: row.operatingEnd, timezone: row.timezone,
    listPrice: price ? { dailyRate: price.dailyRate.toFixed(), currency: price.currency, validFrom: price.validFrom.toISOString() } : null,
  };
}

/** Latest started version per screen (rows must be ordered by validFrom desc). */
export function currentPrices(rows: Price[]): Map<string, Price> {
  const map = new Map<string, Price>();
  for (const row of rows) if (!map.has(row.screenId)) map.set(row.screenId, row);
  return map;
}

@Injectable()
export class CatalogService {
  constructor(private readonly db: PrismaService, private readonly sessions: SessionService, private readonly addons: AddonsService) {}

  screens(actor: Principal, query: CatalogQueryDto, now = new Date()): Promise<CatalogPage> {
    return inventoryTransaction(this.db, async tx => {
      const session = await tx.session.findUnique({ where: { id: actor.sessionId }, include: { user: { include: { org: true } } } });
      if (!session || session.accessTokenHash !== actor.accessHash || !this.sessions.isUsable(session)) throw unauthenticated();
      if (session.user.role !== Role.AGENCY && session.user.role !== Role.ADVERTISER) throw forbidden();
      await this.addons.requireEnabled(tx, 'buyerCatalog');
      // Financial fields are closed by default; read from the database, not the token.
      const pricesVisible = session.user.org.spendVisible && (await this.addons.enabledKeys(tx)).includes('sales');
      const where: Prisma.ScreenWhereInput = { active: true, deletedAt: null, venue: { active: true },
        ...(query.venueId ? { venueId: query.venueId } : {}) };
      const [rows, total, venues] = await Promise.all([
        tx.screen.findMany({ where, select: catalogScreenSelect, skip: query.skip, take: query.pageSize,
          orderBy: [{ venue: { name: 'asc' } }, { screenId: 'asc' }] }),
        tx.screen.count({ where }),
        tx.venue.findMany({ where: { active: true, screens: { some: { active: true, deletedAt: null } } },
          select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);
      const prices = pricesVisible && rows.length ? currentPrices(await tx.screenRate.findMany({
        where: { screenId: { in: rows.map(r => r.id) }, validFrom: { lte: now } },
        select: { screenId: true, dailyRate: true, currency: true, validFrom: true }, orderBy: [{ validFrom: 'desc' }] })) : new Map<string, Price>();
      return { items: rows.map(row => presentCatalogScreen(row, prices.get(row.id))), total, page: query.page, pageSize: query.pageSize,
        pricesVisible, venues };
    });
  }
}
