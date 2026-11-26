// Users page 3D scene (React Three Fiber): accounts as a thick ring split by status (active, suspended, banned).
// Segments sweep in on load; the chosen segment slides outward and glows; hover lifts a segment. Click filters the list.
// The ring tilts toward the pointer and slowly turns. Loaded lazily by StatusRing.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

export interface RingPart { id: string; value: number; color: string }

export interface StatusRingStageProps {
  parts: RingPart[];
  selected: string | null;
  hovered: string | null;
  still?: boolean;
  lite?: boolean;
  paused?: boolean;
  empty: string;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  onReady?: () => void;
}

const INNER = 0.92, OUTER = 1.42, GAP = 0.035;

function arc(start: number, end: number) {
  const s = new THREE.Shape();
  s.absarc(0, 0, OUTER, start, end, false);
  s.absarc(0, 0, INNER, end, start, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3, curveSegments: Math.max(8, Math.ceil((end - start) * 24)) });
  g.translate(0, 0, -0.16);
  return g;
}

function Segment({ part, start, end, lit, chosen, still, onHover, onSelect }: {
  part: RingPart; start: number; end: number; lit: boolean; chosen: boolean; still: boolean;
  onHover?: (id: string | null) => void; onSelect?: (id: string) => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => arc(start + GAP / 2, Math.max(start + GAP, end - GAP / 2)), [start, end]);
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({ color: part.color, roughness: 0.3, metalness: 0.2, clearcoat: 0.7, emissive: new THREE.Color(part.color), emissiveIntensity: 0.14 }), [part.color]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const mid = (start + end) / 2;
  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const k = Math.min(1, delta * 9);
    const push = chosen ? 0.16 : lit ? 0.08 : 0;
    m.position.x += (Math.cos(mid) * push - m.position.x) * k;
    m.position.y += (Math.sin(mid) * push - m.position.y) * k;
    m.position.z += ((lit || chosen ? 0.12 : 0) - m.position.z) * k;
    material.emissiveIntensity += ((chosen ? 0.55 : lit ? 0.4 : 0.14) - material.emissiveIntensity) * k;
  });
  return <mesh ref={mesh} geometry={geometry} material={material} castShadow={!still}
    onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover?.(part.id); document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { onHover?.(null); document.body.style.cursor = ''; }}
    onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect?.(part.id); }} />;
}

function Ring({ parts, selected, hovered, still = false, empty, onHover, onSelect }: StatusRingStageProps) {
  const group = useRef<THREE.Group>(null);
  const sweep = useRef(still ? 1 : 0);
  const { pointer } = useThree();
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    if (sweep.current < 1) sweep.current = Math.min(1, sweep.current + delta * 0.9);
    const e = 1 - Math.pow(1 - sweep.current, 3);
    g.scale.setScalar(0.6 + 0.4 * e);
    g.rotation.z = still ? 0.3 : (1 - e) * -2.4 + frame.clock.elapsedTime * 0.06;
    const k = Math.min(1, delta * 4);
    g.rotation.x += ((still ? -0.35 : -0.38 - pointer.y * 0.18) - g.rotation.x) * k;
    g.rotation.y += ((still ? 0.2 : 0.18 + pointer.x * 0.25) - g.rotation.y) * k;
  });
  let angle = Math.PI / 2;
  return <group ref={group}>
    {total === 0
      ? <Segment part={{ id: 'none', value: 1, color: empty }} start={0} end={Math.PI * 2 - 0.001} lit={false} chosen={false} still={still} />
      : parts.filter(part => part.value > 0).map(part => {
        const span = (part.value / total) * Math.PI * 2;
        const start = angle;
        angle += span;
        return <Segment key={part.id} part={part} start={start} end={start + span} lit={hovered === part.id} chosen={selected === part.id}
          still={still} onHover={onHover} onSelect={onSelect} />;
      })}
  </group>;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => onReady?.()); } });
  return null;
}

export default function StatusRingStage(props: StatusRingStageProps) {
  const { lite = false, paused = false, onHover } = props;
  return <div className="adp-stage-canvas">
    <Canvas
      frameloop={paused ? 'demand' : 'always'}
      dpr={lite ? [1, 1.5] : [1, 2]}
      shadows={!lite}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 32, near: 0.1, far: 30, position: [0, 0, 6.2] }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}
      onPointerMissed={() => onHover?.(null)}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.8} color="#fff1e2" castShadow={!lite} />
      <pointLight position={[-3, -2, 3]} intensity={8} color="#7cb4ff" distance={12} />
      <Ring {...props} />
      <FirstFrame onReady={props.onReady} />
    </Canvas>
  </div>;
}
