// The 3D arena stage (React Three Fiber): the ArenaHub shield, extruded from the logo's own SVG path, standing on
// a lit pedestal under two sweeping stadium beams, with embers rising through the air.
//
// Interaction: the emblem turns toward the pointer; drag sideways to spin it (it keeps its momentum and settles
// back to face the viewer); tap or click for a pulse. Vertical swipes still scroll the page on phones.
//
// Loaded lazily by ArenaHero, so three.js is only downloaded when a scene is actually shown.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 424 508"><path fill="#ff6600" fill-rule="evenodd" d="
M212 0 288 18V134L340 179V30L424 51V315C424 372 366 425 212 508C58 425 0 372 0 315V51L84 30V179L136 134V18Z
M20 67 40 61V368Q20 343 20 315Z M384 61 404 67V315Q404 343 384 368Z
M195 144H229Q239 144 244 156L276 234Q282 251 296 251H314Q329 251 332 267L346 338Q350 356 334 356H295Q282 356 278 343L262 305Q256 289 243 289H181
Q168 289 162 305L146 343Q142 356 129 356H90Q74 356 78 338L92 267Q95 251 110 251H128Q142 251 148 234L180 156Q185 144 195 144Z M212 190 188 251H236Z"/></svg>`;

export interface ArenaStageProps {
  /** Brand colour for the emblem and the pedestal ring. */
  color?: string;
  /** No idle motion (reduced motion): one still, lit frame that still answers to a drag. */
  still?: boolean;
  /** Fewer particles and a lower pixel ratio. */
  lite?: boolean;
  /** Pause rendering (off screen, hidden tab). */
  paused?: boolean;
  /** Called once the first frame is on screen, so the poster can fade out. */
  onReady?: () => void;
}

/** Shared interaction state, written by DOM pointer events and read every frame. */
type Drive = { spin: number; velocity: number; dragging: boolean; lastX: number; moved: number; pulse: number; px: number; py: number };

function useEmblemGeometry() {
  return useMemo(() => {
    const data = new SVGLoader().parse(LOGO_SVG);
    const shapes = data.paths.flatMap(path => SVGLoader.createShapes(path));
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 46, bevelEnabled: true, bevelThickness: 7, bevelSize: 4, bevelSegments: 5, curveSegments: 18 });
    geometry.center();
    // SVG y points down; flip it, then scale the 424 x 508 logo to about 2 units tall.
    const s = 2.05 / 508;
    geometry.scale(s, -s, s);
    geometry.computeVertexNormals();
    return geometry;
  }, []);
}

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

function Emblem({ color, still, drive }: { color: string; still: boolean; drive: React.MutableRefObject<Drive> }) {
  const geometry = useEmblemGeometry();
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const wave = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({
    color, metalness: 0.62, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.18, envMapIntensity: 1.15,
  }), [color]);
  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false }), [color]);
  const waveMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), [color]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); ringMaterial.dispose(); waveMaterial.dispose(); }, [geometry, material, ringMaterial, waveMaterial]);

  useFrame((state, delta) => {
    const d = drive.current;
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;
    // Momentum from a drag, with friction; when it settles the emblem eases back to face the viewer.
    if (!d.dragging) {
      d.spin += d.velocity * dt;
      d.velocity *= Math.pow(0.04, dt);
      if (Math.abs(d.velocity) < 0.25) {
        const home = Math.round(d.spin / (Math.PI * 2)) * Math.PI * 2;
        d.spin += (home - d.spin) * (1 - Math.pow(0.02, dt));
      }
    }
    const idle = still ? 0 : Math.sin(t * 0.45) * 0.28;
    const targetY = d.spin + idle + d.px * 0.45;
    const targetX = -d.py * 0.18 + (still ? 0 : Math.sin(t * 0.7) * 0.03);
    g.rotation.y += (targetY - g.rotation.y) * (1 - Math.pow(0.0005, dt));
    g.rotation.x += (targetX - g.rotation.x) * (1 - Math.pow(0.001, dt));
    g.position.y = 1.32 + (still ? 0 : Math.sin(t * 1.1) * 0.06);
    // Tap pulse: a springy swell and a shockwave across the floor.
    d.pulse = Math.max(0, d.pulse - dt * 1.4);
    const p = d.pulse;
    const swell = 1 + Math.sin((1 - p) * Math.PI) * p * 0.12;
    g.scale.setScalar(swell);
    if (wave.current) {
      const r = 1 + (1 - p) * 5;
      wave.current.scale.set(r, r, r);
      waveMaterial.opacity = p * 0.55;
    }
    if (ring.current) ringMaterial.opacity = 0.75 + Math.sin(t * 2) * (still ? 0 : 0.12) + p * 0.25;
  });

  return <>
    <group ref={group} position={[0, 1.32, 0]}>
      <mesh geometry={geometry} material={material} castShadow />
    </group>
    {/* Pedestal: a dark drum with a lit brand ring. */}
    <mesh position={[0, 0.09, 0]} receiveShadow>
      <cylinderGeometry args={[1.55, 1.7, 0.18, 96]} />
      <meshStandardMaterial color="#141418" metalness={0.4} roughness={0.55} />
    </mesh>
    <mesh ref={ring} position={[0, 0.185, 0]} rotation={[-Math.PI / 2, 0, 0]} material={ringMaterial}>
      <ringGeometry args={[1.47, 1.53, 128]} />
    </mesh>
    <mesh ref={wave} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waveMaterial}>
      <ringGeometry args={[0.98, 1, 128]} />
    </mesh>
  </>;
}

