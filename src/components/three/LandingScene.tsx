// The welcome page's 3D backdrop (React Three Fiber), fixed behind every section.
//
// One particle system re-forms into a new shape for each chapter as the page scrolls:
//   0 stadium bowl (hero, finale)  1 broadcast waves (Watch live)  2 a bracket (Follow the tournament)
//   3 the shield, scanned line by line (Play fair)  4 a breathing orb that pulses while Arena AI "thinks"
//   5 a rolling wave field (the games)
// The extruded ArenaHub shield stands in the stadium in the hero and comes back for the finale.
//
// Scroll and pointer arrive through `landingSignal` (no React renders per frame). Loaded lazily by LandingBackdrop.
import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { CHAPTER_SHAPES, landingSignal } from '../auth/landing/landingSignal';
import { Environment, LOGO_SVG, useEmblemGeometry } from './ArenaStage';

const SHAPES = 6;
const rand = (seed: number) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function stadium(n: number, i: number): [number, number, number] {
  const tier = rand(i * 3.1);
  const r = 2.5 + tier * 3.1;
  const a = rand(i * 7.7) * Math.PI * 2;
  return [Math.cos(a) * r, -1.25 + Math.pow(tier, 1.4) * 1.9 + (rand(i * 1.3) - 0.5) * 0.08, Math.sin(a) * r];
}

function broadcast(n: number, i: number): [number, number, number] {
  const ring = Math.floor(rand(i * 5.3) * 11);
  const r = 0.5 + ring * 0.42 + (rand(i * 2.9) - 0.5) * 0.05;
  const a = rand(i * 9.1) * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r * 0.92, (rand(i * 4.4) - 0.5) * 0.25 - ring * 0.04];
}

/** Segments of a 16-team bracket, mirrored left and right, meeting at the final in the middle. */
function bracketSegments() {
  const segs: Array<[number, number, number, number]> = [];
  const xs = [4.6, 3.8, 3.0, 2.2, 1.4];
  for (const side of [-1, 1]) {
    let ys = Array.from({ length: 8 }, (_, k) => 2.8 - k * 0.8);
    for (let round = 0; round < 4; round += 1) {
      const x0 = xs[round] * side, x1 = xs[round + 1] * side;
      const next: number[] = [];
      for (let k = 0; k < ys.length; k += 2) {
        const a = ys[k], b = ys[k + 1], mid = (a + b) / 2;
        segs.push([x0, a, x1, a], [x0, b, x1, b], [x1, a, x1, b]);
        next.push(mid);
      }
      ys = next;
    }
    segs.push([xs[4] * side, 0, 0.55 * side, 0]);
  }
  return segs;
}

function sampler(segs: Array<[number, number, number, number]>) {
  const lengths = segs.map(([x0, y0, x1, y1]) => Math.hypot(x1 - x0, y1 - y0));
  const total = lengths.reduce((s, l) => s + l, 0);
  return (u: number) => {
    let d = u * total;
    for (let k = 0; k < segs.length; k += 1) {
      if (d <= lengths[k] || k === segs.length - 1) {
        const t = lengths[k] ? Math.min(1, d / lengths[k]) : 0;
        const [x0, y0, x1, y1] = segs[k];
        return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t] as const;
      }
      d -= lengths[k];
    }
    return [0, 0] as const;
  };
}

function shieldOutline() {
  const data = new SVGLoader().parse(LOGO_SVG);
  const s = 3.6 / 508;
  const pts: Array<[number, number]> = [];
  for (const shape of data.paths.flatMap(path => path.toShapes())) {
    for (const curve of [shape, ...shape.holes]) {
      for (const p of curve.getSpacedPoints(420)) pts.push([(p.x - 212) * s, -(p.y - 254) * s]);
    }
  }
  return pts;
}

function buildGeometry(count: number) {
  const geometry = new THREE.BufferGeometry();
  const bracket = sampler(bracketSegments());
  const shield = shieldOutline();
  const arrays = Array.from({ length: SHAPES }, () => new Float32Array(count * 3));
  const seeds = new Float32Array(count);
  const grid = Math.ceil(Math.sqrt(count * 1.6));
  for (let i = 0; i < count; i += 1) {
    const put = (k: number, v: readonly [number, number, number]) => arrays[k].set(v, i * 3);
    seeds[i] = rand(i * 0.37 + 1);
    put(0, stadium(count, i));
    put(1, broadcast(count, i));
    const [bx, by] = rand(i * 6.1) < 0.9 ? bracket(rand(i * 2.2)) : [Math.cos(i) * 0.5 * rand(i), Math.sin(i) * 0.5 * rand(i * 3)];
    put(2, [bx, by, (rand(i * 8.8) - 0.5) * 0.18]);
    const [sx, sy] = shield[Math.floor(rand(i * 4.7) * shield.length)];
    put(3, [sx + (rand(i * 1.9) - 0.5) * 0.05, sy + (rand(i * 2.6) - 0.5) * 0.05, (rand(i * 3.3) - 0.5) * 0.5]);
    // Fibonacci sphere, with a little depth in the shell.
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    const r = 1.75 * (0.94 + rand(i * 5.5) * 0.1);
    put(4, [Math.cos(phi) * ring * r, y * r, Math.sin(phi) * ring * r]);
    const gx = i % grid, gz = Math.floor(i / grid);
    put(5, [-8 + (gx / grid) * 16, -1.1, -7 + (gz / grid) * 9.5]);
  }
  arrays.forEach((array, k) => geometry.setAttribute(k === 0 ? 'position' : `p${k}`, new THREE.BufferAttribute(array, 3)));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
  return geometry;
}

