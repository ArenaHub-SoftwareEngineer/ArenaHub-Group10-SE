// Picture cards for choosing a published tournament (replaces a plain <select>). Each card shows the game art, how far
// the bracket has progressed and whether anything is live. When a bracket changes in Firestore (an organizer publishes
// results or a new round), its card shows "Updated" for a few seconds, so staff can see the desk is live.
// Keyboard: the cards are a radio group (arrow keys move, Enter or Space selects).
import React, { useEffect, useRef, useState } from 'react';
import type { BracketDraft, Match } from '../../lib/types';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from '../../lib/fairPlayGames';
import { publicationGameKey } from '../../lib/bracketPublication';
import { scheduleMatches } from '../../lib/formats/placement';
import { Check, Users } from '../ui/Icons';
import './tournamentPicker.css';

const isBye = (match: Match) => [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE');
export const playableMatches = (bracket: BracketDraft) => scheduleMatches(bracket).filter(match => !isBye(match) && !match.inactive);

export function bracketArt(bracket: BracketDraft): string | undefined {
  const key = publicationGameKey(bracket);
  const direct = FAIR_PLAY_GAMES.find(game => `game-${game.id}` === key);
  if (direct) return direct.image;
  const first = bracket.matches[0];
  return first ? FAIR_PLAY_GAMES.find(game => belongsToFairPlayGame(first, game))?.image : undefined;
}

export const formatLabel = (format: string) => {
  const text = (format || '').replace(/[-_]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Bracket';
};

export function bracketProgress(bracket: BracketDraft) {
  const matches = playableMatches(bracket);
  const done = matches.filter(match => match.status === 'completed').length;
  const live = matches.filter(match => match.status === 'live').length;
  const rounds = [...new Set(matches.map(match => match.roundName))];
  const current = matches.find(match => match.status !== 'completed')?.roundName;
  return { total: matches.length, done, live, rounds: rounds.length, current, finished: matches.length > 0 && done === matches.length };
}

/** A short signature of what viewers can see change: match states and scores. */
export const bracketSignature = (bracket: BracketDraft) =>
  scheduleMatches(bracket).map(match => `${match.id}:${match.status}:${JSON.stringify(match.score ?? '')}:${match.winnerId || ''}:${match.team1?.id || ''}/${match.team2?.id || ''}`).join('|');

/**
 * `recent`: bracket ids whose signature changed in the last few seconds (for the card flash).
 * `lastChanged`: when each bracket last changed while this page was open. Nothing counts as a change on first load.
 */
export function useRecentlyUpdated(brackets: BracketDraft[], holdMs = 6000) {
  const seen = useRef(new Map<string, string>());
  const [lastChanged, setLastChanged] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Record<string, number>>({});
  useEffect(() => {
    const changed: string[] = [];
    for (const bracket of brackets) {
      const signature = bracketSignature(bracket);
      const previous = seen.current.get(bracket.id);
      if (previous !== undefined && previous !== signature) changed.push(bracket.id);
      seen.current.set(bracket.id, signature);
    }
    if (!changed.length) return;
    const now = Date.now();
    const stamps = Object.fromEntries(changed.map(id => [id, now]));
    setLastChanged(current => ({ ...current, ...stamps }));
    setRecent(current => ({ ...current, ...stamps }));
    const timer = setTimeout(() => setRecent(current => Object.fromEntries(Object.entries(current).filter(([, at]) => Date.now() - at < holdMs))), holdMs + 50);
    return () => clearTimeout(timer);
  }, [brackets, holdMs]);
  return { recent, lastChanged };
}

export function TournamentPicker({ brackets, value, onChange, recent }: {
  brackets: BracketDraft[]; value: string; onChange: (id: string) => void; recent: Record<string, number>;
}) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: React.KeyboardEvent, id: string) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = brackets.findIndex(bracket => bracket.id === id);
    const next = brackets[(index + step + brackets.length) % brackets.length];
    onChange(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-bracket-id="${CSS.escape(next.id)}"]`)?.focus();
  };
  if (!brackets.length) return null;
  return <div className="tp" role="radiogroup" aria-label="Published tournament" ref={list}>
    {brackets.map(bracket => {
      const checked = bracket.id === value;
      const art = bracketArt(bracket);
      const progress = bracketProgress(bracket);
      const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
      const updated = !!recent[bracket.id];
      return <button key={bracket.id} type="button" role="radio" aria-checked={checked} data-bracket-id={bracket.id}
        tabIndex={checked ? 0 : -1} className={`tp-card${checked ? ' is-checked' : ''}${updated ? ' is-updated' : ''}`}
        onClick={() => onChange(bracket.id)} onKeyDown={event => move(event, bracket.id)}>
        <span className="tp-art">
          {art ? <img src={art} alt="" loading="lazy" decoding="async" /> : <span className="tp-art-blank" />}
          <span className="tp-badges">
            {progress.live > 0 && <span className="tp-live">LIVE {progress.live}</span>}
            {updated && <span className="tp-updated">Updated</span>}
          </span>
          <span className="tp-check" aria-hidden="true">{checked && <Check size={14} strokeWidth={3} />}</span>
        </span>
        <span className="tp-body">
          <small className="tp-game">{bracket.gameName}</small>
          <strong className="tp-title">{bracket.title}</strong>
          <span className="tp-meta">{formatLabel(bracket.format)} · <Users size={13} aria-hidden="true" /> {bracket.teamsCount || bracket.teams.length} teams</span>
          <span className="tp-progress" aria-label={`${progress.done} of ${progress.total} matches finished`}>
            <span className="tp-bar"><span style={{ width: `${percent}%` }} /></span>
            <span className="tp-progress-text">{progress.finished ? 'Finished' : progress.current ? progress.current : 'Not started'} · {progress.done}/{progress.total}</span>
          </span>
        </span>
      </button>;
    })}
  </div>;
}
