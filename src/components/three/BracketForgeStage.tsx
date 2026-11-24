// The "bracket built" moment in the Bracket assistant (React Three Fiber): the bracket Arena AI just built assembles
// in 3D, one block per real match, round by round, with the paths drawing between rounds and the champion slot
// lighting up last. Elimination brackets are drawn as a tree; round robin and Swiss as plain columns.
// Loaded lazily by BracketForge; reduced motion shows the finished state at once.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface ForgeShape { rounds: number[]; tree: boolean }
export interface ForgePalette { node: string; accent: string; line: string; champion: string }

const COL = 1.55;
const ROW = 0.5;
const NODE = new THREE.BoxGeometry(1, 0.3, 0.14);
const SEG = new THREE.BoxGeometry(1, 1, 1);

type Spot = { x: number; y: number; delay: number };

function layout({ rounds, tree }: ForgeShape) {
  const columns: Spot[][] = [];
  rounds.forEach((count, r) => {
    const previous = columns[r - 1];
    const spots: Spot[] = [];
    for (let i = 0; i < count; i++) {
      const feeders = tree && previous ? [previous[i * 2], previous[i * 2 + 1]].filter(Boolean) : [];
      const y = feeders.length ? feeders.reduce((sum, spot) => sum + spot.y, 0) / feeders.length : (i - (count - 1) / 2) * -ROW;
      spots.push({ x: r * COL, y, delay: 0.2 + r * 0.42 + Math.min(i, 24) * 0.035 });
    }
    columns.push(spots);
  });
  const xs = columns.flat().map(spot => spot.x), ys = columns.flat().map(spot => spot.y);
  const last = columns.at(-1)?.[0];
  const champion = last ? { x: last.x + COL * 0.85, y: tree ? last.y : 0, delay: 0.35 + rounds.length * 0.42 } : null;
  return {
    columns, champion,
    width: Math.max(...xs, champion?.x ?? 0) - Math.min(...xs) + 1.4,
    height: Math.max(...ys) - Math.min(...ys) + 0.6,
    centerX: (Math.max(...xs, champion?.x ?? 0) + Math.min(...xs)) / 2,
    centerY: (Math.max(...ys) + Math.min(...ys)) / 2,
  };
}

/** 0 before `delay`, then eases to 1 over `span` seconds. */
const progress = (t: number, delay: number, span = 0.45) => {
  const p = Math.min(1, Math.max(0, (t - delay) / span));
  return 1 - Math.pow(1 - p, 3);
};

function Node({ spot, palette, clock }: { spot: Spot; palette: ForgePalette; clock: React.MutableRefObject<number> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: palette.node, roughness: 0.5, metalness: 0.15, emissive: new THREE.Color(palette.accent), emissiveIntensity: 0 }), [palette]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const p = progress(clock.current, spot.delay);
    m.scale.set(Math.max(0.001, p), Math.max(0.001, p), 1);
    m.position.z = (1 - p) * 0.8;
    // A short flash as each match lands, fading to a soft rim.
    const since = clock.current - spot.delay;
    material.emissiveIntensity = since < 0 ? 0 : 0.38 + Math.max(0, 1 - since * 1.8);
  });
  return <mesh ref={mesh} geometry={NODE} material={material} position={[spot.x, spot.y, 0]} />;
}

function Path({ from, to, palette, clock }: { from: Spot; to: Spot; palette: ForgePalette; clock: React.MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: palette.line, transparent: true, opacity: 0, toneMapped: false }), [palette]);
  useEffect(() => () => material.dispose(), [material]);
  const startX = from.x + 0.5, endX = to.x - 0.5, midX = (startX + endX) / 2, t = 0.025;
  useFrame(() => {
    const p = progress(clock.current, to.delay - 0.25, 0.4);
    material.opacity = p * 0.9;
    if (group.current) group.current.scale.x = Math.max(0.001, p);
  });
  // Elbow: out of the feeder, along to the middle, up or down, then into the next match. Grows from the feeder side.
  return <group ref={group} position={[startX, 0, -0.02]}>
    <mesh geometry={SEG} material={material} position={[(midX - startX) / 2, from.y, 0]} scale={[midX - startX, t, t]} />
    <mesh geometry={SEG} material={material} position={[midX - startX, (from.y + to.y) / 2, 0]} scale={[t, Math.abs(to.y - from.y) + t, t]} />
    <mesh geometry={SEG} material={material} position={[(midX - startX) + (endX - midX) / 2, to.y, 0]} scale={[endX - midX, t, t]} />
  </group>;
}

