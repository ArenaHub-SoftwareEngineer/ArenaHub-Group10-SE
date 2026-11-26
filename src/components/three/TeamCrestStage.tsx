// Teams page 3D scene (React Three Fiber): the college's logo struck on a metal medallion.
// The medallion floats and sways, tilts toward the pointer, a light band sweeps across its face every few seconds,
// and a ring of sparks in the college colour orbits it. A new logo (spinKey changes) flips the coin once.
// Loaded lazily by TeamCrest; without WebGL the flat crest shows instead.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface TeamCrestStageProps {
  logo?: string;
  monogram: string;
  color: string;
  spinKey: number;
  still?: boolean;
  lite?: boolean;
  paused?: boolean;
  onReady?: () => void;
}

const R = 1.25, DEPTH = 0.2, FACE = 1024;

/** The face artwork: a dark enamel disc, a fine ring in the college colour, then the logo (or the college code). */
function useFaceTexture(logo: string | undefined, monogram: string, color: string) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = FACE;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  useEffect(() => {
    let live = true;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const c = FACE / 2;
    const paint = (image?: HTMLImageElement) => {
      if (!live) return;
      ctx.clearRect(0, 0, FACE, FACE);
      const bg = ctx.createRadialGradient(c * 0.8, c * 0.7, 40, c, c, c);
      bg.addColorStop(0, '#2c2c33');
      bg.addColorStop(1, '#101014');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, FACE, FACE);
      if (image) {
        // The logo fills the face edge to edge (cover); the disc trims the corners, the rings sit on top.
        const box = FACE;
        const scale = Math.max(box / image.width, box / image.height);
        const w = image.width * scale, h = image.height * scale;
        ctx.save();
        ctx.beginPath(); ctx.arc(c, c, c * 0.93, 0, Math.PI * 2); ctx.clip();
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, c - w / 2, c - h / 2, w, h);
        ctx.restore();
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(c, c, c * 0.93, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = image ? 0 : 0.3;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c, c, c * 0.84, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      if (!image) {
        ctx.fillStyle = '#f4f4f6';
        ctx.font = `900 ${monogram.length > 3 ? 210 : 270}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(monogram, c, c + 14);
      }
      texture.needsUpdate = true;
    };
    if (!logo) paint();
    else {
      const image = new Image();
      image.onload = () => paint(image);
      image.onerror = () => paint();
      image.src = logo;
    }
    return () => { live = false; };
  }, [texture, logo, monogram, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** A soft diagonal band of light that crosses the face, clipped to the disc. */
function Shine({ still }: { still: boolean }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPhase: { value: -1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uPhase;
      void main(){
        vec2 p = vUv - 0.5;
        if (length(p) > 0.5) discard;
        float d = (p.x + p.y) * 0.7071 - uPhase;
        float band = exp(-d * d * 90.0) * 0.55 + exp(-d * d * 900.0) * 0.5;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * band, band);
      }`,
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    // A sweep lasts ~0.9 s and repeats every 3.6 s; it parks off the disc in between.
    const t = (clock.elapsedTime % 3.6) / 0.9;
    material.uniforms.uPhase.value = still ? -1 : t < 1 ? -0.8 + t * 1.6 : -1;
  });
  return <mesh position={[0, 0, DEPTH / 2 + 0.004]} material={material}><circleGeometry args={[R * 0.985, 96]} /></mesh>;
}

function Sparks({ color, still, lite }: { color: string; still: boolean; lite: boolean }) {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const count = lite ? 70 : 150;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = R * (1.22 + Math.random() * 0.35);
      positions.set([Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.6], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [lite]);
  const material = useMemo(() => new THREE.PointsMaterial({ color, size: 0.035, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }), [color]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame((_, delta) => { if (points.current && !still) points.current.rotation.z += delta * 0.18; });
  return <points ref={points} geometry={geometry} material={material} />;
}

function Medallion({ logo, monogram, color, spinKey, still = false, lite = false }: TeamCrestStageProps) {
  const group = useRef<THREE.Group>(null);
  const coin = useRef<THREE.Group>(null);
  const spin = useRef({ key: spinKey, from: 0, at: 1 });
  const { pointer } = useThree();
  const face = useFaceTexture(logo, monogram, color);
  const materials = useMemo(() => {
    const metal = new THREE.MeshPhysicalMaterial({ color, metalness: 0.85, roughness: 0.28, clearcoat: 0.6 });
    const front = new THREE.MeshPhysicalMaterial({ map: face, metalness: 0.15, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12 });
    return { metal, front };
  }, [color, face]);
  useEffect(() => () => { materials.metal.dispose(); materials.front.dispose(); }, [materials]);

  useFrame(({ clock }, delta) => {
    const g = group.current, c = coin.current;
    if (!g || !c) return;
    const t = clock.elapsedTime;
    if (spin.current.key !== spinKey) spin.current = { key: spinKey, from: c.rotation.y, at: 0 };
    if (spin.current.at < 1) {
      spin.current.at = Math.min(1, spin.current.at + delta / 1.1);
      const e = 1 - Math.pow(1 - spin.current.at, 4);
      c.rotation.y = spin.current.from * (1 - e) + Math.PI * 2 * e;
      if (spin.current.at === 1) c.rotation.y = 0;
    } else if (!still) c.rotation.y = Math.sin(t * 0.55) * 0.32;
    g.position.y = still ? 0 : Math.sin(t * 1.1) * 0.06;
    const k = Math.min(1, delta * 4);
    g.rotation.x += ((still ? 0 : -pointer.y * 0.35) - g.rotation.x) * k;
    g.rotation.z += ((still ? 0 : -pointer.x * 0.06) - g.rotation.z) * k;
    g.rotation.y += ((still ? 0 : pointer.x * 0.4) - g.rotation.y) * k;
  });

  return <group ref={group}>
    <group ref={coin}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={materials.metal} castShadow={!lite}>
        <cylinderGeometry args={[R, R, DEPTH, 96, 1]} />
      </mesh>
      {/* The face is its own disc: a circle's UVs keep the logo upright, a cylinder cap's turn it a quarter. */}
      <mesh position={[0, 0, DEPTH / 2 + 0.002]} material={materials.front}><circleGeometry args={[R, 96]} /></mesh>
      <mesh position={[0, 0, DEPTH / 2]} material={materials.metal}><torusGeometry args={[R, 0.055, 16, 120]} /></mesh>
      <mesh position={[0, 0, -DEPTH / 2]} material={materials.metal}><torusGeometry args={[R, 0.055, 16, 120]} /></mesh>
      <Shine still={still} />
    </group>
    <Sparks color={color} still={still} lite={lite} />
  </group>;
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let cleanup = () => {};
    let live = true;
    void import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      if (!live) return;
      const pmrem = new THREE.PMREMGenerator(gl);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      cleanup = () => { scene.environment = null; env.dispose(); pmrem.dispose(); };
    });
    return () => { live = false; cleanup(); };
  }, [gl, scene]);
  return null;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; requestAnimationFrame(() => onReady?.()); } });
  return null;
}

export default function TeamCrestStage(props: TeamCrestStageProps) {
  const { lite = false, paused = false } = props;
  return <div className="adp-stage-canvas">
    <Canvas
      frameloop={paused ? 'demand' : 'always'}
      dpr={lite ? [1, 1.5] : [1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 30, near: 0.1, far: 30, position: [0, 0, 6.4] }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}
    >
      <Environment />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 4, 5]} intensity={1.6} color="#fff1e2" />
      <pointLight position={[-3, -2, 3]} intensity={6} color="#7cb4ff" distance={12} />
      <Medallion {...props} />
      <FirstFrame onReady={props.onReady} />
    </Canvas>
  </div>;
}
