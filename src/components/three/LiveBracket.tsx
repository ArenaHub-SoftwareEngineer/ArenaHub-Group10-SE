import React, { Suspense, lazy, useMemo, useRef, useState } from 'react';
import type { Match } from '../../lib/types';
import { layoutBracket } from '../../lib/bracketLayout';
import { matchName } from '../../lib/matchName';
import { StageBoundary } from './ArenaHero';
import { useStageGate, useStagePalette } from './useStageGate';
import type { StageSlab } from './LiveBracketStage';

const LiveBracketStage = lazy(() => import('./LiveBracketStage'));

const UNIT = 100;
const DIMS = { cardW: 180, cardH: 54, colGap: 70, rowStep: 70, pad: 20, headerH: 10, laneGap: 40, champW: 120, champH: 60 };

const isBye = (match: Match) => [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE');

/**
 * The chosen live bracket as a 3D board (LiveBracketStage). Without WebGL a flat drawing of the same layout shows.
 * Pointer-only: the match list beside it is the keyboard control for picking a match.
 */
export function LiveBracket({ matches, selected, flash, onSelect }: {
  matches: Match[]; selected: string | null; flash: { id: string; at: number } | null; onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const gate = useStageGate(host);
  const palette = useStagePalette();
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(() => layoutBracket(matches.filter(match => !match.inactive), DIMS), [matches]);

  const scene = useMemo(() => {
    const columns = [...new Set(layout.placed.map(p => p.x))].sort((a, b) => a - b);
    const slabs: StageSlab[] = layout.placed.map(p => {
      const m = p.match;
      const tone = isBye(m) ? palette.muted : m.status === 'live' ? palette.live : m.status === 'completed' ? palette.success : palette.brand;
      return {
        id: m.id, x: (p.x + DIMS.cardW / 2) / UNIT, y: -(p.y + DIMS.cardH / 2) / UNIT, column: columns.indexOf(p.x), tone, live: m.status === 'live',
        winner: m.status !== 'completed' ? 0 : m.winnerId && m.winnerId === m.team1?.id ? 1 : m.winnerId && m.winnerId === m.team2?.id ? 2 : 0,
      };
    });
    const links = layout.links.map(link => ({ from: link.from.match.id, to: link.to.match.id, lit: link.advanced }));
    const champion = layout.champion?.team ? { x: (layout.champion.x + DIMS.champW / 2) / UNIT, y: -(layout.champion.y + DIMS.champH / 2) / UNIT } : null;
    // Frame the matches themselves (and the champion once there is one), not the layout's empty margins.
    const xs = slabs.flatMap(s => [s.x - DIMS.cardW / 2 / UNIT, s.x + DIMS.cardW / 2 / UNIT]).concat(champion ? [champion.x + 0.4] : []);
    const ys = slabs.flatMap(s => [s.y - DIMS.cardH / 2 / UNIT, s.y + DIMS.cardH / 2 / UNIT]);
    const [minX, maxX, minY, maxY] = xs.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0, 1, -1, 0];
    return { slabs, links, champion, width: maxX - minX, height: maxY - minY, center: [(minX + maxX) / 2, (minY + maxY) / 2] as [number, number] };
  }, [layout, palette]);

  const focus = matches.find(match => match.id === (hovered ?? selected));

  return <div ref={host} className={`lbr-stage${ready ? ' is-ready' : ''}`} aria-hidden="true">
    <svg className="lbr-flat" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet">
      {layout.placed.map(p => <rect key={p.match.id} x={p.x} y={p.y} width={DIMS.cardW} height={DIMS.cardH} rx={10}
        className={`is-${p.match.status}${p.match.id === selected ? ' is-chosen' : ''}`} onClick={() => onSelect(p.match.id)} />)}
    </svg>
    {gate.enabled && <StageBoundary fallback={null} onError={() => setReady(false)}>
      <Suspense fallback={null}>
        <LiveBracketStage {...scene} slabW={(DIMS.cardW - 8) / UNIT} slabH={(DIMS.cardH - 6) / UNIT}
          palette={{ base: palette.surface, line: palette.muted, lit: palette.brand, live: palette.live, champion: palette.warning }}
          selected={selected} hovered={hovered} flash={flash} still={gate.still} lite={gate.lite} paused={gate.paused}
          onHover={setHovered} onSelect={onSelect} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary>}
    {focus && <div className="lbr-caption">
      <small>{matchName(focus)} · {focus.roundName}</small>
      <strong>{focus.team1?.name || 'TBD'} <b>{focus.score.team1Score}–{focus.score.team2Score}</b> {focus.team2?.name || 'TBD'}</strong>
    </div>}
  </div>;
}
