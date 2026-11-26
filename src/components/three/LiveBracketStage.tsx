// Bracket Studio 3D scene (React Three Fiber): the chosen live bracket laid out as a tilted board of match slabs.
// Each slab is split into the two teams; the winner's half lights up in the played colour and live slabs pulse red.
// Rounds rise in one after another, connectors light up where a winner advanced, and a crystal marks the champion.
// Hover lifts a slab, click picks the match for the result panel. Loaded lazily by LiveBracket.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

export interface StageSlab { id: string; x: number; y: number; column: number; tone: string; live: boolean; winner: 0 | 1 | 2 }
export interface StageLink { from: string; to: string; lit: boolean }

export interface LiveBracketStageProps {
  slabs: StageSlab[];
  links: StageLink[];
  width: number;
  height: number;
  /** Middle of the matches' bounding box, in board units. */
  center: [number, number];
  slabW: number;
  slabH: number;
  champion: { x: number; y: number } | null;
  palette: { base: string; line: string; lit: string; live: string; champion: string };
  selected: string | null;
  hovered: string | null;
  flash: { id: string; at: number } | null;
  still?: boolean;
  lite?: boolean;
  paused?: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  onReady?: () => void;
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function Slab({ slab, w, h, palette, chosen, lit, flash, still, onHover, onSelect }: {
  slab: StageSlab; w: number; h: number; palette: LiveBracketStageProps['palette']; chosen: boolean; lit: boolean; flash: number | null; still: boolean;
  onHover?: (id: string | null) => void; onSelect?: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  const pulse = useRef(0);
  const lastFlash = useRef(flash);
  const body = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(roundedRect(w, h, Math.min(w, h) * 0.18), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 });
    g.translate(0, 0, -0.05);
    return g;
  }, [w, h]);
  const half = useMemo(() => new THREE.BoxGeometry(w * 0.9, h * 0.34, 0.03), [w, h]);
  const bodyMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: palette.base, roughness: 0.42, metalness: 0.15, clearcoat: 0.6, emissive: new THREE.Color(slab.tone), emissiveIntensity: 0.05 }), [palette.base, slab.tone]);
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ color: slab.winner === 1 ? slab.tone : palette.line, emissive: new THREE.Color(slab.winner === 1 ? slab.tone : '#000'), emissiveIntensity: slab.winner === 1 ? 0.55 : 0, roughness: 0.5 }), [slab.tone, slab.winner, palette.line]);
  const bottomMat = useMemo(() => new THREE.MeshStandardMaterial({ color: slab.winner === 2 ? slab.tone : palette.line, emissive: new THREE.Color(slab.winner === 2 ? slab.tone : '#000'), emissiveIntensity: slab.winner === 2 ? 0.55 : 0, roughness: 0.5 }), [slab.tone, slab.winner, palette.line]);
  useEffect(() => () => { body.dispose(); half.dispose(); bodyMat.dispose(); topMat.dispose(); bottomMat.dispose(); }, [body, half, bodyMat, topMat, bottomMat]);

  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    if (flash !== lastFlash.current) { lastFlash.current = flash; if (flash !== null) pulse.current = 1; }
    const t = frame.clock.elapsedTime;
    if (born.current === null) born.current = t;
    // Columns arrive one after another: each waits 0.1 s per column before rising (again whenever another bracket is chosen).
    const local = still ? 1 : Math.max(0, Math.min(1, (t - born.current - slab.column * 0.1) * 2.2));
    const e = 1 - Math.pow(1 - local, 3);
    const k = Math.min(1, delta * 10);
    const targetZ = (chosen ? 0.22 : lit ? 0.12 : 0) + (1 - e) * -0.6;
    g.position.z += (targetZ - g.position.z) * (local < 1 ? 1 : k);
    g.scale.setScalar(0.7 + 0.3 * e);
    pulse.current = Math.max(0, pulse.current - delta * 1.2);
    const livePulse = slab.live && !still ? 0.25 + Math.sin(t * 4) * 0.2 : 0;
    const glow = (chosen ? 0.5 : lit ? 0.32 : 0.05) + livePulse + pulse.current * 0.9;
    bodyMat.emissiveIntensity += (glow - bodyMat.emissiveIntensity) * k;
  });

  return <group ref={group} position={[slab.x, slab.y, 0]}
    onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover?.(slab.id); document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { onHover?.(null); document.body.style.cursor = ''; }}
    onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect?.(slab.id); }}>
    <mesh geometry={body} material={bodyMat} castShadow={!still} receiveShadow />
    <mesh geometry={half} material={topMat} position={[0, h * 0.22, 0.075]} />
    <mesh geometry={half} material={bottomMat} position={[0, -h * 0.22, 0.075]} />
  </group>;
}

