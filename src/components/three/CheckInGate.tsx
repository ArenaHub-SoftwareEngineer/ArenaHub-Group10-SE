import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { StageBoundary, reducedMotion, saveData, webglAvailable } from './ArenaHero';
import type { GateMode, GatePalette } from './CheckInGateStage';

const CheckInGateStage = lazy(() => import('./CheckInGateStage'));

/**
 * The 3D check-in gate (CheckInGateStage) behind the anti-cheat check-in poster. Decorative and hidden from assistive
 * technology; the page says the same in text. Falls back to a CSS arch without WebGL or on data saver; pauses off screen.
 */
export function CheckInGate({ mode, passed = 0, total = 0 }: { mode: GateMode; passed?: number; total?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [enabled] = useState(() => webglAvailable() && !saveData());
  const [still] = useState(reducedMotion);
  const [inView, setInView] = useState(true);
  const [ready, setReady] = useState(false);
  const palette = useMemo<GatePalette>(() => {
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { brand: token('--brand', '#ff6600'), test: token('--warning', '#facc15'), pass: token('--success', '#4ade80'), idle: token('--text-muted', '#a1a1aa'), base: token('--surface-elevated', '#2a2a2f') };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? true));
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);

  const fallback = <span className={`acp-gate-css is-${mode}`}><i /></span>;
  return <div ref={host} className={`acp-gate is-${mode}${ready ? ' is-ready' : ''}`} aria-hidden="true">
    {enabled ? <StageBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <CheckInGateStage mode={mode} palette={palette} passed={passed} total={total} still={still} paused={!inView} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary> : fallback}
  </div>;
}
