'use client';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { FleetShip } from '@protarget/shared';
import { SALOON, adalarPose, screenSlot, shipPose, viewpointFor, walk, type Quality, type Region } from '@/lib/fleet-sim';
import { AdalarBuildings, AdalarPlaces, Atmosphere, Bridges, Buildings, Land, Sea } from './World';
import { Ship } from './Ship';
import { LabelRenderer } from './Labels';

export type FleetMode = 'overview' | 'entering' | 'interior' | 'leaving';
export interface MoveInput { forward: boolean; back: boolean; left: boolean; right: boolean }
export interface SceneProps {
  ships: FleetShip[]; quality: Quality; region: Region; mode: FleetMode; shipId: string | null;
  highlightedShipId: string | null; selectedScreenId: string | null;
  goto: { screenId: string; nonce: number } | null;
  input: MutableRefObject<MoveInput>; reducedMotion: boolean;
  onEnter: (shipId: string) => void; onFlightDone: (kind: 'entered' | 'left') => void;
  onSelectScreen: (screenId: string) => void; onContextLost: () => void;
  labelFor: (ship: FleetShip) => string;
}

const EYE = SALOON.floorY + 1.65;
const FLIGHT_SECONDS = 4.6;
const smooth = (t: number) => t * t * (3 - 2 * t);
const lookQuat = (yaw: number, pitch: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));

interface Flight {
  curve: THREE.CatmullRomCurve3; frames: { at: number; q: THREE.Quaternion }[];
  elapsed: number; duration: number; kind: 'entered' | 'left'; end: THREE.Vector3; focus: THREE.Vector3;
}
function sampleOrientation(frames: Flight['frames'], u: number) {
  let i = 0;
  while (i < frames.length - 2 && u > frames[i + 1].at) i++;
  const a = frames[i], b = frames[i + 1];
  const k = smooth(THREE.MathUtils.clamp((u - a.at) / (b.at - a.at), 0, 1));
  return a.q.clone().slerp(b.q, k);
}

