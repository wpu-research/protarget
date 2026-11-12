'use client';
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRIDGES, STRAIT, centerX, halfWidth, seeded, terrainHeight, type BridgeSpec, type Quality } from '@/lib/fleet-sim';
import { useText } from '../Locale';
import { Label2D } from './Labels';

export const SUN_DIRECTION = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(200));
const SEA_COLOR = '#1b5566';

/** Procedural tileable wave normal map (no texture asset). */
function waveNormals(size: number): THREE.DataTexture {
  const height = (x: number, y: number) => {
    const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
    return Math.sin(u * 3 + v * 2) * 0.5 + Math.sin(u * 7 - v * 5 + 1.3) * 0.3 + Math.sin(u * 11 + v * 9 + 2.1) * 0.12;
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = height(x + 1, y) - height(x - 1, y), dy = height(x, y + 1) - height(x, y - 1);
    const n = new THREE.Vector3(-dx * 1.4, -dy * 1.4, 1).normalize();
    const i = (y * size + x) * 4;
    data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

export function Atmosphere({ quality }: { quality: Quality }) {
  const scene = useThree(state => state.scene);
  const sky = useMemo(() => {
    const s = new Sky(); s.scale.setScalar(20000);
    const u = s.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(SUN_DIRECTION);
    return s;
  }, []);
  useEffect(() => {
    const previous = scene.fog;
    scene.fog = new THREE.FogExp2('#b9ccd4', quality === 'high' ? 0.00019 : 0.00026);
    return () => { scene.fog = previous; sky.material.dispose(); sky.geometry.dispose(); };
  }, [scene, quality, sky]);
  return <>
    <primitive object={sky} />
    <hemisphereLight args={['#cfe3f2', '#6f7a63', 1.15]} />
    <directionalLight position={SUN_DIRECTION.clone().multiplyScalar(2000)} intensity={2.6} color="#fff1d6" />
  </>;
}

export function Sea({ quality }: { quality: Quality }) {
  const high = quality === 'high';
  const water = useMemo(() => {
    if (!high) return null;
    const w = new Water(new THREE.PlaneGeometry(9000, 9000), {
      textureWidth: 512, textureHeight: 512, waterNormals: waveNormals(128),
      sunDirection: SUN_DIRECTION.clone(), sunColor: 0xfff1d6, waterColor: SEA_COLOR, distortionScale: 0.9, fog: true,
    });
    w.rotation.x = -Math.PI / 2;
    (w.material as THREE.ShaderMaterial).uniforms.size.value = 1.1;
    return w;
  }, [high]);
  useFrame((_, delta) => { if (water) (water.material as THREE.ShaderMaterial).uniforms.time.value += delta * 0.35; });
  useEffect(() => () => { water?.geometry.dispose(); (water?.material as THREE.Material | undefined)?.dispose(); }, [water]);
  if (water) return <primitive object={water} position={[0, 0, -1000]} />;
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1000]}>
    <planeGeometry args={[9000, 9000]} /><meshStandardMaterial color={SEA_COLOR} roughness={0.35} metalness={0.2} />
  </mesh>;
}

const LAND_LOW = new THREE.Color('#9aa57e'), LAND_HIGH = new THREE.Color('#5f7a4a'), SAND = new THREE.Color('#bfb594');
export function Land({ quality }: { quality: Quality }) {
  const geometry = useMemo(() => {
    const [sx, sz] = quality === 'high' ? [230, 270] : [110, 130];
    const g = new THREE.PlaneGeometry(9000, 9000, sx, sz);
    g.rotateX(-Math.PI / 2);
    const position = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i) - 1000;
      const h = terrainHeight(x, z);
      position.setY(i, h);
      const t = THREE.MathUtils.clamp(h / 70, 0, 1);
      c.copy(LAND_LOW).lerp(LAND_HIGH, t);
      if (h < 4) c.lerp(SAND, THREE.MathUtils.clamp(1 - h / 4, 0, 0.7));
      if (h < 0) c.set('#314a52');
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [quality]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} position={[0, 0, -1000]}><meshLambertMaterial vertexColors /></mesh>;
}

const FACADES = ['#e6dcc6', '#d9c9a8', '#c9785a', '#d8b48a', '#ece6da', '#b9b2a4', '#caa68a', '#e2c9a0'];
export function Buildings({ quality }: { quality: Quality }) {
  const { mesh } = useMemo(() => {
    const count = quality === 'high' ? 2600 : 650;
    const rand = seeded(7);
    const geometry = new THREE.BoxGeometry(1, 1, 1); geometry.translate(0, 0.5, 0);
    const material = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const m = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    let placed = 0;
    for (let attempt = 0; attempt < count * 12 && placed < count; attempt++) {
      const z = STRAIT.northZ - 300 + rand() * (STRAIT.southZ - STRAIT.northZ + 600);
      const side = rand() < 0.5 ? -1 : 1;
      const off = 8 + Math.pow(rand(), 1.7) * 900;
      const x = centerX(z) + side * (halfWidth(z) + off);
      const ground = terrainHeight(x, z);
      if (ground < 1.2 || ground > 85) continue;
      if (BRIDGES.some(b => Math.abs(z - b.z) < 34)) continue;
      const w = 12 + rand() * 20, d = 12 + rand() * 20, h = 8 + rand() * (off < 300 ? 26 : 16);
      dummy.position.set(x, ground - 1, z); dummy.scale.set(w, h + 1, d); dummy.rotation.y = rand() * 0.6 - 0.3;
      dummy.updateMatrix(); m.setMatrixAt(placed, dummy.matrix);
      m.setColorAt(placed, color.set(FACADES[Math.floor(rand() * FACADES.length)]));
      placed++;
    }
    m.count = placed; m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return { mesh: m };
  }, [quality]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); }, [mesh]);
  return <primitive object={mesh} />;
}

