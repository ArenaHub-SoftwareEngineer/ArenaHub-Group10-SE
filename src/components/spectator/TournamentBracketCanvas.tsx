import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Maximize2, Minus, Plus, Radio } from '../ui/Icons';
import { bracketScheduleLabel } from '../../lib/calendar';
import { Match } from '../../lib/types';
import { CARD_H, CARD_W, CHAMP_H, CHAMP_W, COL_GAP, layoutBracket } from '../../lib/bracketLayout';
import { CollegeLogo } from '../common/CollegeLogo';

interface Props {
  rounds: Match[][];
  broadcast?: { selectedMatchId: string; schedule: (match: Match) => string };
  onSelectMatch: (match: Match) => void;
}

/**
 * The viewer's bracket, the same look for every format: single and double elimination (with paths), round robin
 * and Swiss (rounds as columns), all ending in a Champion card. Layout comes from lib/bracketLayout.ts.
 * Drag to pan, zoom with the buttons; a live match opens its watch page.
 */
export const TournamentBracketCanvas: React.FC<Props> = ({ rounds, onSelectMatch, broadcast }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const matches = useMemo(() => rounds.flat(), [rounds]);
  const layout = useMemo(() => layoutBracket(matches), [matches]);
  const byId = useMemo(() => new Map(matches.map(match => [match.id, match])), [matches]);
  const format = matches.find(match => match.tournamentFormat)?.tournamentFormat;
  const title = format === 'double-elimination' || layout.laneLabels.length ? 'Upper, lower and finals'
    : format === 'round-robin' ? 'Round robin' : format === 'swiss' ? 'Swiss rounds' : 'Tournament bracket';

  const sourceLabel = (match: Match, side: 0 | 1) => {
    const source = match.sources?.[side];
    if (!source) return undefined;
    return `${source.result === 'winner' ? 'Winner' : 'Loser'} of ${byId.get(source.matchId)?.matchNumber || 'an earlier match'}`;
  };
  // Open zoomed to fit the width, so the whole path and the Champion card are in view (never below 55%).
  const fitZoom = () => {
    const width = viewportRef.current?.clientWidth;
    return width ? Math.max(.55, Math.min(1, +((width - 8) / layout.width).toFixed(2))) : 1;
  };
  useLayoutEffect(() => { setZoom(fitZoom()); }, [layout.width]);
  const reset = () => { setZoom(fitZoom()); viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' }); };

  return (
    <section className="stage bracket-canvas overflow-hidden rounded-2xl border border-[var(--border)] bg-(--bg-base)">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-(--text-primary)">{title}</h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{broadcast ? 'Scroll or drag to explore. Select a match to manage its broadcast.'
            : layout.mode === 'rounds' ? 'Every team meets each opponent in turn. Drag to explore; rankings are in Standings.'
            : 'Drag to explore. Select a live match to open it.'}</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1">
          <button onClick={() => setZoom((v) => Math.max(.5, +(v - .1).toFixed(2)))} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/[.08] hover:text-(--text-primary)" aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
          <span className="w-12 text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((v) => Math.min(1.35, +(v + .1).toFixed(2)))} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/[.08] hover:text-(--text-primary)" aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-[var(--border)]" />
          <button onClick={reset} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/[.08] hover:text-(--text-primary)" aria-label="Reset view"><Maximize2 className="h-4 w-4" /></button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`bracket-canvas-viewport relative ${broadcast ? 'stream-canvas-viewport' : 'h-[640px]'} overflow-auto ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={(e) => {
          if (!viewportRef.current || (e.target as HTMLElement).closest('button')) return;
          dragRef.current = { x: e.clientX, y: e.clientY, left: viewportRef.current.scrollLeft, top: viewportRef.current.scrollTop };
          setDragging(true);
        }}
        onMouseMove={(e) => {
          if (!dragRef.current || !viewportRef.current) return;
          viewportRef.current.scrollLeft = dragRef.current.left - (e.clientX - dragRef.current.x);
          viewportRef.current.scrollTop = dragRef.current.top - (e.clientY - dragRef.current.y);
        }}
        onMouseUp={() => { dragRef.current = null; setDragging(false); }}
        onMouseLeave={() => { dragRef.current = null; setDragging(false); }}
      >
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${layout.width} ${layout.height}`} fill="none" aria-hidden="true">
              {layout.links.map(({ from, to, advanced }) => {
                const startX = from.x + CARD_W, targetX = to.x;
                const elbowX = targetX - COL_GAP / 2;
                return <path key={`${from.match.id}-${to.match.id}`} d={`M ${startX} ${from.y} H ${elbowX} V ${to.y} H ${targetX}`}
                  stroke={advanced ? 'var(--brand)' : 'var(--border-strong)'} strokeWidth={advanced ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" opacity={advanced ? .85 : .72} />;
              })}
              {layout.champion?.from && <path d={`M ${layout.champion.from.x + CARD_W} ${layout.champion.from.y} H ${layout.champion.x}`}
                stroke={layout.champion.team ? 'var(--brand)' : 'var(--border-strong)'} strokeWidth={layout.champion.team ? 2 : 1.5} strokeDasharray={layout.champion.team ? undefined : '4 6'} strokeLinecap="round" />}
            </svg>

            {layout.laneLabels.map(label => <span key={label.lane} className="bracket-lane-label" style={{ left: 36, top: label.y }}>{label.title}</span>)}

            {layout.headers.map(header => <div key={`${header.lane}-${header.x}-${header.y}`} className="absolute flex items-center gap-2" style={{ left: header.x, top: header.y, width: CARD_W }}>
              <span className={`text-xs font-semibold ${header.final ? 'text-[var(--brand)]' : 'text-[var(--text-secondary)]'}`}>{header.title}</span>
              <span className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-xs text-[var(--text-muted)]">{header.format}</span>
            </div>)}

            {layout.placed.map(({ match, x, y, lane }) => {
              const firstBye = Boolean(match.team1?.name === 'BYE' || match.team1?.isBye);
              const secondBye = Boolean(match.team2?.name === 'BYE' || match.team2?.isBye);
              const bye = firstBye || secondBye;
              const live = match.status === 'live';
              const ifNeeded = Boolean(match.inactive);
              const locked = !broadcast && !live && !bye;
              const lockedMessage = ifNeeded ? 'Played only if needed' : match.status === 'completed' ? 'Match has ended' : 'Match is not live yet';
              const final = lane === 'final' || layout.headers.some(h => h.final && h.x === x && h.lane === lane);
              const selected = (broadcast?.selectedMatchId ?? selectedId) === match.id;
              return (
                <button
                  key={match.id}
                  type="button"
                  disabled={bye || ifNeeded}
                  aria-disabled={locked || undefined}
                  aria-pressed={!locked ? selected : undefined}
                  title={locked ? lockedMessage : undefined}
                  onClick={() => { if (locked) return; setSelectedId(match.id); onSelectMatch(match); }}
                  data-live={live}
                  className={`viewer-bracket-match absolute overflow-hidden rounded-xl border text-left transition-all duration-150 ${ifNeeded ? 'is-if-needed' : ''} ${selected ? (broadcast ? 'border-[var(--brand)] ring-2 ring-(color:--brand)/40' : 'border-white/70 ring-2 ring-white/10') : live ? 'border-[var(--brand)]' : final ? 'border-[var(--brand)]/55' : 'border-[var(--border)]'} ${bye || ifNeeded ? 'cursor-default bg-(--surface)' : 'bg-[var(--surface)] hover:-translate-y-0.5 hover:border-white/35 hover:bg-[var(--surface-soft)]'}`}
                  style={{ left: x, top: y - CARD_H / 2, width: CARD_W, height: CARD_H }}
                >
                  <div className="flex h-8 items-center justify-between border-b border-[var(--border)] px-3 text-xs text-[var(--text-muted)]">
                    <span>{match.matchNumber}</span>
                    {ifNeeded ? <span>If needed</span> : bye ? <span>Automatic advance</span> : live ? <span className="flex items-center gap-1 font-semibold text-[var(--brand-hover)]"><Radio className="h-3 w-3" /> Live</span> : match.status === 'completed' ? <span>Final</span> : broadcast ? <span>{match.streamUrl ? 'Broadcast linked' : match.status.replace('-', ' ')}</span> : <span>Upcoming</span>}
                  </div>
                  <div className="stream-canvas-time">{bye ? 'Advanced by BYE' : ifNeeded ? 'Only if the lower-bracket team wins' : broadcast?.schedule(match) ?? bracketScheduleLabel(match)}</div>
                  <TeamRow seed={match.team1?.seed} name={match.team1?.name || sourceLabel(match, 0) || 'Awaiting winner'} sub={match.team1?.name ? sourceLabel(match, 0) : undefined}
                    score={bye ? undefined : match.score.team1Score} winner={Boolean(match.team1 && match.winnerId === match.team1.id) || secondBye} muted={firstBye || !match.team1?.name} />
                  <TeamRow seed={match.team2?.seed} name={secondBye ? 'BYE' : match.team2?.name || sourceLabel(match, 1) || 'Awaiting winner'} sub={match.team2?.name && !secondBye ? sourceLabel(match, 1) : undefined}
                    score={bye ? undefined : match.score.team2Score} winner={Boolean(match.team2 && match.winnerId === match.team2.id) || firstBye} muted={secondBye || !match.team2?.name} />
                  {locked && <span className="viewer-match-lock-note">{lockedMessage}</span>}
                </button>
              );
            })}

            {layout.champion && <ChampionCard x={layout.champion.x} y={layout.champion.y} name={layout.champion.team?.name} code={layout.champion.team?.collegeCode}
              byStandings={layout.champion.byStandings} />}
          </div>
        </div>
      </div>
    </section>
  );
};

/** The end of every bracket: a trophy, then the champion once the deciding result is saved. */
function ChampionCard({ x, y, name, code, byStandings }: { x: number; y: number; name?: string; code?: string; byStandings: boolean }) {
  const reduced = Boolean(useReducedMotion()) || document.documentElement.dataset.motion === 'reduced';
  const decided = Boolean(name);
  return <div className={`bracket-champion${decided ? ' is-decided' : ''}`} style={{ left: x, top: y - CHAMP_H / 2, width: CHAMP_W, height: CHAMP_H }}>
    <motion.div className="bracket-champion-trophy" aria-hidden="true"
      animate={decided && !reduced ? { y: [0, -4, 0] } : undefined} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}>
      <TrophyArt decided={decided} />
    </motion.div>
    <span className="bracket-champion-label">{byStandings ? 'Champion · by standings' : 'Champion'}</span>
    {decided ? <strong className="bracket-champion-name">{code && <CollegeLogo code={code} size="sm" />}<span>{name}</span></strong>
      : <span className="bracket-champion-tbd">{byStandings ? 'Decided when every match is played' : 'To be decided'}</span>}
  </div>;
}

/** A drawn trophy in the brand colour; outlined until there is a champion. */
function TrophyArt({ decided }: { decided: boolean }) {
  return <svg viewBox="0 0 64 64" width="64" height="64">
    <defs>
      <linearGradient id="trophy-cup" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--brand-hover)" /><stop offset="1" stopColor="var(--brand)" />
      </linearGradient>
    </defs>
    <path d="M18 10h28v10c0 9-6 16-14 16s-14-7-14-16V10Z" fill={decided ? 'url(#trophy-cup)' : 'none'} stroke={decided ? 'none' : 'var(--border-strong)'} strokeWidth="2" />
    <path d="M18 14H9v4c0 6 4 10 10 10M46 14h9v4c0 6-4 10-10 10" fill="none" stroke={decided ? 'var(--brand)' : 'var(--border-strong)'} strokeWidth="3" strokeLinecap="round" />
    <path d="M28 36h8v8h-8z" fill={decided ? 'var(--brand)' : 'var(--border-strong)'} />
    <path d="M20 50c0-3 3-6 6-6h12c3 0 6 3 6 6v4H20v-4Z" fill={decided ? 'var(--brand)' : 'none'} stroke={decided ? 'none' : 'var(--border-strong)'} strokeWidth="2" />
    {decided && <path d="M26 16c0 6 2 10 5 12" stroke="rgb(255 255 255 / .45)" strokeWidth="2.5" strokeLinecap="round" fill="none" />}
  </svg>;
}

function TeamRow({ seed, name, sub, score, winner, muted = false }: { seed?: number; name: string; sub?: string; score?: number; winner: boolean; muted?: boolean }) {
  return (
    <div className={`flex h-10 items-center gap-2 px-3 ${muted ? 'text-[var(--text-muted)]' : winner ? 'text-(--text-primary)' : 'text-[var(--text-secondary)]'}`}>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[.06] text-xs tabular-nums text-[var(--text-muted)]">{seed ?? '–'}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className={`block truncate text-xs ${winner ? 'font-semibold' : 'font-medium'}`}>{name}</span>
        {sub && <span className="block truncate text-xs text-[var(--text-muted)]">{sub}</span>}
      </span>
      {winner && <Check className="h-3.5 w-3.5 text-[var(--brand)]" strokeWidth={2.5} />}
      {score !== undefined && <span className={`w-5 text-right text-sm font-semibold tabular-nums ${winner ? 'text-(--text-primary)' : 'text-[var(--text-muted)]'}`}>{score}</span>}
    </div>
  );
}
