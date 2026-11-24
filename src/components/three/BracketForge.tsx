import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { Match } from '../../lib/types';
import { StageBoundary, reducedMotion, saveData, webglAvailable } from './ArenaHero';
import type { ForgePalette, ForgeShape } from './BracketForgeStage';

const BracketForgeStage = lazy(() => import('./BracketForgeStage'));

/** The shape to draw: matches per round of the main (or upper) lane; a tree for elimination formats. */
export function forgeShape(matches: Match[]): ForgeShape {
  // Double elimination: draw the upper lane (its finals sit apart). Single elimination: every round, final included.
  const double = matches.some(match => match.bracketType === 'lower');
  const main = matches.filter(match => !match.inactive && (!double || (match.bracketType !== 'lower' && match.bracketType !== 'final')));
  const rounds = [...new Set(main.map(match => match.round))].sort((a, b) => a - b).map(round => main.filter(match => match.round === round).length);
  const format = matches.find(match => match.tournamentFormat)?.tournamentFormat;
  return { rounds, tree: format !== 'round-robin' && format !== 'swiss' };
}

/**
 * The bracket Arena AI just built, assembling in 3D (BracketForgeStage). Decorative: the numbers beside it say the
 * same thing in text. Shows nothing without WebGL or on data saver; holds still for reduced motion; pauses off screen.
 */
export function BracketForge({ matches }: { matches: Match[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [enabled] = useState(() => webglAvailable() && !saveData());
  const [still] = useState(reducedMotion);
  const [inView, setInView] = useState(true);
  const [ready, setReady] = useState(false);
  const shape = useMemo(() => forgeShape(matches), [matches]);
  const palette = useMemo<ForgePalette>(() => {
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { node: token('--surface-elevated', '#2a2a2f'), accent: token('--brand', '#ff6600'), line: token('--brand', '#ff6600'), champion: token('--warning', '#facc15') };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? true));
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);

  if (!enabled || !shape.rounds.length) return null;
  return <div ref={host} className={`aid-forge${ready ? ' is-ready' : ''}`} aria-hidden="true">
    <StageBoundary fallback={null}>
      <Suspense fallback={null}>
        <BracketForgeStage shape={shape} palette={palette} still={still} paused={!inView} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary>
  </div>;
}
