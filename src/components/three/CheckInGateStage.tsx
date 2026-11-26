// The anti-cheat check-in gate (React Three Fiber). A tall scanning arch stands on a dark floor. Players are small
// tokens: the ones still to check in queue on the left, a scan beam sweeps the arch while check-in is open, and every
// player who passed sits on the right lit green. Closed: the arch is dim and the queue waits. Test (no sign-in): the arch
// is amber. Decorative only: the page states the same thing in text. Loaded lazily by CheckInGate.
import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type GateMode = 'closed' | 'open' | 'test';
export interface GatePalette { brand: string; test: string; pass: string; idle: string; base: string }

const MAX_TOKENS = 10;

function Token({ index, side, count, color, glow, still, walker = false }: {
  index: number; side: -1 | 1; count: number; color: string; glow: number; still: boolean; walker?: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const row = Math.floor(index / 5), col = index % 5;
  const home = useMemo(() => new THREE.Vector3(side * (1.35 + col * 0.42), 0, (row - (count > 5 ? 0.5 : 0)) * 0.55), [side, col, row, count]);
  useFrame(state => {
    if (!ref.current) return;
    const t = still ? 0.8 : state.clock.elapsedTime;
    if (walker) {
      // One player walks through the arch on a loop: left queue -> scan -> right side.
      const phase = (t * 0.32) % 1;
      ref.current.position.set(THREE.MathUtils.lerp(-1.6, 1.6, phase), Math.abs(Math.sin(phase * Math.PI * 6)) * 0.05, 0);
      ref.current.visible = !still;
      return;
    }
    ref.current.position.set(home.x, Math.sin(t * 1.6 + index) * 0.03, home.z);
  });
  return <group ref={ref}>
    <mesh position={[0, 0.28, 0]}><capsuleGeometry args={[0.11, 0.26, 6, 16]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} roughness={0.4} /></mesh>
    <mesh position={[0, 0.62, 0]}><sphereGeometry args={[0.1, 20, 20]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} roughness={0.4} /></mesh>
  </group>;
}

function Scene({ mode, palette, still, passed, total }: { mode: GateMode; palette: GatePalette; still: boolean; passed: number; total: number }) {
  const gateColor = mode === 'test' ? palette.test : mode === 'open' ? palette.brand : palette.idle;
  const beam = useRef<THREE.Mesh>(null);
  const arch = useRef<THREE.MeshStandardMaterial>(null);
  const rig = useRef<THREE.Group>(null);
  const shown = Math.min(MAX_TOKENS, Math.max(total, 6));
  const done = total ? Math.round((Math.min(passed, total) / total) * shown) : 0;

  useFrame(state => {
    const t = still ? 1 : state.clock.elapsedTime;
    if (beam.current) {
      beam.current.visible = mode !== 'closed';
      beam.current.position.y = 0.15 + ((Math.sin(t * 2.2) + 1) / 2) * 1.6;
    }
    if (arch.current) arch.current.emissiveIntensity = mode === 'closed' ? 0.08 : 0.9 + Math.sin(t * 3) * 0.25;
    if (rig.current) rig.current.rotation.y = still ? -0.32 : -0.32 + Math.sin(t * 0.25) * 0.12;
  });

  return <group ref={rig} rotation={[0.18, -0.32, 0]} position={[0, -0.9, 0]}>
    {/* floor */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}><circleGeometry args={[4.2, 64]} /><meshStandardMaterial color={palette.base} roughness={0.9} /></mesh>
    <gridHelper args={[8, 16, gateColor, palette.base]} position={[0, 0, 0]} />
    {/* the arch */}
    <mesh position={[0, 1.05, 0]}><torusGeometry args={[1.0, 0.07, 16, 80, Math.PI]} /><meshStandardMaterial ref={arch} color={gateColor} emissive={gateColor} roughness={0.3} metalness={0.4} /></mesh>
    {[-1, 1].map(x => <mesh key={x} position={[x, 0.52, 0]}><boxGeometry args={[0.14, 1.06, 0.14]} /><meshStandardMaterial color={gateColor} emissive={gateColor} emissiveIntensity={mode === 'closed' ? 0.05 : 0.5} roughness={0.35} /></mesh>)}
    {/* scan beam */}
    <mesh ref={beam} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[2, 0.5]} /><meshBasicMaterial color={gateColor} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} /></mesh>
    {/* players still to check in (left) and passed (right) */}
    {Array.from({ length: shown - done }, (_, i) => <Token key={`w${i}`} index={i} side={-1} count={shown - done} color={palette.idle} glow={0.05} still={still} />)}
    {Array.from({ length: done }, (_, i) => <Token key={`p${i}`} index={i} side={1} count={done} color={palette.pass} glow={0.7} still={still} />)}
    {mode !== 'closed' && <Token index={0} side={-1} count={1} color={gateColor} glow={0.9} still={still} walker />}
  </group>;
}

export default function CheckInGateStage({ mode, palette, passed, total, still = false, paused = false, onReady }: {
  mode: GateMode; palette: GatePalette; passed: number; total: number; still?: boolean; paused?: boolean; onReady?: () => void;
}) {
  return <Canvas frameloop={paused ? 'never' : still ? 'demand' : 'always'} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}
    camera={{ fov: 32, near: 0.1, far: 40, position: [0, 1.2, 7.4] }}
    onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; onReady?.(); }}>
    <ambientLight intensity={0.55} />
    <directionalLight position={[3, 5, 4]} intensity={1.4} />
    <pointLight position={[0, 1.2, 1.2]} intensity={mode === 'closed' ? 0.6 : 7} color={mode === 'test' ? palette.test : palette.brand} distance={7} />
    <Scene mode={mode} palette={palette} still={still} passed={passed} total={total} />
  </Canvas>;
}
