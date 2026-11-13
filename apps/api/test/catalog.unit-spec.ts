import { Prisma } from '@prisma/client';
import { catalogScreenSelect, currentPrices, presentCatalogScreen } from '../src/modules/catalog/catalog.service';

const row = {
  id: 's1', screenId: 'SCR-1', name: 'Ön', resolutionWidth: 1920, resolutionHeight: 1080, orientation: 'LANDSCAPE' as const,
  physicalSize: '55"', loopLengthSec: 120, defaultSlotLengthSec: 15, operatingStart: '07:00', operatingEnd: '23:00',
  timezone: 'Europe/Istanbul', venue: { id: 'v1', name: 'Vapur A', city: 'İstanbul', type: 'ferry' as const },
};

describe('Buyer catalog add-on', () => {
  it('selects only buyer-safe screen fields (no owner, notes, CMS, rates or revenue share)', () => {
    const keys = Object.keys(catalogScreenSelect);
    for (const internal of ['owner', 'notes', 'cmsName', 'cmsReference', 'floorCpm', 'directRate', 'revenueSharePct', 'multipliers', 'rates']) {
      expect(keys).not.toContain(internal);
    }
  });
  it('shows no price unless one is given, and never invents one', () => {
    expect(presentCatalogScreen(row, undefined).listPrice).toBeNull();
    const price = { screenId: 's1', dailyRate: new Prisma.Decimal('1250.5'), currency: 'TRY' as const, validFrom: new Date('2026-11-01T00:00:00Z') };
    expect(presentCatalogScreen(row, price).listPrice).toEqual({ dailyRate: '1250.5', currency: 'TRY', validFrom: '2026-11-01T00:00:00.000Z' });
  });
  it('takes the latest started version per screen', () => {
    const d = (iso: string) => new Date(iso);
    const prices = currentPrices([
      { screenId: 's1', dailyRate: new Prisma.Decimal('120'), currency: 'TRY', validFrom: d('2026-11-10T00:00:00Z') },
      { screenId: 's1', dailyRate: new Prisma.Decimal('100'), currency: 'TRY', validFrom: d('2026-11-01T00:00:00Z') },
    ]);
    expect(prices.get('s1')!.dailyRate.toString()).toBe('120');
  });
});
