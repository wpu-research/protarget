/**
 * Pure, deterministic helpers for the 3D fleet view. Nothing here is measured data:
 * routes, speeds and screen slots are simulation/schematic values derived from record ids.
 * Kept free of imports so it can be unit-tested with `node --test`.
 */

export type Quality = 'high' | 'low';
export type QualityChoice = 'auto' | Quality;

export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Stylised Bosphorus (1 unit = 1 m; the strait runs along -Z; bridge spacing is NOT to scale) ---------- */
export const STRAIT = { northZ: -3600, southZ: 1400, routeNorthZ: -3300, routeSouthZ: 700 } as const;
export function centerX(z: number): number { return 130 * Math.sin(z / 1150) + 45 * Math.sin(z / 430 + 1.3); }
export function halfWidth(z: number): number { return 340 + 70 * Math.sin(z / 760 + 0.8) + 28 * Math.sin(z / 260); }

export type BridgeKey = 'july15' | 'fsm' | 'yss';
export interface BridgeSpec { key: BridgeKey; z: number; towerHeight: number; deckHeight: number; kind: 'suspension' | 'hybrid' }
export const BRIDGES: readonly BridgeSpec[] = [
  { key: 'july15', z: 0, towerHeight: 165, deckHeight: 64, kind: 'suspension' },
  { key: 'fsm', z: -1500, towerHeight: 105, deckHeight: 64, kind: 'suspension' },
  { key: 'yss', z: -3000, towerHeight: 322, deckHeight: 64, kind: 'hybrid' },
];

/** Land height above the water line (negative = sea floor). Smooth, deterministic, no assets. */
export function terrainHeight(x: number, z: number): number {
  const d = Math.abs(x - centerX(z)) - halfWidth(z);
  const noise = Math.sin(x * 0.011 + z * 0.006) * 0.5 + Math.sin(x * 0.027 - z * 0.019) * 0.3 + Math.sin(x * 0.061 + z * 0.047) * 0.2;
  if (d < 0) { const k = Math.min(1, -d / 70); return -14 * k * k * (3 - 2 * k) - 0.2; }
  const ramp = Math.min(d, 1800);
  return Math.min(ramp * 0.16, 95) * (0.65 + 0.35 * (noise * 0.5 + 0.5)) + Math.min(d / 25, 1) * 1.6 + noise * 3 * Math.min(d / 200, 1);
}

/* ---------- Simulated routes ---------- */
export interface ShipPose { x: number; z: number; heading: number; speed: number }
/** Back-and-forth patrol on the strait centre line. `index` spreads ships over lanes; `seconds` is simulation time. */
export function shipPose(id: string, index: number, seconds: number): ShipPose {
  const rand = seeded(hashString(id));
  const speed = 7 + rand() * 4;                              // m/s, simulated
  const phase = rand() * 2 * (STRAIT.routeSouthZ - STRAIT.routeNorthZ);
  const lane = ((index % 5) - 2) * 62 + (rand() - 0.5) * 24;  // lateral offset from the centre line
  const length = STRAIT.routeSouthZ - STRAIT.routeNorthZ;
  const at = (s: number) => {
    const m = ((s % (2 * length)) + 2 * length) % (2 * length);
    const along = m <= length ? m : 2 * length - m;
    return { z: STRAIT.routeSouthZ - along, forward: m <= length };
  };
  const s = phase + speed * seconds;
  const now = at(s);
  const x = centerX(now.z) + lane;
  const ahead = at(s + 1);
  const ax = centerX(ahead.z) + lane;
  return { x, z: now.z, heading: Math.atan2(ax - x, ahead.z - now.z), speed };
}

/* ---------- Quality ---------- */
export interface QualityProbe { width: number; coarsePointer: boolean; cores?: number; memoryGb?: number; webgl: boolean }
export function detectQuality(probe: QualityProbe): Quality {
  if (!probe.webgl) return 'low';
  if (probe.width < 820 || probe.coarsePointer) return 'low';
  if (probe.cores !== undefined && probe.cores <= 4) return 'low';
  if (probe.memoryGb !== undefined && probe.memoryGb <= 4) return 'low';
  return 'high';
}
export function resolveQuality(choice: QualityChoice, detected: Quality): Quality { return choice === 'auto' ? detected : choice; }

