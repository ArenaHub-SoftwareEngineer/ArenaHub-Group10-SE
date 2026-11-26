// System log 3D scene (React Three Fiber): a skyline of the last 24 hours (or 7 days). Each column is one hour or day,
// stacked by log category in that category's colour, so a burst of sign-ups or a run of match updates shows at a glance.
// Hover a column to read it; click it to filter the log to that time. The chosen column stays lit and the rest dim.
// Drag sideways to turn the skyline; it settles back. Loaded lazily by ActivitySkyline.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ActivityBucket } from '../../lib/logFeed';
import type { LogCategory } from '../../lib/adminInsights';

export interface SkylineStageProps {
  buckets: ActivityBucket[];
  order: LogCategory[];
  colors: Record<LogCategory, string>;
  floor: string;
  selected: string | null;
  hovered: string | null;
  still?: boolean;
  lite?: boolean;
  paused?: boolean;
  onHover?: (key: string | null) => void;
  onSelect?: (key: string) => void;
  onReady?: () => void;
}

const box = new THREE.BoxGeometry(1, 1, 1);
box.translate(0, 0.5, 0);
type Drive = { yaw: number; dragging: boolean; lastX: number; moved: number };

function Column({ bucket, x, width, unit, order, colors, delay, dim, lit, still, drive, onHover, onSelect }: {
  bucket: ActivityBucket; x: number; width: number; unit: number; order: LogCategory[]; colors: Record<LogCategory, string>;
  delay: number; dim: boolean; lit: boolean; still: boolean; drive: React.MutableRefObject<Drive>;
  onHover?: (key: string | null) => void; onSelect?: (key: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const grow = useRef(still ? 1 : 0);
  const segments = useMemo(() => {
    let base = 0;
    return order.filter(category => bucket.byCategory[category]).map(category => {
      const h = (bucket.byCategory[category] || 0) * unit;
      const seg = { category, base, h };
      base += h;
      return seg;
    });
  }, [bucket, order, unit]);
  const materials = useMemo(() => segments.map(seg => new THREE.MeshPhysicalMaterial({
    color: colors[seg.category], roughness: 0.35, metalness: 0.15, clearcoat: 0.5, transparent: true,
    emissive: new THREE.Color(colors[seg.category]), emissiveIntensity: 0.12,
  })), [segments, colors]);
  useEffect(() => () => materials.forEach(material => material.dispose()), [materials]);
  const ghost = useMemo(() => new THREE.MeshStandardMaterial({ color: '#888', transparent: true, opacity: 0.18, roughness: 1 }), []);
  useEffect(() => () => ghost.dispose(), [ghost]);

  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    const t = frame.clock.elapsedTime;
    if (grow.current < 1) grow.current = t < delay ? 0 : Math.min(1, grow.current + Math.min(delta, 1 / 20) * 1.8);
    const e = 1 - Math.pow(1 - grow.current, 3);
    g.scale.y = Math.max(0.001, e);
    g.position.y += ((lit ? 0.08 : 0) - g.position.y) * Math.min(1, delta * 10);
    const k = Math.min(1, delta * 8);
    materials.forEach(material => {
      material.opacity += ((dim ? 0.28 : 1) - material.opacity) * k;
      material.emissiveIntensity += ((lit ? 0.5 : 0.12) - material.emissiveIntensity) * k;
    });
  });

  const over = (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onHover?.(bucket.key); document.body.style.cursor = bucket.total ? 'pointer' : ''; };
  const out = () => { onHover?.(null); document.body.style.cursor = ''; };
  const click = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (bucket.total && drive.current.moved < 6) onSelect?.(bucket.key); };
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return <group position={[x, 0, 0]}>
    <group ref={group}>
      {segments.map((seg, i) => <mesh key={seg.category} geometry={box} material={materials[i]} position={[0, seg.base, 0]} scale={[width, Math.max(0.001, seg.h - 0.015), width]} castShadow />)}
    </group>
    {/* An invisible hit column the full height of the chart, so short or empty hours are still easy to point at. */}
    <mesh geometry={box} scale={[width * 1.15, 2.6, width * 1.6]} onPointerOver={over} onPointerOut={out} onClick={click}>
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    {!bucket.total && <mesh geometry={box} material={ghost} scale={[width, 0.02, width]} />}
  </group>;
}

