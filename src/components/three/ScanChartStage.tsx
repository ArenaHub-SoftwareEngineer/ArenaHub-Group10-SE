import React, { useLayoutEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MathUtils, type Group } from 'three';
import { SCAN_SERIES, type ScanCounts } from '../../lib/monitorScanCounts';

function Bars({ values, maximum, still }: { values: ScanCounts[]; maximum: number; still: boolean }) {
  const { size, invalidate } = useThree();
  const plot = useRef<Group>(null);
  const cell = size.width / values.length;
  const width = Math.min(cell * .53, 58);
  const depth = width * .4;

  useLayoutEffect(() => {
    if (plot.current) plot.current.scale.y = still ? 1 : .02;
    invalidate();
  }, [invalidate, still]);

  useFrame((state, delta) => {
    const scale = plot.current?.scale;
    if (!scale || scale.y === 1) return;
    const next = MathUtils.damp(scale.y, 1, 12, delta);
    scale.y = next > .996 ? 1 : next;
    if (scale.y < 1) state.invalidate();
  });

  return <group ref={plot} position={[0, -size.height / 2, 0]}>
    {values.map((counts, index) => {
      let base = 0;
      const x = (index + .5) * cell - size.width / 2;
      return <group key={index} position={[x, 0, 0]} rotation={[0, -.53, 0]}>
        {SCAN_SERIES.map(({ key, color }) => {
          const height = counts[key] / maximum * size.height;
          const y = base + height / 2;
          base += height;
          return height > 0 && <mesh key={key} position={[0, y, 0]}>
            <boxGeometry args={[width, Math.max(.5, height - Math.min(height / 4, .8)), depth]} />
            <meshStandardMaterial color={color} roughness={.86} />
          </mesh>;
        })}
      </group>;
    })}
  </group>;
}

export default function ScanChartStage({ values, maximum, still }: { values: ScanCounts[]; maximum: number; still: boolean }) {
  return <Canvas orthographic camera={{ position: [0, 0, 220], near: .1, far: 460 }} dpr={[1, 1.5]}
    frameloop="demand" gl={{ alpha: true, antialias: true }}>
    <ambientLight intensity={.9} />
    <directionalLight position={[-75, 95, 100]} intensity={1.55} />
    <Bars values={values} maximum={maximum} still={still} />
  </Canvas>;
}