/** Floor grid that fades out with distance (the scene fog does the fading). */
function Floor() {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(60, 60, '#3a3a42', '#26262c');
    const mat = helper.material as THREE.LineBasicMaterial;
    mat.transparent = true;
    mat.opacity = 0.55;
    return helper;
  }, []);
  useEffect(() => () => { grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); }, [grid]);
  return <>
    <primitive object={grid} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
      <planeGeometry args={[60, 60]} />
      <shadowMaterial opacity={0.45} />
    </mesh>
  </>;
}

/** Two stadium beams sweeping slowly across the stage. */
function Beams({ still }: { still: boolean }) {
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fff4e8', transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(state => {
    if (still) return;
    const t = state.clock.elapsedTime;
    if (left.current) left.current.rotation.z = -0.42 + Math.sin(t * 0.35) * 0.12;
    if (right.current) right.current.rotation.z = 0.42 + Math.sin(t * 0.35 + 1.7) * 0.12;
  });
  return <>
    <mesh ref={left} position={[-2.3, 4.4, -2.6]} rotation={[0, 0, -0.42]} material={material}>
      <coneGeometry args={[0.95, 8, 48, 1, true]} />
    </mesh>
    <mesh ref={right} position={[2.3, 4.4, -2.6]} rotation={[0, 0, 0.42]} material={material}>
      <coneGeometry args={[0.95, 8, 48, 1, true]} />
    </mesh>
  </>;
}

/** Embers drifting up through the light. */
function Embers({ count, color, still }: { count: number; color: string; still: boolean }) {
  const points = useRef<THREE.Points>(null);
  const { geometry, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 1.2 + Math.random() * 5.5, a = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * 6;
      positions[i * 3 + 2] = Math.sin(a) * r - 1.5;
      speeds[i] = 0.12 + Math.random() * 0.35;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return { geometry, speeds };
  }, [count]);
  const material = useMemo(() => new THREE.PointsMaterial({ color, size: 0.035, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }), [color]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame((_, delta) => {
    if (still || !points.current) return;
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      array[i * 3 + 1] += speeds[i] * Math.min(delta, 1 / 20);
      if (array[i * 3 + 1] > 6) array[i * 3 + 1] = 0;
    }
    attr.needsUpdate = true;
  });
  return <points ref={points} geometry={geometry} material={material} />;
}

function Rig() {
  const { camera, size } = useThree();
  useEffect(() => {
    // Narrow screens: step back so the whole emblem and pedestal stay in frame.
    const narrow = size.width / size.height < 1;
    camera.position.set(0, narrow ? 2.3 : 2.05, narrow ? 9.4 : 7.6);
    camera.lookAt(0, 1.05, 0);
  }, [camera, size.width, size.height]);
  return null;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => onReady?.()); } });
  return null;
}

export default function ArenaStage({ color = '#ff6600', still = false, lite = false, paused = false, onReady }: ArenaStageProps) {
  const drive = useRef<Drive>({ spin: 0, velocity: 0, dragging: false, lastX: 0, moved: 0, pulse: 0, px: 0, py: 0 });
  const host = useRef<HTMLDivElement>(null);

  // Pointer handling on the DOM element: drag to spin, tap to pulse, hover to aim. Touch keeps vertical scroll.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const d = drive.current;
    const aim = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      d.px = ((e.clientX - r.left) / r.width) * 2 - 1;
      d.py = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const down = (e: PointerEvent) => { d.dragging = true; d.lastX = e.clientX; d.moved = 0; d.velocity = 0; el.setPointerCapture?.(e.pointerId); };
    const move = (e: PointerEvent) => {
      aim(e);
      if (!d.dragging) return;
      const dx = e.clientX - d.lastX;
      d.lastX = e.clientX;
      d.moved += Math.abs(dx);
      d.spin += dx * 0.012;
      d.velocity = dx * 0.75;
    };
    const up = (e: PointerEvent) => {
      if (!d.dragging) return;
      d.dragging = false;
      if (d.moved < 6) d.pulse = 1;
      el.releasePointerCapture?.(e.pointerId);
    };
    const leave = () => { if (!d.dragging) { d.px = 0; d.py = 0; } };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);

  return <div ref={host} className="ah-stage-canvas">
    <Canvas
      frameloop={paused ? 'never' : 'always'}
      dpr={lite ? [1, 1.5] : [1, 1.75]}
      shadows
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 32, near: 0.1, far: 60, position: [0, 2, 6.4] }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.fog = new THREE.Fog('#08080a', 7, 22);
      }}
    >
      <Rig />
      <Environment />
      <ambientLight intensity={0.25} />
      <directionalLight position={[3.5, 6, 4]} intensity={2.2} color="#fff1e2" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-near={1} shadow-camera-far={20} />
      <pointLight position={[-3, 2.5, -2.5]} intensity={18} color="#7cb4ff" distance={12} />
      <pointLight position={[0, 0.6, 2.2]} intensity={6} color={color} distance={5} />
      <Floor />
      <Beams still={still} />
      <Embers count={lite ? 90 : 220} color="#ffb27a" still={still} />
      <Emblem color={color} still={still} drive={drive} />
      <FirstFrame onReady={onReady} />
    </Canvas>
  </div>;
}