function Links({ slabs, links, w, palette }: { slabs: StageSlab[]; links: StageLink[]; w: number; palette: LiveBracketStageProps['palette'] }) {
  const [dim, lit] = useMemo(() => {
    const at = new Map(slabs.map(slab => [slab.id, slab]));
    const build = (on: boolean) => {
      const points: number[] = [];
      for (const link of links) {
        if (link.lit !== on) continue;
        const a = at.get(link.from), b = at.get(link.to);
        if (!a || !b) continue;
        const x1 = a.x + w / 2, x2 = b.x - w / 2, mid = (x1 + x2) / 2;
        points.push(x1, a.y, -0.02, mid, a.y, -0.02, mid, a.y, -0.02, mid, b.y, -0.02, mid, b.y, -0.02, x2, b.y, -0.02);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      return g;
    };
    return [build(false), build(true)];
  }, [slabs, links, w]);
  const dimMat = useMemo(() => new THREE.LineBasicMaterial({ color: palette.line, transparent: true, opacity: 0.55 }), [palette.line]);
  const litMat = useMemo(() => new THREE.LineBasicMaterial({ color: palette.lit }), [palette.lit]);
  useEffect(() => () => { dim.dispose(); lit.dispose(); dimMat.dispose(); litMat.dispose(); }, [dim, lit, dimMat, litMat]);
  return <>
    <lineSegments geometry={dim} material={dimMat} />
    <lineSegments geometry={lit} material={litMat} />
  </>;
}

function Champion({ x, y, color, still }: { x: number; y: number; color: string; still: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((frame) => {
    if (!mesh.current || still) return;
    mesh.current.rotation.y = frame.clock.elapsedTime * 0.9;
    mesh.current.position.z = 0.35 + Math.sin(frame.clock.elapsedTime * 1.6) * 0.06;
  });
  return <mesh ref={mesh} position={[x, y, 0.35]} rotation={[Math.PI / 2, 0, 0]} castShadow>
    <octahedronGeometry args={[0.32, 0]} />
    <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={0.45} roughness={0.15} metalness={0.4} clearcoat={1} />
  </mesh>;
}

function Board(props: LiveBracketStageProps) {
  const { slabs, links, width, height, center, slabW, slabH, champion, palette, selected, hovered, flash, still = false, onHover, onSelect } = props;
  const group = useRef<THREE.Group>(null);
  const { viewport, pointer } = useThree();
  // Fit the whole bracket: the board is tilted back, so it may use a little more height than the view shows flat.
  const scale = Math.min((viewport.width * 0.9) / width, (viewport.height * 1.2) / height);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const k = Math.min(1, delta * 3);
    g.rotation.x += ((still ? -0.42 : -0.42 + pointer.y * 0.08) - g.rotation.x) * k;
    g.rotation.y += ((still ? 0 : pointer.x * 0.14) - g.rotation.y) * k;
  });
  return <group ref={group} scale={scale}>
    <group position={[-center[0], -center[1], 0]}>
      <Links slabs={slabs} links={links} w={slabW} palette={palette} />
      {slabs.map(slab => <Slab key={slab.id} slab={slab} w={slabW} h={slabH} palette={palette} chosen={selected === slab.id} lit={hovered === slab.id}
        flash={flash?.id === slab.id ? flash.at : null} still={still} onHover={onHover} onSelect={onSelect} />)}
      {champion && <Champion x={champion.x} y={champion.y} color={palette.champion} still={still} />}
    </group>
  </group>;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => onReady?.()); } });
  return null;
}

export default function LiveBracketStage(props: LiveBracketStageProps) {
  const { lite = false, paused = false, onHover } = props;
  return <div className="adp-stage-canvas">
    <Canvas
      frameloop={paused ? 'demand' : 'always'}
      dpr={lite ? [1, 1.5] : [1, 2]}
      shadows={!lite}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 30, near: 0.1, far: 40, position: [0, -0.6, 9] }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}
      onPointerMissed={() => onHover?.(null)}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[2, 4, 6]} intensity={1.7} color="#fff1e2" castShadow={!lite} />
      <pointLight position={[-4, -3, 3]} intensity={10} color="#7cb4ff" distance={14} />
      <Board {...props} />
      <FirstFrame onReady={props.onReady} />
    </Canvas>
  </div>;
}
