// Live screens 3D scene (React Three Fiber): each match is a floating monitor in a shallow arc. Matches with players
// sharing glow in the brand colour, show how many are live and bob gently; hover brings a monitor forward and turns it
// to face you; click opens that match's wall. Text is painted on a canvas texture (no font loader needed).
// Loaded lazily by ScreenDeck.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

export interface DeckScreen { key: string; title: string; game: string; when: string; sharing: number; seats: number; live: boolean }
export interface DeckColors { brand: string; live: string; success: string; surface: string; floor: string; text: string; muted: string }
export interface ScreenDeckStageProps {
  screens: DeckScreen[]; colors: DeckColors; hovered: string | null;
  still?: boolean; lite?: boolean; paused?: boolean;
  onHover?: (key: string | null) => void; onSelect?: (key: string) => void; onReady?: () => void;
}

const W = 2.1, H = W * 9 / 16;

/** A soft round glow (white centre fading out), tinted by the material colour. Shared by every monitor. */
let glowTexture: THREE.CanvasTexture | null = null;
function softGlow() {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number) {
  const words = text.split(/\s+/), out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { out.push(line); line = word; } else line = next;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && words.join(' ') !== out.join(' ')) {
    let last = out[lines - 1];
    while (ctx.measureText(last + '…').width > width && last.length > 1) last = last.slice(0, -1);
    out[lines - 1] = last + '…';
  }
  return out;
}

