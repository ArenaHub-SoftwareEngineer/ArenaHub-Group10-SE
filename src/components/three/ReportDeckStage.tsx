// Reports page 3D scene (React Three Fiber). Every open report is a card in a fanned carousel, coloured by its type.
// The selected card sits forward and floats; neighbours fan out behind it. Click a card to select it, or drag sideways
// to flip through the deck. A resolved card flies up and fades out while the rest slide into place.
// With nothing to review the deck turns into a green shield with a check mark that slowly turns.
//
// Loaded lazily by ReportDeck, so three.js is only downloaded when the scene is shown.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { StagePalette } from './useStageGate';

export interface DeckCard { id: string; color: string; kind: string; author: string; snippet: string; flags: number }

export interface ReportDeckStageProps {
  cards: DeckCard[];
  selectedId: string | null;
  palette: StagePalette;
  still?: boolean;
  lite?: boolean;
  paused?: boolean;
  onSelect?: (id: string) => void;
  onStep?: (delta: 1 | -1) => void;
  onReady?: () => void;
}

const W = 1.7, H = 1.06, R = 0.1;

function roundedShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
const slab = new THREE.ExtrudeGeometry(roundedShape(W, H, R), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
slab.translate(0, 0, -0.03);
const face = new THREE.PlaneGeometry(W - 0.02, H - 0.02);

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number) {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { out.push(line); line = word; } else line = next;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = `${out[lines - 1].replace(/\s*\S*$/, '')}…`;
  return out.slice(0, lines);
}

/** The printed face of a card: type word, quoted message and author, drawn once into a texture. */
function useCardFace(card: DeckCard, palette: StagePalette) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 680; c.height = 424;
    const ctx = c.getContext('2d')!;
    const family = '"Google Sans Flex", system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = palette.surface;
    ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, 36); ctx.fill();
    // A soft wash of the type colour from the top, never an edge bar.
    const wash = ctx.createLinearGradient(0, 0, 0, c.height * 0.8);
    wash.addColorStop(0, card.color); wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.28; ctx.fillStyle = wash; ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, 36); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = card.color; ctx.font = `1000 64px ${family}`; ctx.textBaseline = 'top';
    ctx.fillText(card.kind.toUpperCase(), 40, 38);
    if (card.flags > 1) {
      ctx.font = `800 30px ${family}`;
      const tag = `${card.flags}x`;
      const tw = ctx.measureText(tag).width + 32;
      ctx.fillStyle = card.color; ctx.beginPath(); ctx.roundRect(c.width - tw - 36, 44, tw, 48, 24); ctx.fill();
      ctx.fillStyle = '#111114'; ctx.fillText(tag, c.width - tw - 20, 53);
    }
    ctx.fillStyle = palette.text; ctx.font = `600 36px ${family}`;
    wrap(ctx, `“${card.snippet}”`, c.width - 80, 3).forEach((line, i) => ctx.fillText(line, 40, 140 + i * 50));
    ctx.fillStyle = palette.muted; ctx.font = `700 30px ${family}`;
    ctx.fillText(card.author.length > 30 ? `${card.author.slice(0, 29)}…` : card.author, 40, c.height - 72);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    return map;
  }, [card.color, card.kind, card.author, card.snippet, card.flags, palette]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

type Drive = { dragging: boolean; lastX: number; moved: number; acc: number };

