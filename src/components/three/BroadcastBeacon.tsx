import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { StageBoundary, reducedMotion, saveData, webglAvailable } from './ArenaHero';
import type { BeaconMode, BeaconPalette } from './BroadcastBeaconStage';

const BroadcastBeaconStage = lazy(() => import('./BroadcastBeaconStage'));

/**
 * The 3D broadcast status beacon (BroadcastBeaconStage). Decorative and hidden from assistive technology; the wizard
 * states the status in text. Falls back to a CSS beacon without WebGL or on data saver; pauses off screen.
 */
export function BroadcastBeacon({ mode }: { mode: BeaconMode }) {
  const host = useRef<HTMLDivElement>(null);
  const [enabled] = useState(() => webglAvailable() && !saveData());
  const [still] = useState(reducedMotion);
  const [inView, setInView] = useState(true);
  const [ready, setReady] = useState(false);
  const palette = useMemo<BeaconPalette>(() => {
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { idle: token('--text-muted', '#a1a1aa'), ready: token('--brand', '#ff6600'), live: token('--live', '#e91916'), base: token('--surface-elevated', '#2a2a2f') };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? true));
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);

  const fallback = <span className={`bw-beacon-css is-${mode}`}><i /><i /><i /></span>;
  return <div ref={host} className={`bw-beacon is-${mode}${ready ? ' is-ready' : ''}`} aria-hidden="true">
    {enabled ? <StageBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <BroadcastBeaconStage mode={mode} palette={palette} still={still} paused={!inView} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary> : fallback}
  </div>;
}
