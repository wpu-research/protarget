'use client';
import { forwardRef, useEffect, useMemo } from 'react';
import { Label2D } from './Labels';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FleetScreen, FleetShip } from '@protarget/shared';
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
    shell.push(box(HW * 2, H, 0.3, 0, Y0 + H / 2, -16), box(HW * 2, H, 0.3, 0, Y0 + H / 2, 16));
    const roof = box(HW * 2 + 0.8, 0.3, 32.8, 0, Y0 + H + 0.15, 0);
    const top = merge([box(HW * 1.7, 2.1, 22, 0, Y0 + H + 1.3, -2), box(HW * 1.2, 2.4, 6, 0, Y0 + H + 3.5, 8)]);
    const funnel = new THREE.CylinderGeometry(1.3, 1.6, 4.4, 14); funnel.translate(0, Y0 + H + 4.7, -8);
    const band = new THREE.CylinderGeometry(1.34, 1.64, 0.9, 14); band.translate(0, Y0 + H + 5.1, -8);
    return { hull: hullGeometry, upper, shell: merge(shell), roof, top, funnel, band };
  }, []);
}

/** Interior: floor, ceiling, bench seats. */
function useInterior() {
  return useMemo(() => {
    const floor = box(HW * 2, 0.2, 32, 0, Y0 - 0.1, 0);
    const ceiling = box(HW * 2, 0.15, 32, 0, Y0 + H - 0.075, 0);
    const positions = seatPositions();
    const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.45, 0.6), new THREE.MeshLambertMaterial({ color: '#1f56a8' }), positions.length);
    const backs = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.6, 0.1), new THREE.MeshLambertMaterial({ color: '#c0392b' }), positions.length);
    const m = new THREE.Matrix4();
    positions.forEach((p, n) => {
      m.makeTranslation(p.x, Y0 + 0.23, p.z); seats.setMatrixAt(n, m);
      m.makeTranslation(p.x, Y0 + 0.65, p.z - 0.27); backs.setMatrixAt(n, m);
    });
    const strips = merge([-2.5, 0, 2.5].flatMap(x => Array.from({ length: 8 }, (_, i) => box(0.6, 0.04, 0.6, x, Y0 + H - 0.17, -13 + i * 3.7))));
    return { floor, ceiling, seats, backs, strips };
  }, []);
}

function screenTexture(screen: FleetScreen, aspect: number): THREE.CanvasTexture {
  const w = 512, h = Math.max(128, Math.round(512 / aspect));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = screen.active ? '#0e2a30' : '#2b2b2b'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = screen.active ? '#88b376' : '#777'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = '#ecf0e8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(Math.min(w, h) * 0.15)}px system-ui, sans-serif`;
  ctx.fillText(screen.screenId, w / 2, h * 0.42, w - 30);
  ctx.fillStyle = '#9fb7b0'; ctx.font = `${Math.round(Math.min(w, h) * 0.09)}px system-ui, sans-serif`;
  ctx.fillText(resolutionLabel(screen.resolutionWidth, screen.resolutionHeight) ?? '—', w / 2, h * 0.62, w - 30);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function ScreenMesh({ screen, slot, selected, onSelect }: {
  screen: FleetScreen; slot: ReturnType<typeof placeScreens<FleetScreen>>['placed'][number]['slot'];
  selected: boolean; onSelect: (id: string) => void;
}) {
  const panel = useMemo(() => screenPanel(screen.resolutionWidth, screen.resolutionHeight, screen.orientation), [screen]);
  const texture = useMemo(() => screenTexture(screen, panel.aspect), [screen, panel.aspect]);
  useEffect(() => () => texture.dispose(), [texture]);
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
      <meshBasicMaterial map={texture} toneMapped={false} /></mesh>
  </group>;
}

export interface ShipProps {
  ship: FleetShip; quality: Quality; interior: boolean; selectedScreenId: string | null;
  highlighted: boolean; showLabel: boolean;
  onEnter: (id: string) => void; onSelectScreen: (id: string) => void;
  label: string;
}
export const Ship = forwardRef<THREE.Group, ShipProps>(function Ship(props, ref) {
  const { ship, interior, selectedScreenId, highlighted, showLabel, onEnter, onSelectScreen, label } = props;
  const exterior = useExterior();
  const inside = useInterior();
  const placed = useMemo(() => placeScreens(ship.screens).placed, [ship.screens]);
  useEffect(() => () => {
    Object.values(exterior).forEach(g => g.dispose());
    inside.floor.dispose(); inside.ceiling.dispose(); inside.strips.dispose();
    inside.seats.dispose(); inside.backs.dispose();
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
    <mesh geometry={inside.floor}><meshLambertMaterial color="#b8a584" /></mesh>
    <mesh geometry={inside.ceiling}><meshBasicMaterial color="#d9ddd6" /></mesh>
    <mesh geometry={inside.strips}><meshBasicMaterial color="#fffbe8" /></mesh>
    <primitive object={inside.seats} /><primitive object={inside.backs} />
    {interior && <>
      <pointLight position={[0, Y0 + H - 0.4, -8]} intensity={9} distance={18} color="#fff4dc" />
      <pointLight position={[0, Y0 + H - 0.4, 8]} intensity={9} distance={18} color="#fff4dc" />
    </>}
    {placed.map(({ screen, slot }) => <ScreenMesh key={screen.id} screen={screen} slot={slot} selected={screen.id === selectedScreenId} onSelect={onSelectScreen} />)}
    {showLabel && <Label2D position={[0, 20, 0]} text={label} className={`fleet-ship-label${dim ? ' inactive' : ''}${highlighted ? ' active' : ''}`} />}
  </group>;
});
