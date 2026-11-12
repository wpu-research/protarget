import { presentDeclarations } from '../src/modules/fleet/fleet.presenter';

type Row = Parameters<typeof presentDeclarations>[1][number];
const row = (code: string, status: string, over: Partial<Row> = {}, creatives: string[] = []): Row => ({
  active: true,
  campaign: { id: `id-${code}`, code, name: `Campaign ${code}`, status, deletedAt: null,
    creatives: creatives.map(s => ({ creative: { status: s } })) },
  ...over,
} as unknown as Row);

describe('Fleet declarations', () => {
  const screenId = 'screen-1';
  it('keeps only READY/LIVE/PAUSED bookings that still contain the screen and are not deleted', () => {
    const rows = [
      row('CMP-2026-0001', 'LIVE'), row('CMP-2026-0002', 'DRAFT'), row('CMP-2026-0003', 'COMPLETED'),
      row('CMP-2026-0004', 'CANCELLED'), row('CMP-2026-0005', 'PAUSED'), row('CMP-2026-0006', 'READY'),
      row('CMP-2026-0007', 'LIVE', { active: false }),
      { ...row('CMP-2026-0008', 'LIVE'), campaign: { ...row('x', 'LIVE').campaign, id: 'del', code: 'CMP-2026-0008', deletedAt: new Date() } } as Row,
    ];
    expect(presentDeclarations(screenId, rows, []).map(d => d.code))
      .toEqual(['CMP-2026-0001', 'CMP-2026-0005', 'CMP-2026-0006']);
  });
  it('counts creative statuses and picks the latest CMS operation for this screen only', () => {
    const rows = [row('CMP-2026-0001', 'LIVE', {}, ['APPROVED', 'APPROVED', 'VALIDATING'])];
    const result = presentDeclarations(screenId, rows, [
      { campaignId: 'id-CMP-2026-0001', screenId, type: 'CMS_UPLOADED', performedAt: new Date('2026-11-10T08:00:00Z') },
      { campaignId: 'id-CMP-2026-0001', screenId, type: 'PLAYBACK_STARTED', performedAt: new Date('2026-11-11T09:30:00Z') },
      { campaignId: 'id-CMP-2026-0001', screenId: 'other', type: 'PLAYBACK_STOPPED', performedAt: new Date('2026-11-12T00:00:00Z') },
    ]);
    expect(result[0].creativeStatusCounts).toEqual({ APPROVED: 2, VALIDATING: 1 });
    expect(result[0].lastCmsOperation).toEqual({ type: 'PLAYBACK_STARTED', performedAt: '2026-11-11T09:30:00.000Z' });
  });
  it('returns null (unknown) rather than inventing an operation, and an empty list when nothing is declared', () => {
    expect(presentDeclarations(screenId, [row('CMP-2026-0001', 'READY')], [])[0].lastCmsOperation).toBeNull();
    expect(presentDeclarations(screenId, [], [])).toEqual([]);
  });
});
