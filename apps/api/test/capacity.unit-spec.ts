import { screenCapacity, slotsPerLoop, type CapacityBooking } from '../src/modules/capacity/capacity-calc';
import { presentHold } from '../src/modules/capacity/capacity.service';

const monday = new Date('2026-11-16T00:00:00Z'); // a Monday
const booking = (code: string, over: Partial<CapacityBooking> = {}): CapacityBooking => ({
  campaignId: `id-${code}`, code, status: 'LIVE', startAt: new Date('2026-11-01T00:00:00Z'), endAt: new Date('2026-12-31T00:00:00Z'),
  timezone: 'Europe/Istanbul', schedule: [], ...over,
});
const screen = (loop: number | null, slot: number | null) => ({ loopLengthSec: loop, defaultSlotLengthSec: slot });

describe('Capacity add-on', () => {
  it('derives slots per loop only from valid positive loop/slot lengths', () => {
    expect(slotsPerLoop(screen(120, 15))).toBe(8);
    expect(slotsPerLoop(screen(100, 30))).toBe(3);
    expect(slotsPerLoop(screen(null, 15))).toBeNull();
    expect(slotsPerLoop(screen(120, null))).toBeNull();
    expect(slotsPerLoop(screen(10, 15))).toBeNull();
    expect(slotsPerLoop(screen(0, 0))).toBeNull();
  });
  it('reports unknown capacity as null instead of a percentage, but still shows claimed slots', () => {
    const result = screenCapacity(screen(null, null), monday, 2, [booking('A')], []);
    expect(result).toMatchObject({ slotsPerLoop: null, peakSlots: 1, peakOccupancyPct: null, overbooked: null, overbookedFrom: null });
  });
  it('flags overbooking and the bookings/holds that take part in it', () => {
    const late = booking('B', { startAt: new Date('2026-11-17T12:00:00Z') });
    const result = screenCapacity(screen(30, 15), monday, 3, [booking('A'), late],
      [{ id: 'h1', label: 'Hold', startAt: new Date('2026-11-17T12:00:00Z'), endAt: new Date('2026-11-17T13:00:00Z'), slots: 1 }]);
    expect(result.slotsPerLoop).toBe(2);
    expect(result.peakSlots).toBe(3);
    expect(result.peakOccupancyPct).toBe(150);
    expect(result.overbooked).toBe(true);
    expect(result.overbookedFrom).toBe('2026-11-17T12:00:00.000Z');
    expect(result.days.map(d => d.peakSlots)).toEqual([1, 3, 2]);
    expect(result.contributors.map(c => [c.label, c.inOverbooking])).toEqual([['A', true], ['B', true], ['Hold', true]]);
  });
  it('does not flag a booking that never overlaps the overbooked minutes', () => {
    const early = booking('E', { endAt: new Date('2026-11-16T06:00:00Z') });
    const result = screenCapacity(screen(15, 15), monday, 2, [early, booking('A', { startAt: new Date('2026-11-17T00:00:00Z') }),
      booking('B', { startAt: new Date('2026-11-17T00:00:00Z') })], []);
    expect(result.overbooked).toBe(true);
    expect(result.contributors.find(c => c.label === 'E')!.inOverbooking).toBe(false);
  });
  it('applies dayparts in the campaign timezone', () => {
    const daypart = booking('D', { schedule: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }] });
    const result = screenCapacity(screen(60, 15), monday, 7, [daypart], []);
    expect(result.days.map(d => d.peakSlots)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(result.overbooked).toBe(false);
    expect(result.peakOccupancyPct).toBe(25);
    // 09:00 Istanbul = 06:00Z; a range starting after it sees nothing that day.
    const afternoon = screenCapacity(screen(60, 15), new Date('2026-11-16T07:00:00Z'), 1, [daypart], []);
    expect(afternoon.peakSlots).toBe(0);
    expect(afternoon.contributors).toEqual([]);
  });
  it('ignores bookings and holds outside the window and weights holds by their slots', () => {
    const past = booking('P', { startAt: new Date('2026-10-01T00:00:00Z'), endAt: new Date('2026-10-02T00:00:00Z') });
    const result = screenCapacity(screen(120, 15), monday, 1, [past],
      [{ id: 'h', label: 'Big', startAt: new Date('2026-11-16T10:00:00Z'), endAt: new Date('2026-11-16T11:00:00Z'), slots: 5 }]);
    expect(result.peakSlots).toBe(5);
    expect(result.contributors.map(c => c.label)).toEqual(['Big']);
  });
  it('presents hold state from release and expiry', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const base = { id: 'h', screenId: 's', label: 'L', startAt: monday, endAt: now, slots: 1, note: null, createdAt: monday,
      releaseReason: null, screen: { screenId: 'SCR-1' }, createdBy: { id: 'u', name: 'Admin' } };
    expect(presentHold({ ...base, expiresAt: new Date('2026-11-17T00:00:00Z'), releasedAt: null }, now).state).toBe('ACTIVE');
    expect(presentHold({ ...base, expiresAt: now, releasedAt: null }, now).state).toBe('EXPIRED');
    expect(presentHold({ ...base, expiresAt: new Date('2026-11-17T00:00:00Z'), releasedAt: now, releaseReason: 'done' }, now).state).toBe('RELEASED');
  });
});