function Champion({ x, y, delay, palette, clock, still }: { x: number; y: number; delay: number; palette: ForgePalette; clock: React.MutableRefObject<number>; still: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: palette.champion, metalness: 0.6, roughness: 0.25, emissive: new THREE.Color(palette.champion), emissiveIntensity: 0.25 }), [palette]);
  const haloMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: palette.champion, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), [palette]);
  useEffect(() => () => { material.dispose(); haloMaterial.dispose(); }, [material, haloMaterial]);
  useFrame(() => {
    const p = progress(clock.current, delay, 0.6);
    if (mesh.current) {
      mesh.current.scale.setScalar(Math.max(0.001, p) * 0.32);
      mesh.current.rotation.y = still ? 0.6 : clock.current * 1.2;
    }
    if (halo.current) {
      const cycle = still ? 0.4 : ((clock.current - delay) * 0.6) % 1;
      halo.current.scale.setScalar(0.5 + Math.max(0, cycle) * 0.9);
      haloMaterial.opacity = p * (1 - Math.max(0, cycle)) * 0.5;
    }
  });
  return <group position={[x, y, 0]}>
    <mesh ref={mesh} material={material}><octahedronGeometry args={[1, 0]} /></mesh>
    <mesh ref={halo} material={haloMaterial}><ringGeometry args={[0.42, 0.47, 40]} /></mesh>
  </group>;
}

function Scene({ shape, palette, still, onReady }: { shape: ForgeShape; palette: ForgePalette; still: boolean; onReady?: () => void }) {
  const plan = useMemo(() => layout(shape), [shape]);
  const clock = useRef(still ? 99 : 0);
  const group = useRef<THREE.Group>(null);
  const ready = useRef(false);
  // Fit the whole bracket into a ~6 x 2.6 unit window.
  const scale = Math.min(1.25, 6.4 / plan.width, 3.1 / plan.height);
  useFrame((state, delta) => {
    if (!ready.current) { ready.current = true; requestAnimationFrame(() => onReady?.()); }
    if (!still) clock.current += Math.min(delta, 1 / 20);
    const g = group.current;
    if (g) {
      g.rotation.y = still ? -0.18 : -0.18 + Math.sin(state.clock.elapsedTime * 0.35) * 0.08;
      g.rotation.x = -0.1;
    }
  });
  return <group ref={group} scale={scale}>
    <group position={[-plan.centerX, -plan.centerY, 0]}>
      {shape.tree && plan.columns.slice(1).map((column, r) => column.map((spot, i) =>
        [plan.columns[r][i * 2], plan.columns[r][i * 2 + 1]].filter(Boolean).map((from, k) => <Path key={`${r}-${i}-${k}`} from={from} to={spot} palette={palette} clock={clock} />)))}
      {plan.columns.map((column, r) => column.map((spot, i) => <Node key={`${r}-${i}`} spot={spot} palette={palette} clock={clock} />))}
      {plan.champion && <>
        {shape.tree && <Path from={plan.columns.at(-1)![0]} to={{ ...plan.champion, x: plan.champion.x + 0.15 }} palette={palette} clock={clock} />}
        <Champion x={plan.champion.x} y={plan.champion.y} delay={plan.champion.delay} palette={palette} clock={clock} still={still} />
      </>}
    </group>
  </group>;
}

export default function BracketForgeStage({ shape, palette, still = false, paused = false, onReady }: {
  shape: ForgeShape; palette: ForgePalette; still?: boolean; paused?: boolean; onReady?: () => void;
}) {
  return <Canvas frameloop={paused ? 'never' : 'always'} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}
    camera={{ fov: 32, near: 0.1, far: 40, position: [0, 0.1, 6] }}
    onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}>
    <ambientLight intensity={0.8} />
    <directionalLight position={[2, 3, 5]} intensity={1.8} />
    <pointLight position={[-3, -1, 3]} intensity={8} color="#7cb4ff" distance={12} />
    <Scene shape={shape} palette={palette} still={still} onReady={onReady} />
  </Canvas>;
}
