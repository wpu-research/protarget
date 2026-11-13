'use client';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Label2D } from './Labels';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FleetScreen, FleetShip } from '@protarget/shared';
import type { ScreenAd } from '../Inventory';
import { SALOON, placeScreens, resolutionLabel, screenPanel, seatPositions, type Quality } from '@/lib/fleet-sim';

const { floorY: Y0, halfWidth: HW, height: H, pitch: PITCH, perWall: PER } = SALOON;
const pierZ = (i: number) => -((PER - 1) * PITCH) / 2 + i * PITCH;

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g;
}
const merge = (list: THREE.BufferGeometry[]) => { const g = mergeGeometries(list, false)!; list.forEach(p => p.dispose()); return g; };

/** Hull, deck house, wheelhouse and funnel. All parametric; no model files. */
function useExterior() {
  return useMemo(() => {
    const outline = new THREE.Shape();      // shape x = beam, shape y = -z (bow at +z)
    const L = 24, B = 5.4;
    outline.moveTo(0, -(L + 4));
    outline.bezierCurveTo(B * 0.6, -(L - 6), B, -(L - 14), B, -(L - 22));
    outline.lineTo(B, L - 4);
    outline.quadraticCurveTo(B, L, B * 0.55, L);
    outline.lineTo(-B * 0.55, L);
    outline.quadraticCurveTo(-B, L, -B, L - 4);
    outline.lineTo(-B, -(L - 22));
    outline.bezierCurveTo(-B, -(L - 14), -B * 0.6, -(L - 6), 0, -(L + 4));
    const hullGeometry = new THREE.ExtrudeGeometry(outline, { depth: 3.15, bevelEnabled: false });
    hullGeometry.rotateX(-Math.PI / 2); hullGeometry.translate(0, -1.8, 0);
    const upper = new THREE.ExtrudeGeometry(outline, { depth: 0.25, bevelEnabled: false });
    upper.rotateX(-Math.PI / 2); upper.translate(0, Y0 - 0.25, 0); upper.scale(0.985, 1, 0.985);

    const shell: THREE.BufferGeometry[] = [];
    // Walls of the saloon, outside view: piers, sills, lintels (windows are the gaps).
    for (const side of [-1, 1]) {
      const x = side * HW;
      for (let i = 0; i < PER; i++) shell.push(box(0.3, H, 1.1, x, Y0 + H / 2, pierZ(i)));
      for (let i = 0; i < PER - 1; i++) {
        const z = pierZ(i) + PITCH / 2;
        shell.push(box(0.3, 0.9, PITCH - 1.1, x, Y0 + 0.45, z), box(0.3, 0.7, PITCH - 1.1, x, Y0 + H - 0.35, z));
      }
      shell.push(box(0.3, H, 1.7, x, Y0 + H / 2, -15.15), box(0.3, H, 1.7, x, Y0 + H / 2, 15.15));
    }
    const frames: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) for (let i = 0; i < PER - 1; i++) {
      const z = pierZ(i) + PITCH / 2, w = PITCH - 1.1;
      frames.push(box(0.36, 0.07, w, side * HW, Y0 + 0.93, z), box(0.36, 0.07, w, side * HW, Y0 + H - 0.73, z));
    }
    shell.push(box(HW * 2, H, 0.3, 0, Y0 + H / 2, -16), box(HW * 2, H, 0.3, 0, Y0 + H / 2, 16));
    const roof = box(HW * 2 + 0.8, 0.3, 32.8, 0, Y0 + H + 0.15, 0);
    const top = merge([box(HW * 1.7, 2.1, 22, 0, Y0 + H + 1.3, -2), box(HW * 1.2, 2.4, 6, 0, Y0 + H + 3.5, 8)]);
    const funnel = new THREE.CylinderGeometry(1.3, 1.6, 4.4, 14); funnel.translate(0, Y0 + H + 4.7, -8);
    const band = new THREE.CylinderGeometry(1.34, 1.64, 0.9, 14); band.translate(0, Y0 + H + 5.1, -8);
    return { hull: hullGeometry, upper, frames: merge(frames), shell: merge(shell), roof, top, funnel, band };
  }, []);
}

