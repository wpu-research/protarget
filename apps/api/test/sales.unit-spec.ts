import { Prisma } from '@prisma/client';
import { buildProposal, flightDays, rateAt } from '../src/modules/sales/proposal';

const d = (iso: string) => new Date(iso);
const rate = (screenId: string, value: string, from: string, currency: 'TRY' | 'USD' = 'TRY') =>
  ({ screenId, dailyRate: new Prisma.Decimal(value), currency, validFrom: d(from) });
const screens = [
  { id: 's1', code: 'SCR-1', name: 'Ön', venue: 'Vapur A' }, { id: 's2', code: 'SCR-2', name: 'Arka', venue: 'Vapur A' },
  { id: 's3', code: 'SCR-3', name: 'Salon', venue: 'Vapur B' },
];

describe('Sales add-on', () => {
  it('uses the latest rate version that started by the price date', () => {
    const rows = [rate('s1', '100', '2026-11-01T00:00:00Z'), rate('s1', '120', '2026-11-15T00:00:00Z')];
    expect(rateAt(rows, 's1', d('2026-11-14T23:59:59Z'))!.dailyRate.toString()).toBe('100');
    expect(rateAt(rows, 's1', d('2026-11-15T00:00:00Z'))!.dailyRate.toString()).toBe('120');
    expect(rateAt(rows, 's1', d('2026-10-01T00:00:00Z'))).toBeUndefined();
  });
  it('measures the flight in exact (fractional) days', () => {
    expect(flightDays(d('2026-11-01T00:00:00Z'), d('2026-11-08T12:00:00Z')).toFixed(4)).toBe('7.5000');
  });
  it('prices each screen as daily rate × days, totals per currency and never invents a missing price', () => {
    const start = d('2026-11-20T00:00:00Z'), end = d('2026-11-30T00:00:00Z');
    const proposal = buildProposal(screens, [rate('s1', '150.5', '2026-11-01T00:00:00Z'), rate('s2', '20', '2026-11-01T00:00:00Z', 'USD')], start, end);
    expect(proposal.days).toBe('10.0000');
    expect(proposal.lines.map(l => [l.screenCode, l.listAmount, l.currency])).toEqual([
      ['SCR-1', '1505.00', 'TRY'], ['SCR-2', '200.00', 'USD'], ['SCR-3', null, null]]);
    expect(proposal.totals).toEqual([{ currency: 'TRY', listAmount: '1505.00' }, { currency: 'USD', listAmount: '200.00' }]);
    expect(proposal.missingRates).toBe(1);
  });
  it('computes amounts from exact milliseconds, not from the rounded day count', () => {
    const proposal = buildProposal([screens[0]], [rate('s1', '10000', '2026-11-01T00:00:00Z')], d('2026-11-20T00:00:00Z'), d('2026-11-30T08:00:00Z'));
    expect(proposal.days).toBe('10.3333');
    expect(proposal.lines[0].listAmount).toBe('103333.33');
  });
});