const vertexShader = /* glsl */ `
  attribute vec3 p1; attribute vec3 p2; attribute vec3 p3; attribute vec3 p4; attribute vec3 p5;
  attribute float aSeed;
  uniform float uFrom, uTo, uMix, uTime, uPulse, uSize, uPixel;
  varying float vAlpha; varying float vHot;

  vec3 pick(float s) {
    if (s < .5) return position; if (s < 1.5) return p1; if (s < 2.5) return p2;
    if (s < 3.5) return p3; if (s < 4.5) return p4; return p5;
  }
  vec3 animate(vec3 p, float s) {
    if (s < .5) { float a = uTime * .05; p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz; }
    else if (s < 1.5) { float r = length(p.xy); float w = sin(uTime * 2.6 - r * 2.4); p.xy *= 1. + .07 * w; p.z += .18 * w; }
    else if (s < 2.5) { p.z += .06 * sin(uTime * 1.5 + p.x * 2.); }
    else if (s < 3.5) { float a = sin(uTime * .5) * .35; p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz; }
    else if (s < 4.5) {
      float a = uTime * .2; p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
      p *= 1. + .04 * sin(uTime * 1.6 + aSeed * 6.28) + uPulse * .22 * sin(uTime * 8. + aSeed * 18.);
    }
    else { p.y += .45 * sin(p.x * .7 + uTime * 1.1) * cos(p.z * .55 + uTime * .7); }
    return p;
  }
  float hot(vec3 p, float s) {
    if (s > 2.5 && s < 3.5) { float scan = sin(uTime * 1.2) * 2.; return exp(-pow((p.y - scan) * 3.5, 2.)); }
    if (s > 1.5 && s < 2.5) { float run = mod(uTime * 1.6, 6.) - 5.; return exp(-pow((abs(p.x) + run) * 2.2, 2.)) * step(.1, abs(p.x)); }
    if (s > 3.5 && s < 4.5) return uPulse * .6 * (.5 + .5 * sin(uTime * 10. + aSeed * 30.));
    return 0.;
  }
  void main() {
    float m = smoothstep(aSeed * .35, aSeed * .35 + .65, uMix);
    vec3 a = animate(pick(uFrom), uFrom);
    vec3 b = animate(pick(uTo), uTo);
    vec3 pos = mix(a, b, m);
    // Mid-flight, particles swirl out a little so the morph reads as motion, not a cross-fade.
    float flight = sin(m * 3.14159);
    pos += flight * vec3(sin(aSeed * 41.), cos(aSeed * 29.), sin(aSeed * 17.)) * 1.1;
    vHot = mix(hot(a, uFrom), hot(b, uTo), m);
    vAlpha = .5 + .5 * fract(aSeed * 13.7);
    vec4 mv = modelViewMatrix * vec4(pos, 1.);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixel * (.55 + fract(aSeed * 7.3) * .9) * (1. + vHot * 1.6) / -mv.z;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHot;
  varying float vAlpha; varying float vHot;
  void main() {
    float d = length(gl_PointCoord - .5);
    float a = smoothstep(.5, .05, d) * vAlpha;
    gl_FragColor = vec4(mix(uColor, uHot, clamp(vHot, 0., 1.)), a * (.75 + vHot));
  }
`;