function Rig(props: SceneProps & { groups: MutableRefObject<Map<string, THREE.Group>>; side: MutableRefObject<number> }) {
  const { mode, shipId, quality, goto, input, reducedMotion, onFlightDone, groups, side } = props;
  const { camera, gl } = useThree();
  const flight = useRef<Flight | null>(null);
  const look = useRef({ x: 0, z: -10, yaw: Math.PI, pitch: 0 });
  const move = useRef<{ from: typeof look.current; to: { x: number; z: number; yaw: number }; t: number } | null>(null);
  const keys = useRef({ forward: false, back: false, left: false, right: false, fast: false });
  const controls = useRef<any>(null);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), q: new THREE.Quaternion() }), []);

  // Build the flight when the mode flips (ship is frozen by the parent loop while it is the active ship).
  useEffect(() => {
    const group = shipId ? groups.current.get(shipId) : null;
    if (!group || (mode !== 'entering' && mode !== 'leaving')) return;
    group.updateWorldMatrix(true, true);
    const L = (x: number, y: number, z: number) => group.localToWorld(new THREE.Vector3(x, y, z));
    const gq = group.getWorldQuaternion(new THREE.Quaternion());
    const local = (yaw: number, pitch: number) => gq.clone().multiply(lookQuat(yaw, pitch));
    camera.near = 0.1; camera.updateProjectionMatrix();
    group.scale.setScalar(1); group.updateWorldMatrix(true, true);
    if (mode === 'entering') {
      const sx = group.worldToLocal(camera.position.clone()).x >= 0 ? 1 : -1;
      side.current = sx;
      const windowZ = -5;                                            // centre of a window opening (see SALOON pitch)
      const pts = [camera.position.clone(), L(sx * 62, SALOON.floorY + 20, -30), L(sx * 15, SALOON.floorY + 3.6, windowZ - 4),
        L(sx * SALOON.halfWidth, EYE - 0.05, windowZ), L(sx * 2.2, EYE, -6.5), L(0, EYE, -10)];
      flight.current = {
        curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), elapsed: 0, kind: 'entered',
        duration: reducedMotion ? 0.01 : FLIGHT_SECONDS, end: pts[pts.length - 1], focus: L(0, SALOON.floorY, 0),
        frames: [{ at: 0, q: camera.quaternion.clone() }, { at: 0.55, q: local(sx * Math.PI / 2, -0.12) },
          { at: 0.8, q: local(sx * Math.PI / 2, 0) }, { at: 1, q: local(Math.PI, 0) }],
      };
      look.current = { x: 0, z: -10, yaw: Math.PI, pitch: 0 };
    } else {
      const sx = side.current || 1;
      const pts = [camera.position.clone(), L(sx * 2.2, EYE, -6.5), L(sx * SALOON.halfWidth, EYE - 0.05, -5), L(sx * 15, SALOON.floorY + 3.6, -9),
        L(sx * 62, SALOON.floorY + 20, -30), L(sx * 96, SALOON.floorY + 38, -48)];
      const end = pts[pts.length - 1], focus = L(0, SALOON.floorY + 2, 0);
      const toFocus = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(end, focus, new THREE.Vector3(0, 1, 0)));
      flight.current = {
        curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), elapsed: 0, kind: 'left',
        duration: reducedMotion ? 0.01 : FLIGHT_SECONDS * 0.8, end, focus,
        frames: [{ at: 0, q: camera.quaternion.clone() }, { at: 0.3, q: local(-sx * Math.PI / 2, 0) }, { at: 0.7, q: local(-sx * Math.PI / 2, -0.1) }, { at: 1, q: toFocus }],
      };
    }
  }, [mode, shipId, camera, groups, reducedMotion, side]);

  // Overview camera limits and per-region home view.
  useEffect(() => { if (mode === 'overview') { camera.near = 2; camera.updateProjectionMatrix(); } }, [mode, camera]);
  useEffect(() => {
    const home = props.region === 'adalar' ? { p: [2800, 5200, 5800], t: [500, 0, 150] } : { p: [300, 170, 560], t: [0, 30, -200] };
    camera.position.set(home.p[0], home.p[1], home.p[2]);
    if (controls.current) { controls.current.target.set(home.t[0], home.t[1], home.t[2]); controls.current.update(); }
  }, [props.region]);

  // Keyboard + drag look, active only inside the ship.
  useEffect(() => {
    if (mode !== 'interior') return;
    const map: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
      KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    };
    const down = (e: KeyboardEvent, value: boolean) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.current.fast = value;
      const k = map[e.code]; if (!k) return;
      keys.current[k] = value; if (value && e.code.startsWith('Arrow')) e.preventDefault();
    };
    const kd = (e: KeyboardEvent) => down(e, true), ku = (e: KeyboardEvent) => down(e, false);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    const el = gl.domElement; let drag: { x: number; y: number; id: number } | null = null;
    const pd = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
    const pm = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      look.current.yaw -= (e.clientX - drag.x) * 0.0042;
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - (e.clientY - drag.y) * 0.0042, -1.2, 1.2);
      drag.x = e.clientX; drag.y = e.clientY; move.current = null;
    };
    const pu = () => { drag = null; };
    el.addEventListener('pointerdown', pd); window.addEventListener('pointermove', pm); window.addEventListener('pointerup', pu); window.addEventListener('pointercancel', pu);
    const keysRef = keys.current;
    return () => {
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      el.removeEventListener('pointerdown', pd); window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); window.removeEventListener('pointercancel', pu);
      Object.assign(keysRef, { forward: false, back: false, left: false, right: false, fast: false });
    };
  }, [mode, gl]);

  // "Go to screen" requests from the list.
  useEffect(() => {
    if (!goto || mode !== 'interior' || !shipId) return;
    const ship = props.ships.find(s => s.id === shipId);
    const index = ship?.screens.findIndex(s => s.id === goto.screenId) ?? -1;
    if (index < 0 || index >= SALOON.maxScreens) return;
    const v = viewpointFor(screenSlot(index));
    move.current = { from: { ...look.current }, to: v, t: 0 };
  }, [goto?.nonce]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);
    const f = flight.current;
    if ((mode === 'entering' || mode === 'leaving') && f) {
      f.elapsed += dt;
      const u = Math.min(1, f.elapsed / f.duration), e = smooth(u);
      f.curve.getPoint(e, camera.position);
      camera.quaternion.copy(sampleOrientation(f.frames, e));
      if (u >= 1) {
        flight.current = null;
        if (f.kind === 'left') {
          camera.position.copy(f.end);
          if (controls.current) { controls.current.target.copy(f.focus); controls.current.update(); }
        }
        onFlightDone(f.kind);
      }
      return;
    }
    if (mode !== 'interior' || !shipId) return;
    const group = groups.current.get(shipId); if (!group) return;
    const s = look.current;
    if (move.current) {
      const m = move.current; m.t = Math.min(1, m.t + dt / 0.9);
      const k = smooth(m.t);
      s.x = THREE.MathUtils.lerp(m.from.x, m.to.x, k); s.z = THREE.MathUtils.lerp(m.from.z, m.to.z, k);
      let dy = m.to.yaw - m.from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      s.yaw = m.from.yaw + dy * k; s.pitch = THREE.MathUtils.lerp(m.from.pitch, 0, k);
      if (m.t >= 1) move.current = null;
    }
    const k = keys.current, i = input.current;
    const fwd = (k.forward || i.forward ? 1 : 0) - (k.back || i.back ? 1 : 0);
    const str = (k.right || i.right ? 1 : 0) - (k.left || i.left ? 1 : 0);
    if (fwd || str) {
      const next = walk(s, s.yaw, fwd, str, dt * (k.fast ? 4 : 2.2));
      s.x = next.x; s.z = next.z; move.current = null;
    }
    group.updateWorldMatrix(true, false);
    camera.position.copy(group.localToWorld(tmp.v.set(s.x, EYE, s.z)));
    camera.quaternion.copy(group.getWorldQuaternion(tmp.q).multiply(lookQuat(s.yaw, s.pitch)));
  });

  return <OrbitControls ref={controls} makeDefault enabled={mode === 'overview'} enableDamping dampingFactor={0.08}
    target={[0, 30, -200]} minDistance={25} maxDistance={props.region === 'adalar' ? 14000 : quality === 'high' ? 4200 : 3200} maxPolarAngle={1.5} />;
}

