import { Prisma } from '@prisma/client';
import {
  DELIVERY_SOURCES, type DeliveryBreakdownRow, type DeliverySource, type SourceFigures, type SourceSummary,
} from '@protarget/shared';

export interface ReportRecord {
  source: DeliverySource; screenId: string; playedAt: Date; count: number | null; impressions: Prisma.Decimal | null;
}
export interface ReportMultiplier { screenId: string; value: Prisma.Decimal; validFrom: Date; validTo: Date | null }
export interface ReportScreen { id: string; code: string; name: string; venue: string }

const PLAYOUT_SOURCES: readonly DeliverySource[] = ['CMS_VERIFIED', 'OPERATOR_DECLARED'];
const zero = () => new Prisma.Decimal(0);
const decimalString = (value: Prisma.Decimal) => value.toDecimalPlaces(4).toFixed();

/** Approved whole-screen multiplier valid at `at` (validFrom ≤ at < validTo), or undefined. */
export function multiplierAt(profiles: ReportMultiplier[], at: Date): Prisma.Decimal | undefined {
  return profiles.find(p => p.validFrom <= at && (!p.validTo || at < p.validTo))?.value;
}

/** `rows`: records seen; `invalid`: records missing their figure (DB CHECKs forbid it; defensive). */
interface Accumulator { rows: number; invalid: number; playouts: number; declared: Prisma.Decimal; estimated: Prisma.Decimal; uncovered: number }
const emptyAcc = (): Accumulator => ({ rows: 0, invalid: 0, playouts: 0, declared: zero(), estimated: zero(), uncovered: 0 });
const UNKNOWN: SourceFigures = { playouts: null, declaredImpressions: null, estimatedImpressions: null, uncoveredPlayouts: null };

/** No records, or any record without its figure → unknown (null), never 0. */
function figures(source: DeliverySource, acc: Accumulator): SourceFigures {
  if (!acc.rows || acc.invalid) return UNKNOWN;
  if (!PLAYOUT_SOURCES.includes(source)) {
    return { playouts: null, declaredImpressions: decimalString(acc.declared), estimatedImpressions: null, uncoveredPlayouts: null };
  }
  return { playouts: acc.playouts, declaredImpressions: null, estimatedImpressions: decimalString(acc.estimated), uncoveredPlayouts: acc.uncovered };
}

const round1 = (value: number) => Math.round(value * 10) / 10;
/** Unrounded share (0–1) of the flight elapsed at `now`. */
function elapsedRatio(startAt: Date, endAt: Date, now: Date): number {
  const span = endAt.getTime() - startAt.getTime();
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - startAt.getTime()) / span));
}
/** Share of the flight already elapsed at `now`, in percent (0–100, one decimal). */
export function elapsedPct(startAt: Date, endAt: Date, now: Date): number {
  return round1(elapsedRatio(startAt, endAt, now) * 100);
}

/**
 * Delivery % against the campaign goal, per source, never across sources:
 * PLAYOUTS goal → playouts / target; IMPRESSIONS goal → estimated (only when fully covered) or declared / target.
 */
export function deliveryPct(source: DeliverySource, f: SourceFigures, goal: DeliveryGoal): number | null {
  const ratio = deliveryRatio(f, goal);
  return ratio === null ? null : round1(ratio * 100);
}
type DeliveryGoal = { primaryGoal: 'PLAYOUTS' | 'IMPRESSIONS' | null; targetPlayouts: bigint | null; targetImpressions: bigint | null };
/** Unrounded delivered / target, or null. */
function deliveryRatio(f: SourceFigures, goal: DeliveryGoal): number | null {
  if (goal.primaryGoal === 'PLAYOUTS') {
    if (!goal.targetPlayouts || f.playouts === null) return null;
    return f.playouts / Number(goal.targetPlayouts);
  }
  if (goal.primaryGoal === 'IMPRESSIONS') {
    if (!goal.targetImpressions) return null;
    const delivered = f.declaredImpressions ?? (f.uncoveredPlayouts === 0 ? f.estimatedImpressions : null);
    if (delivered === null) return null;
    return new Prisma.Decimal(delivered).div(goal.targetImpressions.toString()).toNumber();
  }
  return null;
}