function Card({ card, slot, leaving, palette, still, drive, onSelect }: {
  card: DeckCard; slot: number; leaving: boolean; palette: StagePalette; still: boolean;
  drive: React.MutableRefObject<Drive>; onSelect?: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const map = useCardFace(card, palette);
  const body = useMemo(() => new THREE.MeshPhysicalMaterial({ color: card.color, metalness: 0.1, roughness: 0.35, clearcoat: 0.6, transparent: true, emissive: new THREE.Color(card.color), emissiveIntensity: 0.12 }), [card.color]);
  const front = useMemo(() => new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false }), [map]);
  useEffect(() => () => { body.dispose(); front.dispose(); }, [body, front]);
  const [hover, setHover] = useState(false);
  const life = useRef(leaving || still ? 1 : 0);
  const out = useRef(0);
  const seed = useMemo(() => Math.random() * 10, []);

  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    const k = Math.min(1, delta * 7);
    const t = frame.clock.elapsedTime;
    const d = slot;
    const ad = Math.abs(d);
    const sign = Math.sign(d);
    let x = ad === 0 ? 0 : sign * (1.15 + (ad - 1) * 0.5);
    let y = ad === 0 && !still ? Math.sin(t * 1.4 + seed) * 0.05 : -ad * 0.04;
    let z = ad === 0 ? 0.7 : -ad * 0.55;
    let rotY = -Math.max(-3, Math.min(3, d)) * 0.42;
    let s = ad === 0 ? 1.06 : 0.92 - Math.min(ad, 4) * 0.04;
    let opacity = ad > 4 ? 0 : 1 - Math.max(0, ad - 2) * 0.3;
    if (hover && ad !== 0) { y += 0.1; s += 0.03; }
    if (leaving) {
      out.current = Math.min(1, out.current + delta * 1.8);
      y = 1.8 * out.current; z = 0.9 + out.current; rotY = 0; s = 1.06 - out.current * 0.3; opacity = 1 - out.current;
    }
    // Cards rise into place the first time they appear.
    if (life.current < 1) life.current = Math.min(1, life.current + delta * (still ? 99 : 2.4));
    const intro = 1 - Math.pow(1 - life.current, 3);
    g.position.x += (x - g.position.x) * k;
    g.position.y += ((y - (1 - intro) * 1.2) - g.position.y) * k;
    g.position.z += (z - g.position.z) * k;
    g.rotation.y += (rotY - g.rotation.y) * k;
    g.rotation.x += ((ad === 0 && !still ? Math.sin(t * 0.9 + seed) * 0.04 : 0) - g.rotation.x) * k;
    const sc = g.scale.x + (s - g.scale.x) * k;
    g.scale.setScalar(sc);
    const op = opacity * intro;
    front.opacity += (op - front.opacity) * k;
    body.opacity = front.opacity;
    body.emissiveIntensity += ((ad === 0 ? 0.28 : hover ? 0.22 : 0.08) - body.emissiveIntensity) * k;
    g.visible = front.opacity > 0.02;
  });

  const over = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (leaving) return; setHover(true); document.body.style.cursor = 'pointer'; };
  const leave = () => { setHover(false); document.body.style.cursor = ''; };
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (!leaving && drive.current.moved < 8) onSelect?.(card.id); };
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return <group ref={group} position={leaving ? [0, 0, 0.7] : [slot * 1.2, -1.2, -1]} scale={leaving ? 1.06 : 0.9}>
    <mesh geometry={slab} material={body} onPointerOver={over} onPointerOut={leave} onClick={click} castShadow />
    <mesh geometry={face} material={front} position={[0, 0, 0.035]} />
  </group>;
}

/** A shield with a check mark: the "all clear" state. */
function Shield({ palette, still }: { palette: StagePalette; still: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.95);
    s.bezierCurveTo(0.32, 0.84, 0.58, 0.8, 0.78, 0.78);
    s.lineTo(0.78, 0.12);
    s.bezierCurveTo(0.78, -0.42, 0.42, -0.78, 0, -0.98);
    s.bezierCurveTo(-0.42, -0.78, -0.78, -0.42, -0.78, 0.12);
    s.lineTo(-0.78, 0.78);
    s.bezierCurveTo(-0.58, 0.8, -0.32, 0.84, 0, 0.95);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 4, curveSegments: 24 });
    g.center();
    return g;
  }, []);
  const check = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.44, 0.04); s.lineTo(-0.3, -0.1); s.lineTo(-0.1, 0.1 - 0.2); s.lineTo(0.34, 0.38); s.lineTo(0.48, 0.24);
    s.lineTo(-0.1, -0.34); s.lineTo(-0.44, 0.04);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 3 });
    g.translate(0, 0.02, 0.15);
    return g;
  }, []);
  useEffect(() => () => { geometry.dispose(); check.dispose(); }, [geometry, check]);
  const grow = useRef(still ? 1 : 0);
  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    const t = frame.clock.elapsedTime;
    if (grow.current < 1) grow.current = Math.min(1, grow.current + delta * 1.6);
    const e = 1 - Math.pow(1 - grow.current, 4);
    g.scale.setScalar(0.4 + e * 0.6);
    g.rotation.y = still ? -0.35 : Math.sin(t * 0.6) * 0.5 + (1 - e) * 3;
    g.position.y = still ? 0 : Math.sin(t * 1.2) * 0.06;
    if (ringA.current) ringA.current.rotation.z = still ? 0.4 : t * 0.4;
    if (ringB.current) ringB.current.rotation.z = still ? -0.6 : -t * 0.25;
  });
  return <group position={[0, 0, 0.3]}>
    <group ref={group}>
      <mesh geometry={geometry} castShadow>
        <meshPhysicalMaterial color={palette.success} metalness={0.25} roughness={0.28} clearcoat={0.8} emissive={palette.success} emissiveIntensity={0.18} />
      </mesh>
      <mesh geometry={check}>
        <meshPhysicalMaterial color="#f5fff8" metalness={0.1} roughness={0.25} clearcoat={1} />
      </mesh>
    </group>
    <mesh ref={ringA} rotation={[Math.PI / 2.4, 0, 0]} position={[0, -0.1, -0.2]}>
      <torusGeometry args={[1.45, 0.012, 8, 120]} />
      <meshBasicMaterial color={palette.success} transparent opacity={0.45} toneMapped={false} />
    </mesh>
    <mesh ref={ringB} rotation={[Math.PI / 2.2, 0.3, 0]} position={[0, -0.1, -0.2]}>
      <torusGeometry args={[1.8, 0.008, 8, 120]} />
      <meshBasicMaterial color={palette.success} transparent opacity={0.25} toneMapped={false} />
    </mesh>
  </group>;
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      if (disposed) return;
      const pmrem = new THREE.PMREMGenerator(gl);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      cleanup = () => { scene.environment = null; env.dispose(); pmrem.dispose(); };
    });
    return () => { disposed = true; cleanup(); };
  }, [gl, scene]);
  return null;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => onReady?.()); } });
  return null;
}