function Rig({ still }: { still: boolean }) {
  const { camera, size } = useThree();
  const intro = useRef(still ? 1 : 0);
  useFrame((_, delta) => {
    if (intro.current < 1) intro.current = Math.min(1, intro.current + Math.min(delta, 1 / 20) / 1.4);
    const t = 1 - Math.pow(1 - intro.current, 3);
    // Fit the 10-unit skyline to the canvas width at any aspect ratio.
    const cam = camera as THREE.PerspectiveCamera;
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (size.width / size.height));
    const distance = Math.max(5, 5.8 / Math.tan(half));
    camera.position.set((1 - t) * -3, distance * 0.36 + (1 - t) * 2.5, distance + (1 - t) * 3);
    camera.lookAt(0, 0.75, 0);
  });
  return null;
}

function Board(props: SkylineStageProps & { drive: React.MutableRefObject<Drive> }) {
  const { buckets, order, colors, floor, selected, hovered, still = false, drive, onHover, onSelect } = props;
  const group = useRef<THREE.Group>(null);
  const { size } = useThree();
  const span = 10;
  const pitch = span / buckets.length;
  const width = pitch * 0.62;
  const max = Math.max(1, ...buckets.map(bucket => bucket.total));
  // Narrow canvases show the skyline smaller, so its columns stand taller to stay readable.
  const unit = (size.width / size.height < 2.6 ? 3.4 : 1.9) / Math.max(3, max);
  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    const d = drive.current;
    if (!d.dragging) d.yaw *= Math.pow(0.15, Math.min(delta, 1 / 20));
    g.rotation.y = (still ? 0 : Math.sin(frame.clock.elapsedTime * 0.25) * 0.06) + d.yaw;
  });
  return <group ref={group}>
    <mesh position={[0, -0.06, 0]} receiveShadow>
      <boxGeometry args={[span + 0.6, 0.1, 1.4]} />
      <meshStandardMaterial color={floor} roughness={0.9} />
    </mesh>
    {buckets.map((bucket, i) => <Column key={bucket.key} bucket={bucket} x={-span / 2 + pitch / 2 + i * pitch} width={width} unit={unit}
      order={order} colors={colors} delay={0.1 + i * 0.03} still={still} drive={drive} onHover={onHover} onSelect={onSelect}
      lit={hovered === bucket.key || selected === bucket.key} dim={Boolean(selected) && selected !== bucket.key && hovered !== bucket.key} />)}
  </group>;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => onReady?.()); } });
  return null;
}

export default function ActivitySkylineStage(props: SkylineStageProps) {
  const { still = false, lite = false, paused = false, onHover, colors } = props;
  const host = useRef<HTMLDivElement>(null);
  const drive = useRef<Drive>({ yaw: 0, dragging: false, lastX: 0, moved: 0 });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const d = drive.current;
    const down = (e: PointerEvent) => { d.dragging = true; d.lastX = e.clientX; d.moved = 0; };
    const move = (e: PointerEvent) => {
      if (!d.dragging) return;
      const dx = e.clientX - d.lastX;
      d.lastX = e.clientX; d.moved += Math.abs(dx);
      d.yaw = Math.max(-0.7, Math.min(0.7, d.yaw + dx * 0.006));
    };
    const up = () => { d.dragging = false; };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('pointerleave', up);
    };
  }, []);
  return <div ref={host} className="adp-stage-canvas">
    <Canvas
      frameloop={paused ? 'demand' : 'always'}
      dpr={lite ? [1, 1.5] : [1, 2]}
      shadows={!lite}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 16, near: 0.1, far: 120, position: [0, 3.4, 7.6] }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}
      onPointerMissed={() => onHover?.(null)}
    >
      <Rig still={still} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 7, 5]} intensity={1.7} color="#fff1e2" castShadow={!lite} shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={5} shadow-camera-bottom={-3} />
      <pointLight position={[-5, 2.5, 3]} intensity={6} color="#7cb4ff" distance={14} />
      <Board {...props} drive={drive} />
      <FirstFrame onReady={props.onReady} />
    </Canvas>
  </div>;
}
