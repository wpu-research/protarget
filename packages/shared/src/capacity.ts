/** Ek özellik "kapasite" yanıt tipleri. Bilinmeyen değer null; sahte değer üretilmez. */
export const CAPACITY_MAX_DAYS = 31;
export const CAPACITY_COUNTED_STATUSES = ['READY', 'LIVE', 'PAUSED'] as const;

export interface CapacityContributorView { kind: 'BOOKING' | 'HOLD'; id: string; label: string; slots: number; inOverbooking: boolean }
export interface CapacityScreenRow {
  screenId: string; screenCode: string; screenName: string; venueName: string;
  loopLengthSec: number | null; defaultSlotLengthSec: number | null;
  slotsPerLoop: number | null; peakSlots: number; peakOccupancyPct: number | null;
  overbooked: boolean | null; overbookedFrom: string | null;
  days: { date: string; peakSlots: number }[];
  contributors: CapacityContributorView[];
}
export interface CapacityReport {
  from: string; days: number; generatedAt: string;
  items: CapacityScreenRow[]; total: number; page: number; pageSize: number;
}
export interface ScreenHoldView {
  id: string; screenId: string; screenCode: string; label: string;
  startAt: string; endAt: string; slots: number; expiresAt: string; note: string | null;
  createdBy: { id: string; name: string }; createdAt: string;
  releasedAt: string | null; releaseReason: string | null;
  /** ACTIVE: serbest bırakılmamış ve süresi dolmamış. */
  state: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
}
