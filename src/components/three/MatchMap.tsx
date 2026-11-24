import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { MapLane, TileState } from '../../lib/adminInsights';
import { StageBoundary, reducedMotion, saveData, webglAvailable } from './ArenaHero';
import type { MapPalette } from './MatchMapStage';

const MatchMapStage = lazy(() => import('./MatchMapStage'));

export const TILE_WORD: Record<TileState, string> = { done: 'Played', live: 'Live', alert: 'Needs attention', scheduled: 'Scheduled', pending: 'Time not set' };

/** Colours come from the design tokens, so the scene matches the rest of the page. */
function readPalette(): MapPalette {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    done: token('--brand', '#ff6600'),
    live: token('--live', '#e91916'),
    alert: token('--warning', '#facc15'),
    scheduled: token('--info', '#7cb4ff'),
    pending: token('--text-muted', '#a1a1aa'),
    floor: token('--surface-soft', '#1f1f23'),
    lane: token('--surface-elevated', '#2a2a2f'),
    label: token('--text-secondary', '#c9c9d1'),
  };
}

/**
 * The Overview's match map: a 3D scene of every published match (MatchMapStage), with a flat grid of the same
 * tiles underneath. The flat grid is what shows without WebGL, on data saver, or if the scene fails;
 * the 3D scene pauses when off screen or in a background tab, and holds still for reduced motion.
 */
export function MatchMap({ lanes, onSelect }: { lanes: MapLane[]; onSelect: (matchId: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [enabled] = useState(() => webglAvailable() && !saveData());
  const [still, setStill] = useState(reducedMotion);
  const [lite] = useState(() => window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 8) <= 4);
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const palette = useMemo(readPalette, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setStill(reducedMotion());
    const attrs = new MutationObserver(sync);
    attrs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    media.addEventListener('change', sync);
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? true), { rootMargin: '80px' });
    if (host.current) io.observe(host.current);
    return () => { attrs.disconnect(); media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', onVisibility); io.disconnect(); };
  }, []);

  const tiles = lanes.flatMap(lane => lane.tiles);
  const focus = tiles.find(tile => tile.id === hovered);
  const total = tiles.length;

  if (!lanes.length || !total) return <div className="ov-map is-empty"><p>Publish a bracket and its matches appear here as a 3D map.</p></div>;

  return <div ref={host} className={`ov-map${ready ? ' is-ready' : ''}${enabled ? ' is-interactive' : ''}`}>
    <div className="ov-map-flat" aria-label="Published matches by bracket" role="group" aria-hidden={ready || undefined} inert={ready}>
      {lanes.map(lane => <div className="ov-map-lane" key={lane.id}>
        <span>{lane.label}</span>
        <div>{lane.tiles.map(tile => <button type="button" key={tile.id} className={`ov-map-cell is-${tile.state}`} title={`${tile.label} · ${tile.detail}`}
          aria-label={`${tile.label}, ${tile.detail}`} onClick={() => onSelect(tile.id)} />)}</div>
      </div>)}
    </div>
    {enabled && <StageBoundary fallback={null}>
      <Suspense fallback={null}>
        <MatchMapStage lanes={lanes} palette={palette} still={still} lite={lite} paused={!inView || !visible}
          hovered={hovered} onHover={setHovered} onSelect={onSelect} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary>}
    <p className="ov-map-caption" aria-live="off">
      {focus ? <><strong>{focus.label}</strong><span className={`ov-tone-text is-${focus.state}`}>{focus.detail}</span></>
        : <span>{ready ? 'Point at a block to see the match. Click to open it, drag to turn the map.' : 'Each square is a match. Select one to open it.'}</span>}
    </p>
  </div>;
}
