import type { ScheduleSlot } from '@protarget/shared';
import { scheduleMask } from '../campaigns/booking-rules';


export { CAPACITY_MAX_DAYS } from '@protarget/shared';
const MINUTE = 60_000;
const DAY_MINUTES = 1440;

export interface CapacityBooking {
  campaignId: string; code: string; status: string;
  startAt: Date; endAt: Date; timezone: string;
  /** Campaign dayparts; empty = counted for every minute of the flight (conservative). */
  schedule: ScheduleSlot[];
}
export interface CapacityHold { id: string; label: string; startAt: Date; endAt: Date; slots: number }
export interface CapacityScreenInput { loopLengthSec: number | null; defaultSlotLengthSec: number | null }

export interface CapacityContributor { kind: 'BOOKING' | 'HOLD'; id: string; label: string; slots: number; inOverbooking: boolean }
export interface CapacityResult {
  /** null: loop or slot length unknown/invalid, so capacity cannot be computed. */
  slotsPerLoop: number | null;
  /** Highest number of slots claimed at the same minute by bookings and holds. */
  peakSlots: number;
  /** peakSlots / slotsPerLoop in percent (one decimal), or null when capacity is unknown. */
  peakOccupancyPct: number | null;
  /** null when capacity is unknown. */
  overbooked: boolean | null;
  /** First UTC minute at which claims exceed capacity. */
  overbookedFrom: string | null;
  days: { date: string; peakSlots: number }[];
  contributors: CapacityContributor[];
}

export function slotsPerLoop(screen: CapacityScreenInput): number | null {
  const loop = screen.loopLengthSec, slot = screen.defaultSlotLengthSec;
  if (!Number.isInteger(loop) || !Number.isInteger(slot) || !loop || !slot || loop <= 0 || slot <= 0 || slot > loop) return null;
  return Math.floor(loop / slot);
}

/** Minute-of-week (Monday 00:00 = 0) of a UTC minute in `timezone`; offset resolved once per UTC hour. */
export function weekMinuteResolver(timezone: string): ((utcMinute: number) => number) | null {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: 'numeric',
      day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  } catch { return null; }
  const offsets = new Map<number, number>();
  return (utcMinute: number) => {
    const hour = Math.floor(utcMinute / 60);
    let offset = offsets.get(hour);
    if (offset === undefined) {
      const instant = hour * 3_600_000;
      const parts: Record<string, number> = {};
      for (const part of format.formatToParts(new Date(instant))) if (part.type !== 'literal') parts[part.type] = Number(part.value);
      offset = Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant) / MINUTE);
      offsets.set(hour, offset);
    }
    const local = utcMinute + offset;
    const weekday = (((Math.floor(local / DAY_MINUTES) + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday
    return weekday * DAY_MINUTES + (((local % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES);
  };
}

/**
 * Occupancy of one screen over [from, from + days) at minute resolution. Each booking claims one slot per loop
 * while its flight and dayparts are active; a hold claims `slots`. Information only: never blocks a booking.
 */
export function screenCapacity(screen: CapacityScreenInput, from: Date, days: number,
  bookings: CapacityBooking[], holds: CapacityHold[]): CapacityResult {
  const start = Math.floor(from.getTime() / MINUTE);
  const length = days * DAY_MINUTES;
  const counts = new Int32Array(length);
  const claims: { contributor: CapacityContributor; minutes: Uint8Array }[] = [];
  const claim = (contributor: CapacityContributor, fromAt: Date, toAt: Date, active: (minute: number) => boolean) => {
    const first = Math.max(0, Math.floor(fromAt.getTime() / MINUTE) - start);
    const last = Math.min(length, Math.ceil(toAt.getTime() / MINUTE) - start);
    if (last <= first) return;
    const minutes = new Uint8Array(length);
    let any = false;
    for (let index = first; index < last; index++) {
      if (!active(start + index)) continue;
      minutes[index] = 1; counts[index] += contributor.slots; any = true;
    }
    if (any) claims.push({ contributor, minutes });
  };
  for (const booking of bookings) {
    const contributor: CapacityContributor = { kind: 'BOOKING', id: booking.campaignId, label: booking.code, slots: 1, inOverbooking: false };
    if (!booking.schedule.length) { claim(contributor, booking.startAt, booking.endAt, () => true); continue; }
    const mask = scheduleMask(booking.schedule);
    const resolve = weekMinuteResolver(booking.timezone);
    // Unknown timezone: count every flight minute rather than guess dayparts.
    claim(contributor, booking.startAt, booking.endAt, resolve ? minute => mask[resolve(minute)] === 1 : () => true);
  }
  for (const hold of holds) {
    claim({ kind: 'HOLD', id: hold.id, label: hold.label, slots: hold.slots, inOverbooking: false }, hold.startAt, hold.endAt, () => true);
  }
  const capacity = slotsPerLoop(screen);
  let peak = 0, firstOver = -1;
  const dayPeaks = new Array<number>(days).fill(0);
  for (let index = 0; index < length; index++) {
    const value = counts[index];
    if (value > peak) peak = value;
    const day = Math.floor(index / DAY_MINUTES);
    if (value > dayPeaks[day]) dayPeaks[day] = value;
    if (capacity !== null && firstOver < 0 && value > capacity) firstOver = index;
  }
  if (capacity !== null && firstOver >= 0) {
    for (const { contributor, minutes } of claims) {
      for (let index = firstOver; index < length; index++) {
        if (minutes[index] && counts[index] > capacity) { contributor.inOverbooking = true; break; }
      }
    }
  }
  return {
    slotsPerLoop: capacity,
    peakSlots: peak,
    peakOccupancyPct: capacity === null ? null : Math.round((peak / capacity) * 1000) / 10,
    overbooked: capacity === null ? null : firstOver >= 0,
    overbookedFrom: firstOver >= 0 ? new Date((start + firstOver) * MINUTE).toISOString() : null,
    days: dayPeaks.map((value, day) => ({ date: new Date((start + day * DAY_MINUTES) * MINUTE).toISOString().slice(0, 10), peakSlots: value })),
    contributors: claims.map(item => item.contributor),
  };
}