/** The monitor's picture: game, match title, and how many players are sharing. */
function screenTexture(screen: DeckScreen, colors: DeckColors) {
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 432;
  const ctx = canvas.getContext('2d')!;
  const on = screen.sharing > 0;
  const g = ctx.createLinearGradient(0, 0, 768, 432);
  g.addColorStop(0, on ? '#1d0f05' : '#141417'); g.addColorStop(1, on ? '#3a1a06' : '#1d1d22');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 768, 432);
  // Faint scan lines, so a lit screen reads as a screen.
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < 432; y += 6) ctx.fillRect(0, y, 768, 2);
  const font = '"Google Sans Flex", "Google Sans", system-ui, sans-serif';
  ctx.fillStyle = on ? colors.brand : colors.muted;
  ctx.font = `600 30px ${font}`;
  ctx.fillText(screen.game.toUpperCase(), 40, 66);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 50px ${font}`;
  wrap(ctx, screen.title, 688, 3).forEach((line, i) => ctx.fillText(line, 40, 140 + i * 60));
  // Status line.
  ctx.font = `600 32px ${font}`;
  if (on) {
    ctx.fillStyle = colors.live; ctx.beginPath(); ctx.arc(54, 382, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(screen.seats ? `${screen.sharing} of ${screen.seats} sharing` : `${screen.sharing} sharing`, 80, 393);
  } else {
    ctx.fillStyle = colors.muted;
    ctx.fillText(screen.live ? 'Live · nobody sharing yet' : screen.when, 40, 393);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function Monitor({ screen, index, count, colors, hovered, still, onHover, onSelect }: {
  screen: DeckScreen; index: number; count: number; colors: DeckColors; hovered: boolean; still: boolean;
  onHover?: (key: string | null) => void; onSelect?: (key: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  const on = screen.sharing > 0;
  const texture = useMemo(() => screenTexture(screen, colors), [screen, colors]);
  const frameMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: on ? '#26160b' : colors.surface, roughness: 0.35, metalness: 0.5, clearcoat: 0.6 }), [on, colors.surface]);
  const screenMat = useMemo(() => new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), [texture]);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: colors.brand, map: softGlow(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), [colors.brand]);
  useEffect(() => () => { texture.dispose(); frameMat.dispose(); screenMat.dispose(); glowMat.dispose(); }, [texture, frameMat, screenMat, glowMat]);

  // Up to four in one arc; more go to a second row behind.
  const perRow = Math.min(count, 4), row = Math.floor(index / perRow), col = index % perRow;
  const inRow = Math.min(perRow, count - row * perRow);
  const offset = col - (inRow - 1) / 2;
  const home = new THREE.Vector3(offset * (W + 0.32), row ? 1.45 : 0, -Math.abs(offset) * 0.35 - row * 1.4);
  const turn = -offset * 0.2;
  const born = useRef(still ? 1 : 0);

  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    const t = frame.clock.elapsedTime;
    if (born.current < 1) born.current = Math.min(1, born.current + delta * 1.6 - index * 0.002);
    const e = 1 - Math.pow(1 - Math.max(0, born.current - index * 0.08), 3);
    const k = Math.min(1, delta * 7);
    const bob = still || !on ? 0 : Math.sin(t * 1.6 + index) * 0.05;
    g.position.x += (home.x - g.position.x) * k;
    g.position.y += (home.y + bob + (hovered ? 0.12 : 0) - (1 - e) * 1.2 - g.position.y) * k;
    g.position.z += (home.z + (hovered ? 0.7 : 0) - g.position.z) * k;
    g.rotation.y += ((hovered ? 0 : turn) - g.rotation.y) * k;
    g.scale.setScalar(Math.max(0.001, e));
    if (glow.current) {
      const target = on ? (still ? 0.35 : 0.3 + Math.sin(t * 2.4 + index) * 0.12) + (hovered ? 0.2 : 0) : hovered ? 0.18 : 0;
      glowMat.opacity += (target - glowMat.opacity) * k;
    }
  });

  return <group ref={group} position={[home.x, home.y - 1.2, home.z]}
    onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover?.(screen.key); document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { onHover?.(null); document.body.style.cursor = ''; }}
    onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); document.body.style.cursor = ''; onSelect?.(screen.key); }}>
    <mesh ref={glow} position={[0, 0, -0.08]} material={glowMat}><planeGeometry args={[W * 1.9, H * 2.2]} /></mesh>
    <mesh material={frameMat} castShadow><boxGeometry args={[W + 0.12, H + 0.12, 0.1]} /></mesh>
    <mesh material={screenMat} position={[0, 0, 0.052]}><planeGeometry args={[W, H]} /></mesh>
    {/* Stand. */}
    <mesh material={frameMat} position={[0, -H / 2 - 0.2, -0.02]}><boxGeometry args={[0.12, 0.34, 0.06]} /></mesh>
  </group>;
}

function Rig({ still }: { still: boolean }) {
  const { camera, pointer } = useThree();
  useFrame((_, delta) => {
    if (still) return;
    const k = Math.min(1, delta * 2.5);
    camera.position.x += (pointer.x * 0.6 - camera.position.x) * k;
    camera.position.y += (0.5 + pointer.y * 0.25 - camera.position.y) * k;
    camera.lookAt(0, 0.25, -0.6);
  });
  return null;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => onReady?.()); } });
  return null;
}

export default function ScreenDeckStage(props: ScreenDeckStageProps) {
  const { screens, colors, hovered, still = false, lite = false, paused = false, onHover, onSelect, onReady } = props;
  const rows = screens.length > 4 ? 2 : 1;
  const wide = Math.min(screens.length, 4);
  // Pull the camera back so every monitor fits.
  const distance = Math.max(4.4, wide * 1.32 + (rows - 1) * 1.6);
  return <div className="sd-canvas">
    <Canvas
      frameloop={paused ? 'demand' : 'always'}
      dpr={lite ? [1, 1.5] : [1, 2]}
      shadows={!lite}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 34, near: 0.1, far: 40, position: [0, 0.5, distance] }}
      onCreated={({ gl, camera }) => { gl.toneMapping = THREE.NeutralToneMapping; camera.lookAt(0, 0.25, -0.6); }}
      onPointerMissed={() => onHover?.(null)}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 6]} intensity={1.6} color="#fff1e2" castShadow={!lite} />
      <pointLight position={[0, -1.4, 2]} intensity={10} color={colors.brand} distance={9} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.25, -1]} receiveShadow>
        <circleGeometry args={[9, 48]} />
        <meshStandardMaterial color={colors.floor} roughness={0.9} transparent opacity={0.55} />
      </mesh>
      {screens.map((screen, index) => <Monitor key={screen.key} screen={screen} index={index} count={screens.length} colors={colors}
        hovered={hovered === screen.key} still={still} onHover={onHover} onSelect={onSelect} />)}
      <Rig still={still} />
      <FirstFrame onReady={onReady} />
    </Canvas>
  </div>;
}
