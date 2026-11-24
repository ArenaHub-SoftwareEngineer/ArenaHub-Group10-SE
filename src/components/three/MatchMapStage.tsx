// The admin Overview's 3D match map (React Three Fiber): every published bracket is a lane on a dark floor and every
// match is a block on it. Height and colour show the match state, so the whole event reads at a glance:
// played (tall, brand), live (tallest, red, pulsing with a beacon ring), needs attention (amber), scheduled (short, blue),
// time not set (a flat ghost tile).
//
// Interaction: blocks rise into place on load; hover lifts a block and names the match; click or tap opens it;
// drag sideways to turn the map (it settles back). Vertical swipes still scroll the page on phones.
//
// Loaded lazily by MatchMap, so three.js is only downloaded when the scene is actually shown.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { MapLane, TileState } from '../../lib/adminInsights';

export type MapPalette = Record<TileState, string> & { floor: string; lane: string; label: string };

export interface MatchMapStageProps {
  lanes: MapLane[];
  palette: MapPalette;
  still?: boolean;
  lite?: boolean;
  paused?: boolean;
  hovered?: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  onReady?: () => void;
}

const HEIGHT: Record<TileState, number> = { live: 1.35, done: 0.95, alert: 1.05, scheduled: 0.5, pending: 0.12 };
const PITCH = 0.72;
const LANE_GAP = 1.25;
const SIZE = 0.52;

type Drive = { yaw: number; dragging: boolean; lastX: number; moved: number };

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => { scene.environment = null; env.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
}

const box = new THREE.BoxGeometry(1, 1, 1);
const ring = new THREE.RingGeometry(0.42, 0.48, 40);

function Tile({ id, state, x, z, delay, color, still, hovered, drive, onHover, onSelect }: {
  id: string; state: TileState; x: number; z: number; delay: number; color: string; still: boolean; hovered: boolean;
  drive: React.MutableRefObject<Drive>; onHover?: (id: string | null) => void; onSelect?: (id: string) => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({
    color, metalness: state === 'pending' ? 0.05 : 0.2, roughness: state === 'pending' ? 0.8 : 0.42, clearcoat: state === 'pending' ? 0 : 0.25, envMapIntensity: 0.45,
    transparent: state === 'pending', opacity: state === 'pending' ? 0.55 : 1,
    emissive: new THREE.Color(color), emissiveIntensity: state === 'live' ? 0.35 : 0.04,
  }), [color, state]);
  const beaconMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), [color]);
  useEffect(() => () => { material.dispose(); beaconMaterial.dispose(); }, [material, beaconMaterial]);
  const grow = useRef(still ? 1 : 0);

  useFrame((frame, delta) => {
    const m = mesh.current;
    if (!m) return;
    const t = frame.clock.elapsedTime;
    if (grow.current < 1) grow.current = t < delay ? 0 : Math.min(1, grow.current + Math.min(delta, 1 / 20) * 2.2);
    const ease = 1 - Math.pow(1 - grow.current, 3);
    const pulse = state === 'live' && !still ? Math.sin(t * 3.2 + x) * 0.07 : 0;
    const h = Math.max(0.02, HEIGHT[state] * ease + pulse);
    const lift = hovered ? 0.14 : 0;
    m.scale.set(SIZE, h, SIZE);
    m.position.y += ((h / 2 + lift) - m.position.y) * Math.min(1, delta * 12);
    material.emissiveIntensity += ((hovered ? 0.55 : state === 'live' ? 0.3 + (still ? 0 : Math.sin(t * 3.2) * 0.12) : 0.04) - material.emissiveIntensity) * Math.min(1, delta * 10);
    const b = beacon.current;
    if (b) {
      const cycle = still ? 0.35 : (t * 0.7 + delay) % 1;
      b.scale.setScalar(1 + cycle * 1.6);
      beaconMaterial.opacity = (1 - cycle) * 0.6 * ease;
    }
  });

  const over = (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onHover?.(id); document.body.style.cursor = 'pointer'; };
  const out = () => { onHover?.(null); document.body.style.cursor = ''; };
  const click = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (drive.current.moved < 6) onSelect?.(id); };
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return <group position={[x, 0, z]}>
    <mesh ref={mesh} geometry={box} material={material} castShadow receiveShadow onPointerOver={over} onPointerOut={out} onClick={click} />
    {state === 'live' && <mesh ref={beacon} geometry={ring} material={beaconMaterial} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} />}
  </group>;
}