/* ---------- On-board layout (schematic) ---------- */
export const SALOON = { length: 32, halfWidth: 4.2, height: 2.8, floorY: 1.6, pitch: 2.5, perWall: 12, maxScreens: 24 } as const;
export interface ScreenSlot { index: number; wall: 'bulkhead' | 'side'; x: number; z: number; yaw: number }
/** Reference layout (operator photos): two screens on each end bulkhead facing the seats, the rest on the side-wall piers. */
export function screenSlot(index: number): ScreenSlot {
  if (index < 4) {
    const front = index < 2;
    return { index, wall: 'bulkhead', x: index % 2 === 0 ? -1.9 : 1.9, z: front ? SALOON.length / 2 - 0.2 : -SALOON.length / 2 + 0.2, yaw: front ? Math.PI : 0 };
  }
  const k = index - 4;
  const side = k % 2 === 0 ? -1 : 1;
  const i = Math.floor(k / 2) + 1;                           // skip the end pier next to the bulkhead
  const z = -((SALOON.perWall - 1) * SALOON.pitch) / 2 + i * SALOON.pitch;
  return { index, wall: 'side', x: side * (SALOON.halfWidth - 0.2), z, yaw: side === -1 ? Math.PI / 2 : -Math.PI / 2 };
}
export function placeScreens<T>(screens: readonly T[]): { placed: { screen: T; slot: ScreenSlot }[]; notPlaced: number } {
  const placed = screens.slice(0, SALOON.maxScreens).map((screen, index) => ({ screen, slot: screenSlot(index) }));
  return { placed, notPlaced: Math.max(0, screens.length - SALOON.maxScreens) };
}
/** Fit a screen's aspect ratio into the wall pier. Unknown resolution → 16:9 landscape. Only the *drawing* is derived. */
export function screenPanel(width: number | null, height: number | null, orientation: 'LANDSCAPE' | 'PORTRAIT' | null) {
  let aspect = width && height ? width / height : 16 / 9;
  if (!(width && height) && orientation === 'PORTRAIT') aspect = 9 / 16;
  const maxW = 0.95, maxH = 1.25;
  let w = maxW, h = w / aspect;
  if (h > maxH) { h = maxH; w = h * aspect; }
  return { width: w, height: h, aspect };
}
export function resolutionLabel(width: number | null, height: number | null): string | null {
  return width && height ? `${width}×${height}` : null;
}

/* ---------- Walking inside the saloon ---------- */
/** Seat blocks (z intervals) keep cross aisles open; lanes are the x offsets of the benches. */
export const SEAT_BLOCKS: readonly [number, number][] = [[-14.5, -5.5], [-3.5, 3.5], [5.5, 14.5]];
export const SEAT_LANES: readonly number[] = [-2.6, -1.6, 1.6, 2.6];
export function seatPositions(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const [from, to] of SEAT_BLOCKS) for (const x of SEAT_LANES) for (let z = from + 0.5; z <= to - 0.3; z += 1.1) out.push({ x, z });
  return out;
}
/** True when a standing point collides with a bench block. */
export function blockedBySeats(x: number, z: number): boolean {
  return Math.abs(x) > 1.0 && Math.abs(x) < 3.15 && SEAT_BLOCKS.some(([from, to]) => z > from - 0.2 && z < to + 0.2);
}
export const WALK_LIMIT = { x: SALOON.halfWidth - 0.6, z: SALOON.length / 2 - 1.2 } as const;
/** Moves in saloon-local coordinates, sliding along walls and benches. `yaw` follows the camera convention (forward = -Z at 0). */
export function walk(pos: { x: number; z: number }, yaw: number, forward: number, strafe: number, distance: number) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const dx = (fx * forward + rx * strafe) * distance, dz = (fz * forward + rz * strafe) * distance;
  const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));
  let { x, z } = pos;
  const nx = clamp(x + dx, WALK_LIMIT.x);
  if (!blockedBySeats(nx, z)) x = nx;
  const nz = clamp(z + dz, WALK_LIMIT.z);
  if (!blockedBySeats(x, nz)) z = nz;
  return { x, z };
}
/** Where to stand (and which way to face) to look at a screen: side aisle for wall screens, centre aisle for bulkhead screens. */
export function viewpointFor(slot: ScreenSlot) {
  const nx = Math.sin(slot.yaw), nz = Math.cos(slot.yaw);   // screen normal, pointing into the saloon
  if (slot.wall === 'bulkhead') return { x: 0, z: slot.z + nz * 2.4, yaw: slot.yaw };
  return { x: slot.x + nx * 0.7, z: slot.z, yaw: slot.yaw };
}
