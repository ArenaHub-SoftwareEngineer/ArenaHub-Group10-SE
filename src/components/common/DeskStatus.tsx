// Tournament desk status: a step tracker (what is done, what to do next) and a live bracket strip that recolours
// as soon as a published bracket changes. Both are plain data in, so TournamentOperations stays the single source.
import React, { useEffect, useState } from 'react';
import type { BracketDraft, Match } from '../../lib/types';
import { matchLabel } from '../../lib/integrityChecks';
import { matchName } from '../../lib/matchName';
import { ArrowRight, Check } from '../ui/Icons';
import { playableMatches } from './TournamentPicker';

export type DeskStep = { id: string; label: string; detail: string; state: 'done' | 'active' | 'todo'; action?: () => void; actionLabel?: string; disabled?: boolean };

export function DeskSteps({ steps, next }: { steps: DeskStep[]; next?: { title: string; body: string } }) {
  const upcoming = steps.find(step => step.state !== 'done');
  return <section className="ds" aria-label="Tournament progress">
    <ol className="ds-steps">
      {steps.map((step, index) => <li key={step.id} className={`ds-step is-${step.state}`} aria-current={step === upcoming ? 'step' : undefined}>
        <span className="ds-dot" aria-hidden="true">{step.state === 'done' ? <Check size={14} strokeWidth={3} /> : index + 1}</span>
        <span className="ds-text"><strong>{step.label}</strong><small>{step.detail}</small></span>
      </li>)}
    </ol>
    {upcoming ? <div className="ds-next">
      <span className="ds-next-text"><small>Next step</small><strong>{next?.title || upcoming.label}</strong>{next?.body && <span>{next.body}</span>}</span>
      {upcoming.action && <button type="button" className="arena-primary" disabled={upcoming.disabled} onClick={upcoming.action}>{upcoming.actionLabel || upcoming.label} <ArrowRight size={16} aria-hidden="true" /></button>}
    </div> : <div className="ds-next is-done"><span className="ds-next-text"><small>All set</small><strong>Every step for this tournament is complete.</strong></span></div>}
  </section>;
}

const tone = (match: Match) => match.status === 'completed' ? 'done' : match.status === 'live' ? 'live' : match.status === 'alert' || match.status === 'pre-match' ? 'warn' : 'todo';
const short = (match: Match) => matchName(match) || match.roundName;

export function BracketPulse({ bracket, updatedAt }: { bracket: BracketDraft; updatedAt?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, [updatedAt]);
  const matches = playableMatches(bracket);
  const rounds = [...matches.reduce((map, match) => {
    const key = `${match.bracketType || 'upper'}:${match.round}:${match.roundName}`;
    if (!map.has(key)) map.set(key, { name: match.roundName, round: match.round, type: match.bracketType, matches: [] as Match[] });
    map.get(key)!.matches.push(match);
    return map;
  }, new Map<string, { name: string; round: number; type?: string; matches: Match[] }>()).values()];
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : undefined;
  const since = ago === undefined ? 'Watching for bracket changes' : ago < 10 ? 'Bracket updated just now' : ago < 60 ? `Bracket updated ${ago}s ago` : `Bracket updated ${Math.round(ago / 60)} min ago`;
  return <section className="bp" aria-label="Bracket progress">
    <header className="bp-head">
      <h2>Bracket</h2>
      <span className={`bp-sync${ago !== undefined && ago < 10 ? ' is-fresh' : ''}`} role="status"><span className="bp-sync-dot" aria-hidden="true" />{since}</span>
    </header>
    {!matches.length ? <p className="operations-empty">This bracket has no playable matches yet.</p> :
      <div className="bp-rounds">
        {rounds.map(round => <div className="bp-round" key={`${round.type}:${round.round}:${round.name}`}>
          <span className="bp-round-name">{round.name}</span>
          <div className="bp-matches">
            {round.matches.map(match => <span key={match.id} className={`bp-match is-${tone(match)}`} title={`${matchLabel(match)} · ${match.status}`}>
              {short(match)}<span className="sr-only">: {matchLabel(match)}, {match.status}</span>
            </span>)}
          </div>
        </div>)}
      </div>}
    <ul className="bp-legend" aria-label="Legend">
      <li><span className="bp-key is-done" />Finished</li><li><span className="bp-key is-live" />Live</li><li><span className="bp-key is-warn" />Pre-match or on hold</li><li><span className="bp-key is-todo" />Upcoming</li>
    </ul>
  </section>;
}
