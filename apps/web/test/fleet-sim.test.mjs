import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGES, SALOON, STRAIT, centerX, detectQuality, halfWidth, hashString, placeScreens, resolveQuality,
  resolutionLabel, screenPanel, screenSlot, shipPose, terrainHeight, seatPositions, blockedBySeats, walk, viewpointFor, WALK_LIMIT,
} from '../src/lib/fleet-sim.ts';

test('ship poses are deterministic, stay in the simulated route and keep to the water', () => {
  for (const id of ['a', 'ship-2', '3f2b9c1e-0000-4000-8000-000000000001']) {
    for (let index = 0; index < 6; index++) {
      for (const t of [0, 1, 37.5, 900, 86400]) {
        const pose = shipPose(id, index, t);
        assert.deepEqual(pose, shipPose(id, index, t));
        assert.ok(pose.z <= STRAIT.routeSouthZ + 1e-6 && pose.z >= STRAIT.routeNorthZ - 1e-6);
        assert.ok(Math.abs(pose.x - centerX(pose.z)) < halfWidth(pose.z) - 30, 'ship inside the strait');
        assert.ok(terrainHeight(pose.x, pose.z) < 0, 'ship over water');
        assert.ok(Number.isFinite(pose.heading));
      }
    }
  }
});
test('ships move steadily, never teleport', () => {
  const a = shipPose('x', 0, 100), b = shipPose('x', 0, 101);
  const jump = Math.hypot(a.x - b.x, a.z - b.z);
  assert.ok(jump > 1 && jump < 20, `moves ${jump} m/s`);
});
test('bridges sit over water and are ordered from south to north', () => {
  const zs = BRIDGES.map(b => b.z);
  assert.deepEqual([...zs].sort((p, q) => q - p), zs);
  assert.deepEqual(BRIDGES.map(b => b.key), ['july15', 'fsm', 'yss']);
  for (const b of BRIDGES) assert.ok(terrainHeight(centerX(b.z), b.z) < 0);
});
test('terrain: land rises away from the shore, sea is below the waterline', () => {
  const z = -700, c = centerX(z), hw = halfWidth(z);
  assert.ok(terrainHeight(c, z) < -5);
  assert.ok(terrainHeight(c + hw + 400, z) > terrainHeight(c + hw + 20, z));
  assert.ok(terrainHeight(c - hw - 400, z) > 5);
});
test('quality falls back to low for narrow, touch, weak-CPU, low-memory and no-WebGL devices', () => {
  const good = { width: 1440, coarsePointer: false, cores: 8, memoryGb: 8, webgl: true };
  assert.equal(detectQuality(good), 'high');
  assert.equal(detectQuality({ ...good, width: 390 }), 'low');
  assert.equal(detectQuality({ ...good, coarsePointer: true }), 'low');
  assert.equal(detectQuality({ ...good, cores: 4 }), 'low');
  assert.equal(detectQuality({ ...good, memoryGb: 2 }), 'low');
  assert.equal(detectQuality({ ...good, webgl: false }), 'low');
  assert.equal(detectQuality({ ...good, cores: undefined, memoryGb: undefined }), 'high');
  assert.equal(resolveQuality('auto', 'low'), 'low');
  assert.equal(resolveQuality('high', 'low'), 'high');
});
test('screen slots are unique, alternate walls and stay inside the saloon', () => {
  const slots = Array.from({ length: SALOON.maxScreens }, (_, i) => screenSlot(i));
  assert.equal(new Set(slots.map(s => `${s.x}:${s.z}`)).size, SALOON.maxScreens);
  assert.deepEqual(slots.slice(0, 4).map(s => s.wall), ['bulkhead', 'bulkhead', 'bulkhead', 'bulkhead']);
  assert.deepEqual(slots.slice(4, 8).map(s => Math.sign(s.x)), [-1, 1, -1, 1]);
  for (const s of slots) { assert.ok(Math.abs(s.z) < SALOON.length / 2 && Math.abs(s.x) < SALOON.halfWidth); }
});
test('placement caps at the saloon capacity and reports the rest', () => {
  const r = placeScreens(Array.from({ length: 30 }, (_, i) => i));
  assert.equal(r.placed.length, 24); assert.equal(r.notPlaced, 6);
  assert.deepEqual(placeScreens([]), { placed: [], notPlaced: 0 });
});
test('screen panel keeps aspect, fits the pier and never invents a resolution', () => {
  const wide = screenPanel(1920, 1080, 'LANDSCAPE'), tall = screenPanel(1080, 1920, 'PORTRAIT');
  assert.ok(wide.width <= 0.95 + 1e-9 && wide.height <= 1.25 + 1e-9 && Math.abs(wide.aspect - 16 / 9) < 1e-9);
  assert.ok(tall.height <= 1.25 + 1e-9 && tall.width < tall.height);
  assert.ok(screenPanel(null, null, 'PORTRAIT').height > screenPanel(null, null, null).height);
  assert.equal(resolutionLabel(null, 1080), null);
  assert.equal(resolutionLabel(1920, 1080), '1920×1080');
});
test('hashString is stable', () => { assert.equal(hashString('abc'), hashString('abc')); assert.notEqual(hashString('abc'), hashString('abd')); });
test('seats leave aisles open and never sit outside the saloon', () => {
  const seats = seatPositions();
  assert.ok(seats.length > 20);
  for (const s of seats) assert.ok(Math.abs(s.x) <= 2.6 && Math.abs(s.z) < SALOON.length / 2);
  assert.equal(blockedBySeats(0, 0), false);
  assert.equal(blockedBySeats(3.4, 0), false);
  assert.equal(blockedBySeats(1.5, -4.5), false, 'cross aisle');
  assert.equal(blockedBySeats(1.5, 10), true);
});
test('walking slides along walls and benches and never leaves the saloon', () => {
  let p = { x: 0, z: -10 };
  for (let i = 0; i < 400; i++) p = walk(p, Math.PI, 1, 0, 0.1);        // yaw PI = looking +z
  assert.ok(p.z > 0 && p.z <= WALK_LIMIT.z + 1e-9);
  const into = walk({ x: 0.5, z: 10 }, -Math.PI / 2, 1, 0, 5);            // yaw -PI/2 looks toward +x, into a bench block
  assert.ok(!blockedBySeats(into.x, into.z));
  const wall = walk({ x: 0, z: 0 }, -Math.PI / 2, 1, 0, 50);
  assert.ok(Math.abs(wall.x) <= WALK_LIMIT.x + 1e-9);
});
test('viewpoints stand in an aisle and face the screen', () => {
  for (let i = 0; i < SALOON.maxScreens; i++) {
    const slot = screenSlot(i), v = viewpointFor(slot);
    assert.equal(blockedBySeats(v.x, v.z), false, `slot ${i} viewpoint is in an aisle`);
    assert.ok(Math.abs(v.x) <= WALK_LIMIT.x + 1e-9 && Math.abs(v.z) <= WALK_LIMIT.z + 1e-9, `slot ${i} inside walk area`);
    const forward = [-Math.sin(v.yaw), -Math.cos(v.yaw)];                 // camera forward in saloon coordinates
    const toScreen = [slot.x - v.x, slot.z - v.z], len = Math.hypot(...toScreen);
    assert.ok((forward[0] * toScreen[0] + forward[1] * toScreen[1]) / len > 0.75, `slot ${i} faces the screen`);
  }
});
