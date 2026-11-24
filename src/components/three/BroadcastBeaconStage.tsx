// The broadcast wizard's status beacon (React Three Fiber): a transmitter on a small stand. It sits dim while you set
// up, glows orange with slow signal rings once a match and a link are ready, and turns red with fast rings and
// orbiting viewer lights once the match is on air. Decorative: the wizard says the same thing in text.
// Loaded lazily by BroadcastBeacon; reduced motion shows a still frame of the same state.
import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type BeaconMode = 'idle' | 'ready' | 'live';
export interface BeaconPalette { idle: string; ready: string; live: string; base: string }

const RINGS = 3;
const VIEWERS = 9;

function Scene({ mode, palette, still }: { mode: BeaconMode; palette: BeaconPalette; still: boolean }) {
  const color = useMemo(() => new THREE.Color(palette[mode]), [mode, palette]);
  const rings = useRef<Array<THREE.Mesh | null>>([]);
  const orb = useRef<THREE.Mesh>(null);
  const viewers = useRef<THREE.Group>(null);
  const rig = useRef<THREE.Group>(null);
  const shown = useRef(0); // eases viewer lights in and out

  useFrame((state, delta) => {
    const t = still ? 1.2 : state.clock.elapsedTime;
    const speed = mode === 'live' ? 0.75 : mode === 'ready' ? 0.35 : 0.18;
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const phase = (t * speed + i / RINGS) % 1;
      ring.scale.setScalar(0.45 + phase * 2.1);
      (ring.material as THREE.MeshBasicMaterial).opacity = (mode === 'idle' ? 0.18 : 0.55) * (1 - phase);
    });
    if (orb.current) {
      const pulse = mode === 'live' ? 1 + Math.sin(t * 6) * 0.06 : 1;
      orb.current.scale.setScalar(pulse);
      (orb.current.material as THREE.MeshStandardMaterial).emissiveIntensity = mode === 'idle' ? 0.15 : mode === 'ready' ? 0.9 : 1.4 + Math.sin(t * 6) * 0.3;
    }
    shown.current = THREE.MathUtils.damp(shown.current, mode === 'live' ? 1 : 0, 4, still ? 10 : delta);
    if (viewers.current) {
      viewers.current.rotation.y = t * 0.4;
      viewers.current.scale.setScalar(Math.max(0.001, shown.current));
    }
    if (rig.current) rig.current.rotation.y = still ? 0.5 : 0.5 + Math.sin(t * 0.3) * 0.25;
  });

  return <group ref={rig} rotation={[0.32, 0.5, 0]} position={[0, -0.15, 0]}>
    {/* stand */}
    <mesh position={[0, -0.75, 0]}><cylinderGeometry args={[0.55, 0.7, 0.18, 40]} /><meshStandardMaterial color={palette.base} roughness={0.6} metalness={0.3} /></mesh>
    <mesh position={[0, -0.25, 0]}><cylinderGeometry args={[0.07, 0.1, 0.85, 20]} /><meshStandardMaterial color={palette.base} roughness={0.5} metalness={0.5} /></mesh>
    {/* transmitter */}
    <mesh ref={orb} position={[0, 0.32, 0]}><sphereGeometry args={[0.32, 40, 40]} /><meshStandardMaterial color={color} emissive={color} roughness={0.25} metalness={0.2} /></mesh>
    {/* signal rings, flat around the transmitter */}
    {Array.from({ length: RINGS }, (_, i) => <mesh key={i} ref={el => { rings.current[i] = el; }} position={[0, 0.32, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.6, 0.018, 8, 96]} />
      <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} />
    </mesh>)}
    {/* viewers: small lights circling the transmitter while on air */}
    <group ref={viewers} position={[0, 0.32, 0]}>
      {Array.from({ length: VIEWERS }, (_, i) => {
        const a = (i / VIEWERS) * Math.PI * 2;
        return <mesh key={i} position={[Math.cos(a) * 1.45, Math.sin(a * 3) * 0.18, Math.sin(a) * 1.45]}>
          <boxGeometry args={[0.12, 0.12, 0.12]} /><meshStandardMaterial color="#ffffff" emissive={palette.live} emissiveIntensity={0.6} />
        </mesh>;
      })}
    </group>
  </group>;
}

export default function BroadcastBeaconStage({ mode, palette, still = false, paused = false, onReady }: {
  mode: BeaconMode; palette: BeaconPalette; still?: boolean; paused?: boolean; onReady?: () => void;
}) {
  return <Canvas frameloop={paused ? 'never' : still ? 'demand' : 'always'} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}
    camera={{ fov: 34, near: 0.1, far: 30, position: [0, 0.6, 5.2] }}
    onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; onReady?.(); }}>
    <ambientLight intensity={0.7} />
    <directionalLight position={[2, 4, 4]} intensity={1.6} />
    <pointLight position={[0, 0.4, 1.5]} intensity={mode === 'idle' ? 1 : 6} color={palette[mode]} distance={6} />
    <Scene mode={mode} palette={palette} still={still} />
  </Canvas>;
}