function Bridge({ spec }: { spec: BridgeSpec }) {
  const text = useText();
  const parts = useMemo(() => {
    const c = centerX(spec.z), hw = halfWidth(spec.z);
    const towerX = hw - 12;
    const deckHalf = hw + 360;
    const H = spec.towerHeight, Y = spec.deckHeight;
    const geometries: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g;
    };
    const lines: number[] = [];
    const tubes: THREE.BufferGeometry[] = [];
    // Deck and towers (centred on the strait; z offsets are local to the bridge).
    const deck = box(deckHalf * 2, 3.2, 31, c, Y, 0);
    for (const side of [-1, 1]) {
      const x = c + side * towerX;
      if (spec.kind === 'suspension') {
        for (const dz of [-11, 11]) geometries.push(box(5, H, 5, x, H / 2, dz));
        for (const f of [0.55, 0.82, 1]) geometries.push(box(5, 4, 28, x, H * f - 2, 0));
      } else {
        // Hybrid inverted-Y tower, stays fan to the deck.
        for (const dz of [-9, 9]) { const g = new THREE.CylinderGeometry(2.6, 5.2, H * 0.55, 6); g.translate(x, H * 0.275, dz * 1.6); geometries.push(g); }
        geometries.push(box(5.5, H * 0.5, 8, x, H * 0.55 + H * 0.25, 0));
        for (const dir of [-1, 1]) for (let i = 1; i <= 18; i++) {
          const dx = x + dir * (i * 21 + 18), top = H * (0.97 - (i % 18) * 0.03);
          if (dx < c - deckHalf || dx > c + deckHalf) continue;
          for (const dz of [-14, 14]) lines.push(x, Math.max(top, Y + 30), dz * 0.1, dx, Y + 1, dz);
        }
      }
    }
    if (spec.kind === 'suspension') {
      // Main cables (parabolas) on both deck edges + hangers.
      for (const dz of [-14, 14]) {
        const points: THREE.Vector3[] = [];
        const left = c - towerX, right = c + towerX, top = H - 3;
        for (let i = 0; i <= 80; i++) {
          const f = i / 80, x = left + (right - left) * f;
          points.push(new THREE.Vector3(x, Y + 6 + (top - Y - 6) * Math.pow(2 * f - 1, 2), dz));
        }
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 0.7, 5));
        for (const side of [-1, 1]) {
          const a = new THREE.Vector3(c + side * towerX, top, dz), b = new THREE.Vector3(c + side * (deckHalf - 8), Y + 2, dz);
          tubes.push(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 2, 0.7, 5));
        }
        for (let x = left + 20; x < right - 10; x += 24) {
          const f = (x - left) / (right - left);
          lines.push(x, Y + 1.6, dz, x, Y + 6 + (top - Y - 6) * Math.pow(2 * f - 1, 2), dz);
        }
      }
    }
    const structure = mergeGeometries(geometries, false)!;
    const cables = tubes.length ? mergeGeometries(tubes, false)! : null;
    tubes.forEach(g => g.dispose()); geometries.forEach(g => g.dispose());
    const hangers = new THREE.BufferGeometry();
    hangers.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    return { deck, structure, cables, hangers, label: [c, H + 12, 0] as [number, number, number] };
  }, [spec]);
  useEffect(() => () => { parts.deck.dispose(); parts.structure.dispose(); parts.cables?.dispose(); parts.hangers.dispose(); }, [parts]);
  return <group position={[0, 0, spec.z]}>
    <mesh geometry={parts.deck}><meshLambertMaterial color="#c9ced0" /></mesh>
    <mesh geometry={parts.structure}><meshLambertMaterial color={spec.kind === 'hybrid' ? '#dfe3e3' : '#bfc6c9'} /></mesh>
    {parts.cables && <mesh geometry={parts.cables}><meshLambertMaterial color="#e9edee" /></mesh>}
    <lineSegments geometry={parts.hangers}><lineBasicMaterial color="#dfe5e7" /></lineSegments>
    <Label2D position={parts.label} className="fleet-bridge-label" text={text(`fleet.bridge.${spec.key}`)} />
  </group>;
}
export function Bridges() { return <>{BRIDGES.map(spec => <Bridge key={spec.key} spec={spec} />)}</>; }
