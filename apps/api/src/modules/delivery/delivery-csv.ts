import { createHash } from 'node:crypto';
import { DELIVERY_CSV_COLUMNS, DELIVERY_MAX_ROWS, type DeliverySource } from '@protarget/shared';

/** One parsed CSV line before database lookups. */
export interface ParsedDeliveryRow {
  line: number;
  campaignCode: string; screenCode: string; creativeCode: string | null;
  playedAt: Date; count: number;
  /** Decimal string; only for DECLARED_IMPRESSION. */
  impressions: string | null;
  durationSeconds: string | null;
  externalId: string | null;
}
export interface DeliveryRowError { line: number; code: string; column?: string }

const UTC = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;
const COUNT = /^[1-9]\d{0,5}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
const DURATION = /^(?:0|[1-9]\d{0,4})(?:\.\d{1,3})?$/;
const CODE = /^[^\s,;"]{1,64}$/;

/** RFC 4180 subset: comma separated, optional double quotes, "" escapes, CRLF or LF. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, index = 0;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  while (index < source.length) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false; index++; continue;
      }
      field += char; index++; continue;
    }
    if (char === '"' && field === '') { quoted = true; index++; continue; }
    if (char === ',') { row.push(field); field = ''; index++; continue; }
    if (char === '\r' || char === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      index += char === '\r' && source[index + 1] === '\n' ? 2 : 1; continue;
    }
    field += char; index++;
  }
  if (quoted) throw new Error('UNTERMINATED_QUOTE');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

/**
 * Parses the generic delivery CSV. Header is required (column order free, unknown columns rejected).
 * Never invents values: optional columns stay null when empty.
 */
export function parseDeliveryCsv(text: string, source: DeliverySource, now: Date):
  { rows: ParsedDeliveryRow[]; errors: DeliveryRowError[]; lineCount: number } {
  let table: string[][];
  try { table = splitCsv(text); } catch { return { rows: [], errors: [{ line: 0, code: 'MALFORMED_CSV' }], lineCount: 0 }; }
  if (!table.length) return { rows: [], errors: [{ line: 0, code: 'EMPTY_FILE' }], lineCount: 0 };
  const lineCount = table.length - 1;
  const header = table[0].map(cell => cell.trim().toLowerCase());
  const errors: DeliveryRowError[] = [];
  for (const column of header) if (!(DELIVERY_CSV_COLUMNS as readonly string[]).includes(column)) errors.push({ line: 1, code: 'UNKNOWN_COLUMN', column });
  if (new Set(header).size !== header.length) errors.push({ line: 1, code: 'DUPLICATE_COLUMN' });
  for (const column of ['campaign_code', 'screen_code', 'played_at']) if (!header.includes(column)) errors.push({ line: 1, code: 'MISSING_COLUMN', column });
  if (source === 'DECLARED_IMPRESSION' && !header.includes('impressions')) errors.push({ line: 1, code: 'MISSING_COLUMN', column: 'impressions' });
  if (errors.length) return { rows: [], errors, lineCount };
  if (!lineCount) return { rows: [], errors: [{ line: 0, code: 'EMPTY_FILE' }], lineCount };
  if (lineCount > DELIVERY_MAX_ROWS) return { rows: [], errors: [{ line: 0, code: 'TOO_MANY_ROWS' }], lineCount };
  const at = (cells: string[], column: string) => { const index = header.indexOf(column); return index < 0 ? '' : (cells[index] ?? '').trim(); };
  const rows: ParsedDeliveryRow[] = [];
  table.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    const fail = (code: string, column?: string) => { errors.push({ line, code, ...(column ? { column } : {}) }); };
    if (cells.length !== header.length) return fail('COLUMN_COUNT');
    const campaignCode = at(cells, 'campaign_code'), screenCode = at(cells, 'screen_code');
    const creative = at(cells, 'creative_code'), played = at(cells, 'played_at');
    const count = at(cells, 'count'), impressions = at(cells, 'impressions');
    const duration = at(cells, 'duration_seconds'), external = at(cells, 'external_id');
    const before = errors.length;
    if (!CODE.test(campaignCode)) fail('INVALID_VALUE', 'campaign_code');
    if (!CODE.test(screenCode)) fail('INVALID_VALUE', 'screen_code');
    if (creative && !CODE.test(creative)) fail('INVALID_VALUE', 'creative_code');
    const playedAt = new Date(played);
    if (!UTC.test(played) || Number.isNaN(playedAt.getTime())) fail('INVALID_VALUE', 'played_at');
    else if (playedAt.getTime() > now.getTime()) fail('FUTURE_TIMESTAMP', 'played_at');
    // A declared impression is not a playout; its count would be fabricated.
    if (count && source === 'DECLARED_IMPRESSION') fail('COUNT_NOT_ALLOWED', 'count');
    else if (count && !COUNT.test(count)) fail('INVALID_VALUE', 'count');
    if (source === 'DECLARED_IMPRESSION') {
      if (!impressions || !DECIMAL.test(impressions) || Number(impressions) <= 0) fail('INVALID_VALUE', 'impressions');
    } else if (impressions) fail('IMPRESSIONS_NOT_ALLOWED', 'impressions');
    if (duration && !DURATION.test(duration)) fail('INVALID_VALUE', 'duration_seconds');
    if (external && external.length > 128) fail('INVALID_VALUE', 'external_id');
    if (errors.length !== before) return;
    rows.push({ line, campaignCode, screenCode, creativeCode: creative || null, playedAt,
      count: count ? Number(count) : 1, impressions: source === 'DECLARED_IMPRESSION' ? impressions : null,
      durationSeconds: duration || null, externalId: external || null });
  });
  return { rows, errors, lineCount };
}

/**
 * De-duplication key. The same source + campaign + screen + creative + second + external id is one delivery,
 * whichever file it arrives in. Different sources are never merged: they are reported side by side, not summed.
 */
export function deliveryKey(source: DeliverySource, ids: { campaignId: string; screenId: string; creativeId: string | null },
  playedAt: Date, externalId: string | null): string {
  const second = Math.floor(playedAt.getTime() / 1000);
  return createHash('sha256').update([source, ids.campaignId, ids.screenId, ids.creativeId ?? '', second, externalId ?? ''].join('|')).digest('hex');
}