function Rig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const narrow = size.width / size.height < 1.25;
    camera.position.set(0, 0.35, narrow ? 5.4 : 4.1);
    camera.lookAt(0, 0, 0);
  }, [camera, size.width, size.height]);
  return null;
}

export default function ReportDeckStage({ cards, selectedId, palette, still = false, lite = false, paused = false, onSelect, onStep, onReady }: ReportDeckStageProps) {
  const host = useRef<HTMLDivElement>(null);
  const drive = useRef<Drive>({ dragging: false, lastX: 0, moved: 0, acc: 0 });
  const step = useRef(onStep);
  step.current = onStep;

  // Cards that just left the queue stay a moment so they can fly away.
  const [leaving, setLeaving] = useState<DeckCard[]>([]);
  const previous = useRef<DeckCard[]>(cards);
  useEffect(() => {
    const ids = new Set(cards.map(card => card.id));
    const gone = previous.current.filter(card => !ids.has(card.id));
    previous.current = cards;
    if (!gone.length || still) return;
    setLeaving(list => [...list, ...gone]);
    const timer = window.setTimeout(() => setLeaving(list => list.filter(card => !gone.includes(card))), 900);
    return () => window.clearTimeout(timer);
  }, [cards, still]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const d = drive.current;
    const down = (e: PointerEvent) => { d.dragging = true; d.lastX = e.clientX; d.moved = 0; d.acc = 0; };
    const move = (e: PointerEvent) => {
      if (!d.dragging) return;
      const dx = e.clientX - d.lastX;
      d.lastX = e.clientX; d.moved += Math.abs(dx); d.acc += dx;
      if (Math.abs(d.acc) > 70) { step.current?.(d.acc < 0 ? 1 : -1); d.acc = 0; }
    };
    const up = () => { d.dragging = false; };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('pointerleave', up);
    };
  }, []);

  const selectedIndex = Math.max(0, cards.findIndex(card => card.id === selectedId));

  return <div ref={host} className="adp-stage-canvas">
    <Canvas
      frameloop={paused ? 'demand' : 'always'}
      dpr={lite ? [1, 1.5] : [1, 2]}
      shadows={!lite}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 38, near: 0.1, far: 40, position: [0, 0.35, 4.1] }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; gl.toneMappingExposure = 1; }}
    >
      <Rig />
      <Environment />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} color="#fff1e2" castShadow={!lite} />
      <pointLight position={[-4, 1, 2]} intensity={10} color={palette.brand} distance={10} />
      {cards.length === 0 && !leaving.length
        ? <Shield palette={palette} still={still} />
        : <>
          {cards.map((card, index) => <Card key={card.id} card={card} slot={index - selectedIndex} leaving={false} palette={palette} still={still} drive={drive} onSelect={onSelect} />)}
          {leaving.map(card => <Card key={`out-${card.id}`} card={card} slot={0} leaving palette={palette} still={still} drive={drive} />)}
        </>}
      <FirstFrame onReady={onReady} />
    </Canvas>
  </div>;
}