function tileTexture(base: string, line: string, cells: number, repeatX: number, repeatY: number) {
  const size = 256, c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line; ctx.lineWidth = 2;
  const step = size / cells;
  for (let i = 0; i <= cells; i++) { ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** Interior: tiled floor/ceiling, recessed lights, bench seats with armrests, doors. */
function useInterior() {
  return useMemo(() => {
    const floor = box(HW * 2, 0.2, 32, 0, Y0 - 0.1, 0);
    const ceiling = box(HW * 2, 0.15, 32, 0, Y0 + H - 0.075, 0);
    const floorMap = tileTexture('#b9b4a8', '#a39e92', 2, 4, 16), ceilingMap = tileTexture('#efe7d6', '#d3c9b2', 2, 4, 16);
    const positions = seatPositions();
    const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.45, 0.6), new THREE.MeshLambertMaterial({ color: '#ffffff' }), positions.length);
    const backs = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.7, 0.12), new THREE.MeshLambertMaterial({ color: '#ffffff' }), positions.length);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: '#b9bfc4', metalness: 0.8, roughness: 0.35 }), positions.length * 2);
    const m = new THREE.Matrix4(), color = new THREE.Color();
    positions.forEach((p, n) => {
      const blue = Math.round((p.z + 15) / 1.1) % 3 !== 0;       // mostly blue rows, red every third row (as in the cabin photos)
      color.set(blue ? '#1d5fc4' : '#c8352b');
      m.makeTranslation(p.x, Y0 + 0.28, p.z); seats.setMatrixAt(n, m); seats.setColorAt(n, color);
      m.makeTranslation(p.x, Y0 + 0.72, p.z - 0.26); backs.setMatrixAt(n, m); backs.setColorAt(n, color);
      m.makeTranslation(p.x - 0.5, Y0 + 0.55, p.z); arms.setMatrixAt(n * 2, m);
      m.makeTranslation(p.x + 0.5, Y0 + 0.55, p.z); arms.setMatrixAt(n * 2 + 1, m);
    });
    // Recessed ceiling lights (3 columns).
    const lightPositions = [-2.5, 0, 2.5].flatMap(x => Array.from({ length: 9 }, (_, i) => [x, -14 + i * 3.5] as const));
    const lights = merge(lightPositions.map(([x, z]) => { const g = new THREE.CircleGeometry(0.17, 16); g.rotateX(Math.PI / 2); g.translate(x, Y0 + H - 0.16, z); return g; }));
    // End-bulkhead doors (wood frame, cream leaf, porthole).
    const frames: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
    for (const z of [-15.82, 15.82]) {
      frames.push(box(1.3, 2.25, 0.08, 0, Y0 + 1.125, z)); leaves.push(box(1.1, 2.1, 0.1, 0, Y0 + 1.05, z * 0.998));
      const g = new THREE.CircleGeometry(0.2, 18); g.translate(0, Y0 + 1.5, z + (z > 0 ? -0.055 : 0.055)); if (z > 0) g.rotateY(0); glass.push(g);
    }
    seats.count = backs.count = positions.length; arms.count = positions.length * 2;
    [seats, backs, arms].forEach(i => { i.instanceMatrix.needsUpdate = true; if (i.instanceColor) i.instanceColor.needsUpdate = true; });
    return { floor, ceiling, floorMap, ceilingMap, seats, backs, arms, lights, frames: merge(frames), leaves: merge(leaves), glass: merge(glass) };
  }, []);
}

