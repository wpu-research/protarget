import { Prisma } from '@prisma/client';
import type { ProposalLine, SalesCurrency } from '@protarget/shared';

export interface RateRow { screenId: string; dailyRate: Prisma.Decimal; currency: SalesCurrency; validFrom: Date }
export interface ProposalScreen { id: string; code: string; name: string; venue: string }
const DAY = 86_400_000;

/** Latest rate version that started at or before `at` (later versions supersede earlier ones). */
export function rateAt(rows: RateRow[], screenId: string, at: Date): RateRow | undefined {
  let best: RateRow | undefined;
  for (const row of rows) {
    if (row.screenId !== screenId || row.validFrom > at) continue;
    if (!best || row.validFrom > best.validFrom) best = row;
  }
  return best;
}

/** Flight length in days with 4 decimals (exact, from UTC instants). */
export function flightDays(startAt: Date, endAt: Date): Prisma.Decimal {
  return new Prisma.Decimal(endAt.getTime() - startAt.getTime()).div(DAY).toDecimalPlaces(4);
}

/** List amount per screen = daily list rate × flight days; no rate → null (never 0). Totals per currency. */
export function buildProposal(screens: ProposalScreen[], rates: RateRow[], startAt: Date, endAt: Date) {
  const days = flightDays(startAt, endAt);
  const totals = new Map<SalesCurrency, Prisma.Decimal>();
  let missingRates = 0;
  const lines: ProposalLine[] = screens.map(screen => {
    const rate = rateAt(rates, screen.id, startAt);
    if (!rate) { missingRates++; return { screenId: screen.id, screenCode: screen.code, screenName: screen.name, venueName: screen.venue,
      dailyRate: null, currency: null, listAmount: null }; }
    const amount = rate.dailyRate.mul(days).toDecimalPlaces(2);
    totals.set(rate.currency, (totals.get(rate.currency) ?? new Prisma.Decimal(0)).add(amount));
    return { screenId: screen.id, screenCode: screen.code, screenName: screen.name, venueName: screen.venue,
      dailyRate: rate.dailyRate.toFixed(), currency: rate.currency, listAmount: amount.toFixed(2) };
  });
  return {
    days: days.toFixed(4), lines, missingRates,
    totals: [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({ currency, listAmount: value.toFixed(2) })),
  };
}