function Fleet(props: SceneProps) {
  const { ships, mode, shipId, highlightedShipId, quality, selectedScreenId, onEnter, onSelectScreen, labelFor } = props;
  const groups = useRef(new Map<string, THREE.Group>());
  const lag = useRef(new Map<string, number>());
  const side = useRef(1);
  const clock = useRef(0);
  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1);
    ships.forEach((ship, index) => {
      const group = groups.current.get(ship.id); if (!group) return;
      const held = mode !== 'overview' && ship.id === shipId;
      if (held) lag.current.set(ship.id, (lag.current.get(ship.id) ?? 0) + Math.min(delta, 0.1));
      const t = clock.current - (lag.current.get(ship.id) ?? 0);
      const pose = props.region === 'adalar' ? adalarPose(ship.id, index, t) : shipPose(ship.id, index, t);
      group.position.set(pose.x, held ? 0 : Math.sin(t * 1.1 + index) * 0.12, pose.z);
      group.scale.setScalar(props.region === 'adalar' && mode === 'overview' ? 4 : 1);
      group.rotation.set(held ? 0 : Math.sin(t * 0.8 + index * 2) * 0.006, pose.heading, 0);
    });
  }, -10);
  return <>
    <Rig {...props} groups={groups} side={side} />
    {ships.map(ship => <Ship key={ship.id} ship={ship} quality={quality}
      ref={node => { if (node) groups.current.set(ship.id, node); else groups.current.delete(ship.id); }}
      interior={mode === 'interior' && ship.id === shipId} selectedScreenId={selectedScreenId}
      highlighted={ship.id === highlightedShipId && mode === 'overview'} showLabel={mode === 'overview' || mode === 'leaving'}
      onEnter={onEnter} onSelectScreen={onSelectScreen} label={labelFor(ship)} />)}
  </>;
}

export default function FleetScene(props: SceneProps) {
  const high = props.quality === 'high';
  return <Canvas dpr={high ? [1, 2] : 1} gl={{ antialias: high, powerPreference: 'high-performance' }}
    camera={{ position: [300, 170, 560], fov: 55, near: 2, far: 40000 }}
    onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); props.onContextLost(); }); }}>
    <Atmosphere quality={props.quality} region={props.region} />
    <Sea quality={props.quality} region={props.region} />
    <Land quality={props.quality} region={props.region} />
    {props.region === 'adalar' ? <><AdalarBuildings quality={props.quality} /><AdalarPlaces /></> : <><Buildings quality={props.quality} /><Bridges /></>}
    <Fleet {...props} />
    <LabelRenderer />
  </Canvas>;
}