/** Brand idle slate (not a campaign creative): purple gradient, wordmark, screen code. Never implies playback. */
function screenTexture(screen: FleetScreen, aspect: number): THREE.CanvasTexture {
  const w = 640, h = Math.max(160, Math.round(640 / aspect));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, w, h);
  if (screen.active) { bg.addColorStop(0, '#1a0f5c'); bg.addColorStop(0.55, '#2a1190'); bg.addColorStop(1, '#6b1a9a'); } else { bg.addColorStop(0, '#222'); bg.addColorStop(1, '#333'); }
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (screen.active) {
    const blob = (x: number, y: number, r: number, a: string, b: string) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    blob(w * 0.9, h * 0.08, Math.min(w, h) * 0.55, '#ff4fa8', '#ff4fa800'); blob(w * 0.08, h * 0.95, Math.min(w, h) * 0.5, '#ff8a3d', '#ff8a3d00');
  }
  const u = Math.min(w, h);
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(u * 0.2)}px system-ui, sans-serif`;
  const pro = ctx.measureText('PRO').width, tar = ctx.measureText('TARGET').width, gap = u * 0.2;
  const x = (w - (pro + gap + tar)) / 2; const y = h * 0.46;
  ctx.textAlign = 'left'; ctx.fillText('PRO', x, y);
  const og = ctx.createRadialGradient(x + pro + gap / 2, y, 0, x + pro + gap / 2, y, u * 0.1);
  og.addColorStop(0, '#ffd14d'); og.addColorStop(0.5, '#ff4fa8'); og.addColorStop(1, '#8a2be2');
  ctx.fillStyle = og; ctx.beginPath(); ctx.arc(x + pro + gap / 2, y, u * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillText('TARGET', x + pro + gap, y);
  ctx.textAlign = 'center'; ctx.fillStyle = '#d9cffa'; ctx.font = `${Math.round(u * 0.055)}px system-ui, sans-serif`;
  ctx.fillText('HIGH-TECH PROGRAMMATIC DIGITAL AGENCY', w / 2, h * 0.64, w - 30);
  ctx.fillStyle = '#ffffffcc'; ctx.font = `600 ${Math.round(u * 0.06)}px system-ui, sans-serif`;
  ctx.fillText(`${screen.screenId}${resolutionLabel(screen.resolutionWidth, screen.resolutionHeight) ? ' · ' + resolutionLabel(screen.resolutionWidth, screen.resolutionHeight) : ''}`, w / 2, h * 0.86, w - 30);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function ScreenMesh({ screen, slot, selected, onSelect, ads }: {
  ads: ScreenAd[]; screen: FleetScreen; slot: ReturnType<typeof placeScreens<FleetScreen>>['placed'][number]['slot'];
  selected: boolean; onSelect: (id: string) => void;
}) {
  const panel = useMemo(() => screenPanel(screen.resolutionWidth, screen.resolutionHeight, screen.orientation), [screen]);
  const texture = useMemo(() => screenTexture(screen, panel.aspect), [screen, panel.aspect]);
  useEffect(() => () => texture.dispose(), [texture]);
  // Booked ad (read-only): show the first image creative on the screen; videos keep the idle slate.
  const adId = ads.find(ad => ad.creative?.kind === 'IMAGE')?.creative?.id;
  const [adTexture, setAdTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!adId) { setAdTexture(null); return; }
    let cancelled = false; let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(`/api/v1/creatives/${adId}/file`, tex => {
      if (cancelled) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; loaded = tex; setAdTexture(tex);
    }, undefined, () => { if (!cancelled) setAdTexture(null); });
    return () => { cancelled = true; loaded?.dispose(); setAdTexture(null); };
  }, [adId]);
  const handle = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 6) return;           // a drag to look around, not a click
    event.stopPropagation(); onSelect(screen.id);
  };
  const over = (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); document.body.style.cursor = 'pointer'; };
  const out = () => { document.body.style.cursor = ''; };
  return <group position={[slot.x, Y0 + 1.5, slot.z]} rotation={[0, slot.yaw, 0]} onClick={handle} onPointerOver={over} onPointerOut={out}>
    <mesh position={[0, 0, 0.03]}><boxGeometry args={[panel.width + 0.1, panel.height + 0.1, 0.06]} />
      <meshStandardMaterial color={selected ? '#d4eea7' : '#0b0f10'} emissive={selected ? '#d4eea7' : '#000000'} emissiveIntensity={selected ? 0.9 : 0} /></mesh>
    <mesh position={[0, 0, 0.065]}><planeGeometry args={[panel.width, panel.height]} />
      <meshBasicMaterial map={adTexture ?? texture} toneMapped={false} /></mesh>
  </group>;
}

export interface ShipProps {
  ship: FleetShip; quality: Quality; interior: boolean; selectedScreenId: string | null; ads: Record<string, ScreenAd[]>;
  highlighted: boolean; showLabel: boolean;
  onEnter: (id: string) => void; onSelectScreen: (id: string) => void;
  label: string;
}
export const Ship = forwardRef<THREE.Group, ShipProps>(function Ship(props, ref) {
  const { ship, interior, selectedScreenId, ads, highlighted, showLabel, onEnter, onSelectScreen, label } = props;
  const exterior = useExterior();
  const inside = useInterior();
  const placed = useMemo(() => placeScreens(ship.screens).placed, [ship.screens]);
  useEffect(() => () => {
    Object.values(exterior).forEach(g => g.dispose());
    inside.floor.dispose(); inside.ceiling.dispose(); inside.lights.dispose(); inside.frames.dispose(); inside.leaves.dispose(); inside.glass.dispose();
    inside.floorMap.dispose(); inside.ceilingMap.dispose(); inside.seats.dispose(); inside.backs.dispose(); inside.arms.dispose();
  }, [exterior, inside]);
  const dim = !ship.active;
  const hull = dim ? '#5a6468' : '#17343b', white = dim ? '#a9b1b3' : '#f2f4f1';
  const click = (event: ThreeEvent<MouseEvent>) => { if (interior || event.delta > 6) return; event.stopPropagation(); onEnter(ship.id); };
  return <group ref={ref} userData={{ shipId: ship.id }}>
    <group onClick={click} onPointerOver={e => { if (!interior) { e.stopPropagation(); document.body.style.cursor = 'pointer'; } }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      <mesh geometry={exterior.hull}><meshLambertMaterial color={hull} /></mesh>
      <mesh geometry={exterior.upper}><meshLambertMaterial color={white} /></mesh>
      <mesh geometry={exterior.shell}><meshLambertMaterial color={dim ? white : '#efe6d2'} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={exterior.roof}><meshLambertMaterial color="#e4e8e5" /></mesh>
      <mesh geometry={exterior.top}><meshLambertMaterial color={white} /></mesh>
      <mesh geometry={exterior.funnel}><meshLambertMaterial color={dim ? '#80888a' : '#c8402f'} /></mesh>
      <mesh geometry={exterior.band}><meshLambertMaterial color="#d4eea7" /></mesh>
      {/* Window glass */}
      {[-1, 1].map(side => <mesh key={side} position={[side * HW, Y0 + 1.4, 0]}>
        <boxGeometry args={[0.04, 1.2, 28]} /><meshPhysicalMaterial color="#8fb7c4" transparent opacity={0.22} roughness={0.05} depthWrite={false} /></mesh>)}
      {highlighted && <mesh position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[30, 33, 48]} />
        <meshBasicMaterial color="#d4eea7" transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} /></mesh>}
    </group>
    {/* Saloon */}
    <mesh geometry={exterior.frames}><meshLambertMaterial color="#8a5a2b" /></mesh>
    <mesh geometry={inside.floor}><meshLambertMaterial map={inside.floorMap} /></mesh>
    <mesh geometry={inside.ceiling}><meshBasicMaterial map={inside.ceilingMap} color="#fff3dc" /></mesh>
    <mesh geometry={inside.lights}><meshBasicMaterial color="#fffbe6" side={THREE.DoubleSide} /></mesh>
    <mesh geometry={inside.frames}><meshLambertMaterial color="#8a5a2b" /></mesh>
    <mesh geometry={inside.leaves}><meshLambertMaterial color="#eeeae0" /></mesh>
    <mesh geometry={inside.glass}><meshBasicMaterial color="#6f93a6" side={THREE.DoubleSide} /></mesh>
    <primitive object={inside.seats} /><primitive object={inside.backs} /><primitive object={inside.arms} />
    {interior && <>
      <ambientLight intensity={0.9} color="#ffe9c8" />
      <pointLight position={[0, Y0 + H - 0.4, -8]} intensity={12} distance={20} color="#ffe6bd" />
      <pointLight position={[0, Y0 + H - 0.4, 8]} intensity={12} distance={20} color="#ffe6bd" />
    </>}
    {placed.map(({ screen, slot }) => <ScreenMesh key={screen.id} screen={screen} slot={slot} selected={screen.id === selectedScreenId} onSelect={onSelectScreen} ads={ads[screen.screenId] ?? []} />)}
    {showLabel && <Label2D position={[0, 20, 0]} text={label} className={`fleet-ship-label${dim ? ' inactive' : ''}${highlighted ? ' active' : ''}`} />}
  </group>;
});