function LaneLabel({ text, color, x, z }: { text: string; color: string; x: number; z: number }) {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement('canvas');
    const label = text.length > 26 ? `${text.slice(0, 25)}…` : text;
    const ctx = canvas.getContext('2d')!;
    const font = '700 56px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(label).width) + 16;
    canvas.height = 80;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 8, 42);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return { texture: map, aspect: canvas.width / canvas.height };
  }, [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  const height = 0.44;
  // Right-aligned to the lane's first block, lying flat on the floor so it turns with the map.
  return <mesh position={[x - (height * aspect) / 2, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[height * aspect, height]} />
    <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
  </mesh>;
}

function Board({ lanes, palette, still, hovered, drive, onHover, onSelect }: Required<Pick<MatchMapStageProps, 'lanes' | 'palette'>> & {
  still: boolean; hovered?: string | null; drive: React.MutableRefObject<Drive>; onHover?: (id: string | null) => void; onSelect?: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const longest = Math.max(1, ...lanes.map(lane => lane.tiles.length));
  const width = longest * PITCH;
  const depth = Math.max(1, lanes.length) * LANE_GAP;
  // Fit any event size into the same frame: a 4-match cup and a 31-match bracket both fill the view.
  const scale = Math.min(1.2, 7 / Math.max(width + 3.6, depth * 1.6));
  const base = -0.12;

  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    const d = drive.current;
    if (!d.dragging) d.yaw *= Math.pow(0.12, Math.min(delta, 1 / 20));
    const sway = still ? 0 : Math.sin(frame.clock.elapsedTime * 0.2) * 0.09;
    g.rotation.y = base + sway + d.yaw;
  });

  let order = 0;
  // Shift right by half the label margin so the platform (lanes plus labels) sits in the middle of the view.
  return <group ref={group} scale={scale} position={[1.1 * scale, 0, 0]}>
    {/* The platform: fitted to the lanes plus room for their labels on the left. */}
    <mesh position={[-1.1, -0.09, 0]} receiveShadow>
      <boxGeometry args={[width + 3.6, 0.16, depth + 0.5]} />
      <meshStandardMaterial color={palette.floor} roughness={0.92} metalness={0} />
    </mesh>
    <mesh position={[-1.1, -0.165, 0]}>
      <boxGeometry args={[width + 3.75, 0.02, depth + 0.65]} />
      <meshBasicMaterial color={palette.done} transparent opacity={0.55} toneMapped={false} />
    </mesh>
    {lanes.map((lane, laneIndex) => {
      const z = (laneIndex - (lanes.length - 1) / 2) * LANE_GAP;
      const start = -width / 2 + PITCH / 2;
      return <group key={lane.id}>
        <mesh position={[0, 0.006, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[width + 0.3, SIZE + 0.34]} />
          <meshStandardMaterial color={palette.lane} roughness={0.9} />
        </mesh>
        <LaneLabel text={lane.label} color={palette.label} x={start - PITCH * 0.95} z={z} />
        {lane.tiles.map((tile, index) => <Tile key={tile.id} id={tile.id} state={tile.state} x={start + index * PITCH} z={z}
          delay={0.15 + (order++) * 0.025} color={palette[tile.state]} still={still} hovered={hovered === tile.id} drive={drive} onHover={onHover} onSelect={onSelect} />)}
      </group>;
    })}
  </group>;
}

function Rig({ still }: { still: boolean }) {
  const { camera, size } = useThree();
  const intro = useRef(still ? 1 : 0);
  const target = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const narrow = size.width / size.height < 1.3;
    target.set(0, narrow ? 7.4 : 5.6, narrow ? 6.6 : 5.4);
  }, [size.width, size.height, target]);
  useFrame((_, delta) => {
    if (intro.current < 1) intro.current = Math.min(1, intro.current + Math.min(delta, 1 / 20) / 1.6);
    const t = 1 - Math.pow(1 - intro.current, 3);
    // From high and far, swinging in from the side, down to the working view.
    camera.position.set(target.x + (1 - t) * 4.5, target.y + (1 - t) * 5, target.z + (1 - t) * 6);
    camera.lookAt(0, 0.1, 0.3);
  });
  return null;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => onReady?.()); } });
  return null;
}

export default function MatchMapStage({ lanes, palette, still = false, lite = false, paused = false, hovered, onHover, onSelect, onReady }: MatchMapStageProps) {
  const drive = useRef<Drive>({ yaw: 0, dragging: false, lastX: 0, moved: 0 });
  const host = useRef<HTMLDivElement>(null);

  // Drag sideways to turn the map. Pointer events stay on the DOM element so touch keeps vertical scrolling.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const d = drive.current;
    const down = (e: PointerEvent) => { d.dragging = true; d.lastX = e.clientX; d.moved = 0; };
    const move = (e: PointerEvent) => {
      if (!d.dragging) return;
      const dx = e.clientX - d.lastX;
      d.lastX = e.clientX;
      d.moved += Math.abs(dx);
      d.yaw = Math.max(-1.1, Math.min(1.1, d.yaw + dx * 0.008));
    };
    const up = () => { d.dragging = false; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', up);
    };
  }, []);

  return <div ref={host} className="ov-map-canvas">
    <Canvas
      frameloop={paused ? 'never' : 'always'}
      dpr={lite ? [1, 1.5] : [1, 1.75]}
      shadows={!lite}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 34, near: 0.1, far: 60, position: [0, 5.6, 7.4] }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; gl.toneMappingExposure = 0.95; }}
      onPointerMissed={() => onHover?.(null)}
    >
      <Rig still={still} />
      <Environment />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 8, 5]} intensity={1.5} color="#fff1e2" castShadow={!lite} shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-camera-near={1} shadow-camera-far={24} />
      <pointLight position={[-5, 3, -3]} intensity={14} color="#7cb4ff" distance={14} />
      <Board lanes={lanes} palette={palette} still={still} hovered={hovered} drive={drive} onHover={onHover} onSelect={onSelect} />
      <FirstFrame onReady={onReady} />
    </Canvas>
  </div>;
}
