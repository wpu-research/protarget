import type {
  CampaignIssue, CampaignValidation, ScheduleSlot, ValidationBlocker, ValidationWarning,
} from '@protarget/shared';

const WEEK = 7 * 24 * 60;
const HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
export function minutes(hhmm: string): number {
  const match = HHMM.exec(hhmm);
  if (!match) throw new Error(`Invalid HH:mm ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minute-of-week intervals [start, end) for a daypart; overnight parts spill into the next day (Sunday → Monday). */
export function slotSegments(slot: ScheduleSlot): [number, number][] {
  const base = (slot.dayOfWeek - 1) * 1440;
  const start = minutes(slot.startTime);
  const end = minutes(slot.endTime);
  if (end > start) return [[base + start, base + end]];
  const segments: [number, number][] = [[base + start, base + 1440]];
  const nextBase = (base + 1440) % WEEK;
  if (end > 0) segments.push([nextBase, nextBase + end]);
  return segments;
}

/** Returns the index of a slot that overlaps an earlier one, or -1. */
export function findScheduleOverlap(slots: ScheduleSlot[]): number {
  const used = new Uint8Array(WEEK);
  for (let index = 0; index < slots.length; index++) {
    for (const [from, to] of slotSegments(slots[index])) {
      for (let minute = from; minute < to; minute++) {
        if (used[minute]) return index;
        used[minute] = 1;
      }
    }
  }
  return -1;
}

/** Canonical IANA name (aliases and case differences resolve to one spelling); unknown names stay as given. */
export function canonicalTimezone(name: string): string {
  try { return new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone; } catch { return name; }
}
export const sameTimezone = (a: string, b: string) => a === b || canonicalTimezone(a) === canonicalTimezone(b);

/** Minute-of-week mask of the campaign dayparts. */
export function scheduleMask(slots: ScheduleSlot[]): Uint8Array {
  const mask = new Uint8Array(WEEK);
  for (const slot of slots) for (const [from, to] of slotSegments(slot)) mask.fill(1, from, to);
  return mask;
}
function operatingMask(start: string, end: string): Uint8Array {
  const open = new Uint8Array(WEEK);
  for (let day = 1; day <= 7; day++) {
    for (const [from, to] of slotSegments({ dayOfWeek: day, startTime: start, endTime: end })) open.fill(1, from, to);
  }
  return open;
}

/** Minute-of-week (Monday 00:00 = 0) mask of the minutes inside [startAt, endAt) in `timezone`, or null when the
 * flight spans a full week or more (every minute of the week occurs). The UTC offset is resolved once per UTC hour.
 */
export function flightMask(startAt: Date, endAt: Date, timezone: string): Uint8Array | null {
  const first = Math.floor(startAt.getTime() / 60_000);
  const last = Math.ceil(endAt.getTime() / 60_000);
  if (!(last > first) || last - first >= WEEK) return null;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric' });
  } catch { return null; }
  const offsets = new Map<number, number>();
  const offsetMinutes = (hour: number) => {
    let known = offsets.get(hour);
    if (known === undefined) {
      const instant = hour * 3_600_000;
      const parts: Record<string, number> = {};
      for (const part of format.formatToParts(new Date(instant))) if (part.type !== 'literal') parts[part.type] = Number(part.value);
      const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      known = Math.round((local - instant) / 60_000);
      offsets.set(hour, known);
    }
    return known;
  };
  const mask = new Uint8Array(WEEK);
  for (let minute = first; minute < last; minute++) {
    const local = minute + offsetMinutes(Math.floor(minute / 60));
    const day = Math.floor(local / 1440);
    const weekday = (((day + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday; 0 = Monday
    mask[weekday * 1440 + (((local % 1440) + 1440) % 1440)] = 1;
  }
  return mask;
}

function overlapMinutes(a: Uint8Array, b: Uint8Array | null, c: Uint8Array | null = null): number {
  let total = 0;
  for (let minute = 0; minute < WEEK; minute++) if (a[minute] && (!b || b[minute]) && (!c || c[minute])) total++;
  return total;
}

/** Weekly overlap hours between the campaign dayparts and daily operating hours, or null when not computable.
 * Different timezones would require DST-aware conversion; we report null instead of guessing.
 */
export function weeklyWindowHours(slots: ScheduleSlot[], campaignTz: string,
  screen: { operatingStart: string | null; operatingEnd: string | null; timezone: string }): number | null {
  if (!screen.operatingStart || !screen.operatingEnd || !HHMM.test(screen.operatingStart) || !HHMM.test(screen.operatingEnd)) return null;
  if (!sameTimezone(screen.timezone, campaignTz)) return null;
  return overlapMinutes(scheduleMask(slots), operatingMask(screen.operatingStart, screen.operatingEnd)) / 60;
}

export interface CommercialState {
  pricingModel: 'CPM' | 'CPP' | 'FIXED' | 'PG' | null;
  unitPrice: unknown; contractedAmount: unknown; guaranteedImpressions: unknown; contractedQuantity: unknown;
}
/** Conditional requirements from BUILD_PROMPT §11.7 step 3. Empty model is a warning, not a blocker. */
export function commercialComplete(state: CommercialState): boolean {
  switch (state.pricingModel) {
    case null: return true;
    case 'CPM': case 'CPP': return state.unitPrice != null;
    case 'FIXED': return state.contractedAmount != null;
    case 'PG': return state.unitPrice != null && (state.guaranteedImpressions != null || state.contractedQuantity != null);
  }
}

export interface ValidationScreen {
  code: string; active: boolean; deleted: boolean; venueActive: boolean; timezone: string;
  operatingStart: string | null; operatingEnd: string | null;
  defaultSlotLengthSec: number | null; resolutionWidth: number | null; resolutionHeight: number | null;
  hasMultiplier: boolean; cmsUploaded: boolean;
}
export interface ValidationCreative {
  status: string; durationSeconds: number | null; width: number | null; height: number | null;
}
export interface ValidationInput {
  status: string; startAt: Date; endAt: Date; timezone: string;
  primaryGoal: 'PLAYOUTS' | 'IMPRESSIONS' | null; targetPlayouts: bigint | null; targetImpressions: bigint | null;
  commercial: CommercialState;
  screens: ValidationScreen[]; creatives: ValidationCreative[]; schedule: ScheduleSlot[];
}

export function validateBooking(input: ValidationInput, now = new Date()): CampaignValidation {
  const blockers: CampaignIssue<ValidationBlocker>[] = [];
  const warnings: CampaignIssue<ValidationWarning>[] = [];
  const block = (code: ValidationBlocker, screens: string[] = []) => blockers.push({ code, screens });
  const warn = (code: ValidationWarning, screens: string[] = []) => warnings.push({ code, screens });
  const codes = (filter: (screen: ValidationScreen) => boolean) => input.screens.filter(filter).map(screen => screen.code);
  const running = input.status === 'LIVE' || input.status === 'PAUSED';

  if (input.screens.length === 0) block('NO_SCREENS');
  const inactive = codes(screen => !screen.active || screen.deleted || !screen.venueActive);
  if (inactive.length) block('INACTIVE_SCREENS', inactive);

  const approved = input.creatives.filter(creative => creative.status === 'APPROVED');
  if (approved.length === 0) block('NO_APPROVED_CREATIVE');
  if (input.creatives.some(creative => creative.status !== 'APPROVED' && creative.status !== 'REVOKED')) warn('UNAPPROVED_CREATIVES');
  if (input.creatives.some(creative => creative.status === 'REVOKED')) warn('REVOKED_CREATIVE');
  if (approved.some(creative => creative.durationSeconds == null)) warn('CREATIVE_DURATION_UNKNOWN');

  if (input.endAt <= input.startAt) block('INVALID_FLIGHT');
  else if (input.endAt <= now) {
    if (running) warn('FLIGHT_ENDED'); else block('INVALID_FLIGHT');
  } else if (input.status === 'READY' && now < input.startAt) warn('FLIGHT_NOT_STARTED');

  const target = input.primaryGoal === 'PLAYOUTS' ? input.targetPlayouts : input.primaryGoal === 'IMPRESSIONS' ? input.targetImpressions : null;
  if (!input.primaryGoal || target == null || target <= 0n) block('NO_GOAL');
  if (input.primaryGoal === 'IMPRESSIONS') {
    const missing = codes(screen => !screen.hasMultiplier);
    if (missing.length) block('MISSING_MULTIPLIER', missing);
  }

  if (input.schedule.length === 0) block('NO_SCHEDULE');
  else {
    const schedule = scheduleMask(input.schedule);
    const flight = flightMask(input.startAt, input.endAt, input.timezone);
    // No dayparts inside the flight at all: nothing can play on any screen, whatever its hours.
    const flightEmpty = overlapMinutes(schedule, flight) === 0;
    const noWindow: string[] = []; const unknown: string[] = []; const tz: string[] = [];
    for (const screen of input.screens) {
      if (!screen.operatingStart || !screen.operatingEnd) unknown.push(screen.code);
      else if (!sameTimezone(screen.timezone, input.timezone)) tz.push(screen.code);
      else if (overlapMinutes(schedule, flight, operatingMask(screen.operatingStart, screen.operatingEnd)) === 0) noWindow.push(screen.code);
    }
    if (flightEmpty) block('NO_PLAYBACK_WINDOW', input.screens.map(screen => screen.code));
    else if (noWindow.length) block('NO_PLAYBACK_WINDOW', noWindow);
    if (unknown.length) warn('OPERATING_HOURS_UNKNOWN', unknown);
    if (tz.length) warn('TIMEZONE_MISMATCH', tz);
  }

  const longest = Math.max(0, ...approved.map(creative => creative.durationSeconds ?? 0));
  const tooLong = codes(screen => screen.defaultSlotLengthSec != null && longest > screen.defaultSlotLengthSec);
  if (tooLong.length) block('CREATIVE_TOO_LONG', tooLong);
  const slotUnknown = codes(screen => screen.defaultSlotLengthSec == null);
  if (slotUnknown.length) warn('SLOT_LENGTH_UNKNOWN', slotUnknown);
  const sized = approved.filter(creative => creative.width != null && creative.height != null);
  if (sized.length) {
    const mismatch = codes(screen => screen.resolutionWidth != null && screen.resolutionHeight != null &&
      !sized.some(creative => creative.width === screen.resolutionWidth && creative.height === screen.resolutionHeight));
    if (mismatch.length) warn('RESOLUTION_MISMATCH', mismatch);
  }

  if (input.commercial.pricingModel === null) warn('NO_COMMERCIAL_TERMS');
  else if (!commercialComplete(input.commercial)) block('INVALID_COMMERCIAL');

  return { blockers, warnings, missingCmsUpload: codes(screen => !screen.cmsUploaded), checkedAt: now.toISOString() };
}
