import { canTransition, CAMPAIGN_TRANSITIONS, CampaignStatus } from '@protarget/shared';
import { redactSecrets, MockConnector, ManualConnector } from '@protarget/connectors';

describe('campaign state machine', () => {
  it('allows the launch → pause → resume path', () => {
    expect(canTransition('READY', 'LIVE')).toBe(true);
    expect(canTransition('LIVE', 'PAUSING')).toBe(true);
    expect(canTransition('PAUSING', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSING', 'PAUSED_WITH_EXTERNAL_ERROR')).toBe(true);
    expect(canTransition('PAUSED', 'RESUMING')).toBe(true);
    expect(canTransition('RESUMING', 'LIVE')).toBe(true);
  });

  it('rejects skipping validation or reviving a cancelled campaign', () => {
    expect(canTransition('DRAFT', 'LIVE')).toBe(false);
    expect(canTransition('LIVE', 'PAUSED')).toBe(false);
    expect(canTransition('CANCELLED', 'LIVE')).toBe(false);
  });

  it('defines transitions for every status', () => {
    for (const status of Object.values(CampaignStatus)) {
      expect(CAMPAIGN_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('connectors', () => {
  it('redacts secret-looking fields before logging', () => {
    expect(redactSecrets({ dealId: 'x', auth: { accessToken: 'abc', apiKey: 'k' }, list: [{ password: 'p' }] })).toEqual({
      dealId: 'x',
      auth: { accessToken: '[REDACTED]', apiKey: '[REDACTED]' },
      list: [{ password: '[REDACTED]' }],
    });
  });

  it('manual connector stores the admin-entered external Deal ID', async () => {
    const result = await new ManualConnector().createDeal({
      internalDealId: 'PTR-2026-00001', dealType: 'PG', currency: 'USD',
      startAt: new Date(), endAt: new Date(), externalInventoryIds: [], manualExternalDealId: 'ABC123',
    });
    expect(result.externalDealId).toBe('ABC123');
  });

  it('mock connector moves a sent deal to accepted on sync', async () => {
    const mock = new MockConnector();
    const created = await mock.createDeal({
      internalDealId: 'PTR-2026-00002', dealType: 'PG', currency: 'USD',
      startAt: new Date(), endAt: new Date(), externalInventoryIds: [],
    });
    expect(created.status).toBe('SENT');
    expect((await mock.getDeal(created.externalDealId)).status).toBe('ACCEPTED');
  });

  it('mock connector can simulate a partner outage', async () => {
    await expect(new MockConnector({ failAll: true }).getDeal('x')).rejects.toThrow('simulated partner outage');
  });
});