export function buildDeliveryReport(input: {
  records: ReportRecord[]; multipliers: ReportMultiplier[]; screens: ReportScreen[];
  goal: { primaryGoal: 'PLAYOUTS' | 'IMPRESSIONS' | null; targetPlayouts: bigint | null; targetImpressions: bigint | null };
  startAt: Date; endAt: Date; now: Date;
}): { elapsedPct: number; sources: SourceSummary[]; byScreen: DeliveryBreakdownRow[]; byDay: DeliveryBreakdownRow[] } {
  const bySource = new Map<DeliverySource, Accumulator>(DELIVERY_SOURCES.map(s => [s, emptyAcc()]));
  const screenAcc = new Map<string, Map<DeliverySource, Accumulator>>();
  const dayAcc = new Map<string, Map<DeliverySource, Accumulator>>();
  const profiles = new Map<string, ReportMultiplier[]>();
  for (const profile of input.multipliers) (profiles.get(profile.screenId) ?? profiles.set(profile.screenId, []).get(profile.screenId)!).push(profile);
  const bucket = (map: Map<string, Map<DeliverySource, Accumulator>>, key: string, source: DeliverySource) => {
    let row = map.get(key);
    if (!row) { row = new Map(DELIVERY_SOURCES.map(s => [s, emptyAcc()])); map.set(key, row); }
    return row.get(source)!;
  };
  for (const record of input.records) {
    const targets = [bySource.get(record.source)!, bucket(screenAcc, record.screenId, record.source),
      bucket(dayAcc, record.playedAt.toISOString().slice(0, 10), record.source)];
    for (const acc of targets) acc.rows++;
    if (record.source === 'DECLARED_IMPRESSION') {
      if (record.impressions === null) { for (const acc of targets) acc.invalid++; continue; }
      for (const acc of targets) acc.declared = acc.declared.add(record.impressions);
      continue;
    }
    if (record.count === null) { for (const acc of targets) acc.invalid++; continue; }
    const multiplier = multiplierAt(profiles.get(record.screenId) ?? [], record.playedAt);
    const count = record.count;
    for (const acc of targets) {
      acc.playouts += count;
      if (multiplier) acc.estimated = acc.estimated.add(multiplier.mul(count)); else acc.uncovered += count;
    }
  }
  const elapsed = elapsedRatio(input.startAt, input.endAt, input.now);
  const sources = DELIVERY_SOURCES.map(source => {
    const f = figures(source, bySource.get(source)!);
    const ratio = deliveryRatio(f, input.goal);
    // Pacing from unrounded values; rounded once at the end.
    return { source, ...f, deliveryPct: ratio === null ? null : round1(ratio * 100),
      pacing: ratio === null || elapsed === 0 ? null : Math.round((ratio / elapsed) * 100) / 100 };
  });
  const rows = (map: Map<string, Map<DeliverySource, Accumulator>>, label: (key: string) => { label: string; detail: string | null }) =>
    [...map.entries()].map(([key, accs]) => ({ key, ...label(key),
      figures: Object.fromEntries(DELIVERY_SOURCES.map(s => [s, figures(s, accs.get(s)!)])) as Record<DeliverySource, SourceFigures> }));
  const screens = new Map(input.screens.map(s => [s.id, s]));
  const byScreen = rows(screenAcc, key => { const s = screens.get(key); return { label: s?.code ?? key, detail: s ? `${s.name} · ${s.venue}` : null }; })
    .sort((a, b) => a.label.localeCompare(b.label));
  const byDay = rows(dayAcc, key => ({ label: key, detail: null })).sort((a, b) => a.key.localeCompare(b.key));
  return { elapsedPct: round1(elapsed * 100), sources, byScreen, byDay };
}