function Particles({ color, count }: { color: string; count: number }) {
  const geometry = useMemo(() => buildGeometry(count), [count]);
  const { gl } = useThree();
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uFrom: { value: 0 }, uTo: { value: 0 }, uMix: { value: 0 }, uTime: { value: 0 }, uPulse: { value: 0 },
      uSize: { value: 24 }, uPixel: { value: gl.getPixelRatio() },
      uColor: { value: new THREE.Color(color) }, uHot: { value: new THREE.Color('#fff1e0') },
    },
  }), [color, gl]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const group = useRef<THREE.Group>(null);
  const smooth = useRef({ chapter: landingSignal.chapter, pulse: 0 });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = smooth.current;
    s.chapter += (landingSignal.chapter - s.chapter) * (1 - Math.exp(-dt * 4));
    s.pulse += (landingSignal.aiPulse - s.pulse) * (1 - Math.exp(-dt * 5));
    const last = CHAPTER_SHAPES.length - 1;
    const c = Math.min(last, Math.max(0, s.chapter));
    const i = Math.min(last - 1, Math.floor(c));
    const u = material.uniforms;
    u.uFrom.value = CHAPTER_SHAPES[i];
    u.uTo.value = CHAPTER_SHAPES[i + 1];
    u.uMix.value = c - i;
    u.uTime.value = state.clock.elapsedTime;
    u.uPulse.value = s.pulse;
    const g = group.current;
    if (g) {
      // In the hero the stadium sits to the right of the headline on wide screens.
      const wide = state.size.width > 900;
      const hero = Math.max(0, 1 - c);
      g.position.x = wide ? hero * 2.1 : 0;
      g.position.y = wide ? 0 : hero * 1.8;
      g.rotation.x += ((landingSignal.py * 0.12) - g.rotation.x) * 0.05;
      g.rotation.y += ((landingSignal.px * 0.22) - g.rotation.y) * 0.05;
    }
  });

  return <group ref={group}><points geometry={geometry} material={material} frustumCulled={false} /></group>;
}

function Emblem({ color }: { color: string }) {
  const geometry = useEmblemGeometry();
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({ color, metalness: 0.62, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.18, envMapIntensity: 1.2 }), [color]);
  useEffect(() => () => material.dispose(), [material]);
  const group = useRef<THREE.Group>(null);
  const weight = useRef(landingSignal.chapter < 1 ? 1 : 0);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const c = landingSignal.chapter;
    const last = CHAPTER_SHAPES.length - 1;
    const wide = state.size.width > 900;
    const finale = c > last - 1;
    // On phones the finale headline fills the screen, so the shield only returns on wide screens.
    const target = Math.max(0, 1 - c * 1.4) + (wide ? Math.max(0, (c - (last - 1)) * 1.4) : 0);
    weight.current += (Math.min(1, target) - weight.current) * (1 - Math.exp(-Math.min(delta, 0.05) * 5));
    const w = weight.current;
    const eased = 1 - Math.pow(1 - w, 3);
    g.visible = w > 0.01;
    // Hero (wide): beside the headline. Hero (phone): small, above it. Finale (wide): small, above the headline.
    const size = wide ? (finale ? 0.45 : 1.15) : 0.58;
    g.scale.setScalar(Math.max(0.0001, eased) * size);
    const y = wide ? (finale ? 1.8 : 0.05) : 2.6;
    g.position.set(wide && !finale ? 2.1 : 0, y + Math.sin(state.clock.elapsedTime * 1.2) * 0.06, 0);
    g.rotation.y = state.clock.elapsedTime * 0.35 + landingSignal.px * 0.6 + (1 - eased) * 2.5;
    g.rotation.x = -landingSignal.py * 0.15;
  });

  return <group ref={group}>
    <mesh geometry={geometry} material={material} castShadow />
  </group>;
}

function Rig() {
  useFrame(state => {
    const c = landingSignal.chapter;
    const cam = state.camera;
    const tx = Math.sin(c * 0.85) * 0.9 + landingSignal.px * 0.35;
    const ty = 1.1 + Math.cos(c * 0.7) * 0.35 - landingSignal.py * 0.25;
    const tz = state.size.width > 900 ? 7.4 : 9.6;
    cam.position.x += (tx - cam.position.x) * 0.05;
    cam.position.y += (ty - cam.position.y) * 0.05;
    cam.position.z += (tz - cam.position.z) * 0.05;
    cam.lookAt(0, 0.1, 0);
  });
  return null;
}

export interface LandingSceneProps {
  color: string;
  lite?: boolean;
  paused?: boolean;
  onReady?: () => void;
}

export default function LandingScene({ color, lite = false, paused = false, onReady }: LandingSceneProps) {
  return <Canvas
    className="lp-canvas"
    frameloop={paused ? 'never' : 'always'}
    dpr={lite ? [1, 1.4] : [1, 1.75]}
    camera={{ position: [0, 1.1, 7.4], fov: 42, near: 0.1, far: 60 }}
    gl={{ antialias: !lite, alpha: true, powerPreference: 'high-performance' }}
    onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); gl.toneMapping = THREE.ACESFilmicToneMapping; requestAnimationFrame(() => onReady?.()); }}
  >
    <Environment />
    <ambientLight intensity={0.35} />
    <directionalLight position={[3, 5, 4]} intensity={2.2} />
    <pointLight position={[-3, 1, 2]} intensity={14} color={color} distance={10} />
    <Particles color={color} count={lite ? 3600 : 7200} />
    <Emblem color={color} />
    <Rig />
  </Canvas>;
}
