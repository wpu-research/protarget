import { deliveryKey, parseDeliveryCsv, splitCsv } from '../src/modules/delivery/delivery-csv';
import { resolveDeliveryRows, sumDecimals, type DeliveryCampaignRef } from '../src/modules/delivery/delivery.service';

const now = new Date('2026-11-13T12:00:00Z');
const header = 'campaign_code,screen_code,played_at,count,creative_code,external_id';
const campaign = (over: Partial<DeliveryCampaignRef> = {}): DeliveryCampaignRef => ({
  id: 'c1', startAt: new Date('2026-11-01T00:00:00Z'), endAt: new Date('2026-12-01T00:00:00Z'), launchedAt: new Date('2026-11-01T00:00:00Z'),
  screens: new Map([['SCR-1', 's1']]), creatives: new Map([['CRV-1', 'k1']]), ...over,
});

describe('Delivery import add-on', () => {
  it('splits quoted CSV with escaped quotes, CRLF and a BOM', () => {
    expect(splitCsv('﻿a,"b,c","d""e"\r\n1,2,3\n\n')).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']]);
    expect(() => splitCsv('a,"b')).toThrow();
  });
  it('requires a known header and rejects unknown or missing columns', () => {
    expect(parseDeliveryCsv('campaign_code,screen_code\nA,B', 'CMS_VERIFIED', now).errors).toEqual([{ line: 1, code: 'MISSING_COLUMN', column: 'played_at' }]);
    expect(parseDeliveryCsv(`${header},foo\n`, 'CMS_VERIFIED', now).errors[0]).toMatchObject({ code: 'UNKNOWN_COLUMN', column: 'foo' });
    expect(parseDeliveryCsv(header, 'CMS_VERIFIED', now).errors[0].code).toBe('EMPTY_FILE');
    expect(parseDeliveryCsv(`${header}\nA,SCR-1,2026-11-10T10:00:00Z,,,`, 'DECLARED_IMPRESSION', now).errors[0])
      .toMatchObject({ code: 'MISSING_COLUMN', column: 'impressions' });
  });
  it('validates each line and keeps optional values null instead of inventing them', () => {
    const csv = [header,
      'CMP-2026-0001,SCR-1,2026-11-10T10:00:00Z,,,',
      'CMP-2026-0001,SCR-1,2026-11-10 10:00,3,,',
      'CMP-2026-0001,SCR-1,2026-11-14T10:00:00Z,1,,',
      'CMP-2026-0001,SCR-1,2026-11-10T10:00:00Z,0,,'].join('\n');
    const result = parseDeliveryCsv(csv, 'CMS_VERIFIED', now);
    expect(result.lineCount).toBe(4);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ line: 2, count: 1, creativeCode: null, externalId: null, impressions: null, durationSeconds: null });
    expect(result.errors).toEqual([
      { line: 3, code: 'INVALID_VALUE', column: 'played_at' },
      { line: 4, code: 'FUTURE_TIMESTAMP', column: 'played_at' },
      { line: 5, code: 'INVALID_VALUE', column: 'count' },
    ]);
  });
  it('keeps impressions to the declared-impression source and rejects a playout count there', () => {
    const csv = 'campaign_code,screen_code,played_at,impressions,count\nA,SCR-1,2026-11-10T10:00:00Z,12.5,\nA,SCR-1,2026-11-10T11:00:00Z,3,2';
    const declared = parseDeliveryCsv(csv, 'DECLARED_IMPRESSION', now);
    expect(declared.rows[0].impressions).toBe('12.5');
    expect(declared.errors).toEqual([{ line: 3, code: 'COUNT_NOT_ALLOWED', column: 'count' }]);
    expect(parseDeliveryCsv(csv, 'OPERATOR_DECLARED', now).errors.map(e => e.code)).toContain('IMPRESSIONS_NOT_ALLOWED');
  });
  it('checks lines against the booking and removes in-file and already imported duplicates', () => {
    const csv = [header,
      'CMP-1,SCR-1,2026-11-10T10:00:00Z,1,CRV-1,',
      'CMP-1,SCR-1,2026-11-10T10:00:00.400Z,1,CRV-1,',
      'CMP-1,SCR-2,2026-11-10T10:00:00Z,1,,',
      'CMP-1,SCR-1,2026-10-10T10:00:00Z,1,,',
      'CMP-1,SCR-1,2026-11-10T10:00:00Z,1,CRV-9,',
      'CMP-X,SCR-1,2026-11-10T10:00:00Z,1,,',
      'CMP-2,SCR-1,2026-11-10T10:00:00Z,1,,',
      'CMP-1,SCR-1,2026-11-11T10:00:00Z,1,,'].join('\n');
    const parsed = parseDeliveryCsv(csv, 'CMS_VERIFIED', now);
    const campaigns = new Map([['CMP-1', campaign()], ['CMP-2', campaign({ id: 'c2', launchedAt: null })]]);
    const existing = deliveryKey('CMS_VERIFIED', { campaignId: 'c1', screenId: 's1', creativeId: null }, new Date('2026-11-11T10:00:00Z'), null);
    const result = resolveDeliveryRows('CMS_VERIFIED', parsed.rows, campaigns, new Set([existing]));
    expect(result.accepted.map(r => r.line)).toEqual([2]);
    expect(result.duplicates).toBe(2);
    expect(result.errors.map(e => [e.line, e.code])).toEqual([
      [4, 'SCREEN_NOT_IN_CAMPAIGN'], [5, 'OUTSIDE_FLIGHT'], [6, 'CREATIVE_NOT_IN_CAMPAIGN'], [7, 'UNKNOWN_CAMPAIGN'], [8, 'CAMPAIGN_NOT_LAUNCHED'],
    ]);
  });
  it('never merges sources: the same playout from another source has another key', () => {
    const ids = { campaignId: 'c1', screenId: 's1', creativeId: null };
    const at = new Date('2026-11-10T10:00:00Z');
    expect(deliveryKey('CMS_VERIFIED', ids, at, null)).not.toBe(deliveryKey('OPERATOR_DECLARED', ids, at, null));
    expect(deliveryKey('CMS_VERIFIED', ids, at, 'x')).not.toBe(deliveryKey('CMS_VERIFIED', ids, at, null));
  });
  it('sums decimal impressions exactly', () => {
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimals(['12.5', '7.5000', '1'])).toBe('21');
    expect(sumDecimals([])).toBe('0');
  });
});
