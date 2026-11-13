import { Prisma } from '@prisma/client';
import { buildDeliveryReport, deliveryPct, elapsedPct, multiplierAt } from '../src/modules/reporting/delivery-report';
import { portalCampaignWhere } from '../src/modules/reporting/reporting.service';

const d = (iso: string) => new Date(iso);
const dec = (value: string) => new Prisma.Decimal(value);
const base = {
  screens: [{ id: 's1', code: 'SCR-1', name: 'Ön', venue: 'Vapur' }, { id: 's2', code: 'SCR-2', name: 'Arka', venue: 'Vapur' }],
  multipliers: [
    { screenId: 's1', value: dec('2.5'), validFrom: d('2026-11-01T00:00:00Z'), validTo: d('2026-11-10T00:00:00Z') },
    { screenId: 's1', value: dec('3'), validFrom: d('2026-11-10T00:00:00Z'), validTo: null },
  ],
  startAt: d('2026-11-01T00:00:00Z'), endAt: d('2026-11-21T00:00:00Z'), now: d('2026-11-11T00:00:00Z'),
};

describe('Delivery reporting add-on', () => {
  it('picks the approved multiplier valid at the play time', () => {
    expect(multiplierAt(base.multipliers, d('2026-11-09T23:59:59Z'))!.toString()).toBe('2.5');
    expect(multiplierAt(base.multipliers, d('2026-11-10T00:00:00Z'))!.toString()).toBe('3');
    expect(multiplierAt(base.multipliers, d('2026-10-01T00:00:00Z'))).toBeUndefined();
  });
  it('reports each source separately and never sums them', () => {
    const report = buildDeliveryReport({ ...base, goal: { primaryGoal: 'PLAYOUTS', targetPlayouts: 100n, targetImpressions: null },
      records: [
        { source: 'CMS_VERIFIED', screenId: 's1', playedAt: d('2026-11-09T10:00:00Z'), count: 4, impressions: null },
        { source: 'CMS_VERIFIED', screenId: 's1', playedAt: d('2026-11-10T10:00:00Z'), count: 6, impressions: null },
        { source: 'OPERATOR_DECLARED', screenId: 's1', playedAt: d('2026-11-10T10:00:00Z'), count: 6, impressions: null },
        { source: 'DECLARED_IMPRESSION', screenId: 's2', playedAt: d('2026-11-10T11:00:00Z'), count: null, impressions: dec('40.25') },
      ] });
    const [verified, declared, impressions] = report.sources;
    expect(verified).toMatchObject({ source: 'CMS_VERIFIED', playouts: 10, estimatedImpressions: '28', uncoveredPlayouts: 0, deliveryPct: 10 });
    expect(declared).toMatchObject({ source: 'OPERATOR_DECLARED', playouts: 6, estimatedImpressions: '18', deliveryPct: 6 });
    expect(impressions).toMatchObject({ source: 'DECLARED_IMPRESSION', playouts: null, declaredImpressions: '40.25', estimatedImpressions: null, deliveryPct: null });
    expect(report.elapsedPct).toBe(50);
    expect(verified.pacing).toBe(0.2);
    expect(report.byScreen.map(r => r.label)).toEqual(['SCR-1', 'SCR-2']);
    expect(report.byDay.map(r => r.key)).toEqual(['2026-11-09', '2026-11-10']);
    expect(report.byDay[1].figures.CMS_VERIFIED.playouts).toBe(6);
  });
  it('marks estimates partial when a playout has no valid multiplier and then gives no impression delivery %', () => {
    const report = buildDeliveryReport({ ...base, goal: { primaryGoal: 'IMPRESSIONS', targetPlayouts: null, targetImpressions: 1000n },
      records: [
        { source: 'CMS_VERIFIED', screenId: 's2', playedAt: d('2026-11-10T10:00:00Z'), count: 5, impressions: null },
        { source: 'DECLARED_IMPRESSION', screenId: 's2', playedAt: d('2026-11-10T11:00:00Z'), count: null, impressions: dec('250') },
      ] });
    expect(report.sources[0]).toMatchObject({ playouts: 5, estimatedImpressions: '0', uncoveredPlayouts: 5, deliveryPct: null, pacing: null });
    expect(report.sources[2]).toMatchObject({ declaredImpressions: '250', deliveryPct: 25, pacing: 0.5 });
  });
  it('returns null delivery % without a goal or target instead of 0', () => {
    const empty = { playouts: 0, declaredImpressions: null, estimatedImpressions: '0', uncoveredPlayouts: 0 };
    expect(deliveryPct('CMS_VERIFIED', empty, { primaryGoal: null, targetPlayouts: 10n, targetImpressions: null })).toBeNull();
    expect(deliveryPct('CMS_VERIFIED', empty, { primaryGoal: 'PLAYOUTS', targetPlayouts: null, targetImpressions: null })).toBeNull();
    expect(deliveryPct('CMS_VERIFIED', empty, { primaryGoal: 'PLAYOUTS', targetPlayouts: 0n, targetImpressions: null })).toBeNull();
  });
  it('bounds flight progress between 0 and 100', () => {
    expect(elapsedPct(base.startAt, base.endAt, d('2026-10-01T00:00:00Z'))).toBe(0);
    expect(elapsedPct(base.startAt, base.endAt, d('2026-12-01T00:00:00Z'))).toBe(100);
  });
  it('scopes portal reports to the viewer organisation and hides drafts', () => {
    const where = portalCampaignWhere({ user: { id: 'u1', orgId: 'o1' } } as never);
    expect(where).toMatchObject({ deletedAt: null, status: { notIn: ['DRAFT', 'READY_FOR_REVIEW'] } });
    expect(where.OR).toEqual([{ advertiserId: 'o1' }, { agencyId: 'o1' },
      { permissions: { some: { OR: [{ orgId: 'o1' }, { userId: 'u1' }] } } }]);
  });
});
