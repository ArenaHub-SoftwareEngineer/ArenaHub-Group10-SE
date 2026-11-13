import React, { useRef, useState } from 'react';
import { Check, Maximize2, Minus, Plus, Radio, Trophy } from '../ui/Icons';
import { bracketScheduleLabel } from '../../lib/calendar';
import { Match } from '../../lib/types';
import { TournamentStageBoard } from '../common/TournamentStageBoard';

interface Props {
  rounds: Match[][];
  broadcast?: { selectedMatchId: string; schedule: (match: Match) => string };
  onSelectMatch: (match: Match) => void;
}

const CARD_W = 264;
const CARD_H = 138;
const COL_GAP = 112;
const ROW_STEP = 156;
const PAD = 36;

export const TournamentBracketCanvas: React.FC<Props> = ({ rounds, onSelectMatch, broadcast }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (rounds.flat().some(match => match.tournamentFormat)) return <TournamentStageBoard matches={rounds.flat()} onSelectMatch={onSelectMatch} />;

  const cardHeight = CARD_H;
  const matchCenter = (round: number, index: number) =>
    PAD + cardHeight / 2 + ((2 ** round - 1) * ROW_STEP) / 2 + index * 2 ** round * ROW_STEP;
  const size = {
    width: PAD * 2 + rounds.length * CARD_W + Math.max(0, rounds.length - 1) * COL_GAP,
    height: Math.max(broadcast ? 240 : 500, ...rounds.map((round, index) => matchCenter(index, Math.max(0, round.length - 1)) + cardHeight / 2 + PAD)),
  };

  const reset = () => {
    setZoom(1);
    viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  };

  return (
    <section className="stage overflow-hidden rounded-2xl border border-[var(--border)] bg-(--bg-base) shadow-[0_22px_70px_rgba(0,0,0,.24)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-(--text-primary)">Tournament bracket</h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{broadcast ? 'Scroll or drag to explore. Select a match to manage its broadcast.' : 'Drag to explore. Select a live match to open it.'}</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1">
          <button onClick={() => setZoom((v) => Math.max(.65, +(v - .1).toFixed(2)))} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/[.08] hover:text-(--text-primary)" aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
          <span className="w-12 text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((v) => Math.min(1.35, +(v + .1).toFixed(2)))} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/[.08] hover:text-(--text-primary)" aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-[var(--border)]" />
          <button onClick={reset} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/[.08] hover:text-(--text-primary)" aria-label="Reset view"><Maximize2 className="h-4 w-4" /></button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`relative ${broadcast ? 'stream-canvas-viewport' : 'h-[610px]'} overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,.055)_1px,transparent_0)] [background-size:22px_22px] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
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
        <div style={{ width: size.width * zoom, height: size.height * zoom }}>
          <div className="relative origin-top-left" style={{ width: size.width, height: size.height, transform: `scale(${zoom})` }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${size.width} ${size.height}`} fill="none" aria-hidden="true">
              {rounds.slice(0, -1).flatMap((round, r) => round.map((match, i) => {
                const linkedIndex = rounds[r + 1].findIndex(candidate => candidate.id === match.nextMatchId);
                if (linkedIndex === -1) return null;
                const startX = PAD + r * (CARD_W + COL_GAP) + CARD_W;
                const targetX = PAD + (r + 1) * (CARD_W + COL_GAP);
                const elbowX = startX + COL_GAP / 2;
                const targetIndex = linkedIndex;
                const advanced = match.status === 'completed' || Boolean(match.winnerId) || match.team2?.isBye;
                return <path key={`${match.id}-path`} d={`M ${startX} ${matchCenter(r, i)} H ${elbowX} V ${matchCenter(r + 1, targetIndex)} H ${targetX}`} stroke={advanced ? 'var(--brand)' : 'var(--border-strong)'} strokeWidth={advanced ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" opacity={advanced ? .82 : .72} />;
              }))}
            </svg>

            {rounds.map((round, r) => (
              <React.Fragment key={`round-${r}`}>
                <div className="absolute flex items-center gap-2" style={{ left: PAD + r * (CARD_W + COL_GAP), top: 14, width: CARD_W }}>
                  <span className={`text-xs font-semibold ${r === rounds.length - 1 ? 'text-[var(--brand)]' : 'text-[var(--text-secondary)]'}`}>{round[0]?.roundName || `Round ${r + 1}`}</span>
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-xs text-[var(--text-muted)]">{round[0]?.matchFormat ?? 'Bo3'}</span>
                </div>

                {round.map((match, i) => {
                  const firstBye = Boolean(match.team1?.name === 'BYE' || match.team1?.isBye);
                  const secondBye = Boolean(match.team2?.name === 'BYE' || match.team2?.isBye);
                  const bye = firstBye || secondBye;
                  const live = match.status === 'live';
                  const locked = !broadcast && !live && !bye;
                  const lockedMessage = match.status === 'completed' ? 'Match has ended' : 'Match is not live yet';
                  const final = /^(grand\s*)?final$/i.test(match.roundName?.trim() || '');
                  const selected = (broadcast?.selectedMatchId ?? selectedId) === match.id;
                  return (
                    <button
                      key={match.id}
                      type="button"
                      disabled={bye}
                      aria-disabled={locked || undefined}
                      aria-pressed={!locked ? selected : undefined}
                      title={locked ? lockedMessage : undefined}
                      onClick={() => {
                        if (locked) return;
                        setSelectedId(match.id);
                        onSelectMatch(match);
                      }}
                      data-live={live}
                      className={`viewer-bracket-match absolute overflow-hidden rounded-xl border text-left shadow-lg transition-all duration-150 ${selected ? (broadcast ? 'border-[var(--brand)] ring-2 ring-(color:--brand)/40' : 'border-white/70 ring-2 ring-white/10') : live ? 'border-[var(--brand)]' : final ? 'border-[var(--brand)]/55' : 'border-[var(--border)]'} ${bye ? 'cursor-default bg-(--surface)' : 'bg-[var(--surface)] hover:-translate-y-0.5 hover:border-white/35 hover:bg-[var(--surface-soft)] hover:shadow-xl'}`}
                      style={{ left: PAD + r * (CARD_W + COL_GAP), top: matchCenter(r, i) - cardHeight / 2, width: CARD_W, height: cardHeight }}
                    >
                      <div className="flex h-8 items-center justify-between border-b border-[var(--border)] px-3 text-xs text-[var(--text-muted)]">
                        <span>{match.matchNumber}</span>
                        {bye ? <span>Automatic advance</span> : live ? <span className="flex items-center gap-1 font-semibold text-[var(--brand-hover)]"><Radio className="h-3 w-3" /> Live</span> : match.status === 'completed' ? <span>Final</span> : broadcast ? <span>{match.streamUrl ? 'Broadcast linked' : match.status.replace('-', ' ')}</span> : <span>Upcoming</span>}
                      </div>
                      <div className="stream-canvas-time">{bye ? 'Advanced by BYE' : broadcast?.schedule(match) ?? bracketScheduleLabel(match)}</div>
                      <TeamRow seed={match.team1?.seed} name={match.team1?.name || (r ? 'Awaiting winner' : 'Unassigned')} score={bye ? undefined : match.score.team1Score} winner={Boolean(match.team1 && match.winnerId === match.team1.id) || secondBye} muted={firstBye} />
                      <TeamRow seed={match.team2?.seed} name={secondBye ? 'BYE' : match.team2?.name || (r ? 'Awaiting winner' : 'Unassigned')} score={bye ? undefined : match.score.team2Score} winner={Boolean(match.team2 && match.winnerId === match.team2.id) || firstBye} muted={secondBye} />

                      {locked && <span className="viewer-match-lock-note">{lockedMessage}</span>}
                      {final && <Trophy className="pointer-events-none absolute right-2 top-9 h-14 w-14 text-[var(--brand)] opacity-[.035]" />}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

function TeamRow({ seed, name, score, winner, muted = false }: { seed?: number; name: string; score?: number; winner: boolean; muted?: boolean }) {
  return (
    <div className={`flex h-10 items-center gap-2 px-3 ${muted ? 'text-[var(--text-muted)]' : winner ? 'text-(--text-primary)' : 'text-[var(--text-secondary)]'}`}>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[.06] text-xs tabular-nums text-[var(--text-muted)]">{seed ?? '–'}</span>
      <span className={`min-w-0 flex-1 truncate text-xs ${winner ? 'font-semibold' : 'font-medium'}`}>{name}</span>
      {winner && <Check className="h-3.5 w-3.5 text-[var(--brand)]" strokeWidth={2.5} />}
      {score !== undefined && <span className={`w-5 text-right text-sm font-semibold tabular-nums ${winner ? 'text-(--text-primary)' : 'text-[var(--text-muted)]'}`}>{score}</span>}
    </div>
  );
}
