// A visual replacement for a long <select> of matches: search, Live / Up next and game filters, rows grouped by game
// with artwork, round, status and time. Once a match is chosen it collapses to one summary card with "Change".
// Keyboard: the rows are a radio group (arrow keys move, Enter or Space selects).
import React, { useId, useMemo, useRef, useState } from 'react';
import type { Match } from '../../lib/types';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame, type FairPlayGame } from '../../lib/fairPlayGames';
import { bracketScheduleLabel } from '../../lib/calendar';
import { Check, Search } from '../ui/Icons';
import './matchPicker.css';
import { matchName } from '../../lib/matchName';

const gameFor = (match: Match): FairPlayGame | undefined => FAIR_PLAY_GAMES.find(game => belongsToFairPlayGame(match, game));
const gameLabel = (game?: FairPlayGame) => game ? (game.id.startsWith('codm') ? `CODM ${game.mode}` : game.name) : 'Other games';
export const matchTitle = (match: Match) => match.lobby ? `${match.roundName} · ${match.lobby.squads} squads` : `${match.team1?.name || 'TBD'} vs ${match.team2?.name || 'TBD'}`;
const STATUS: Record<Match['status'], { label: string; tone: string; order: number }> = {
  live: { label: 'Live', tone: 'live', order: 0 },
  'pre-match': { label: 'Pre-match', tone: 'warning', order: 1 },
  alert: { label: 'On hold', tone: 'warning', order: 2 },
  upcoming: { label: 'Upcoming', tone: 'info', order: 3 },
  completed: { label: 'Ended', tone: 'muted', order: 4 },
};

export function MatchPicker({ matches, value, onChange, label, hint, disabled = false, compact = false, emptyText }: {
  matches: Match[]; value: string; onChange: (id: string) => void; label: string; hint?: string; disabled?: boolean; compact?: boolean; emptyText?: string;
}) {
  const labelId = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'live' | 'next'>('all');
  const [game, setGame] = useState('');
  const [browsing, setBrowsing] = useState(!value);
  const list = useRef<HTMLDivElement>(null);
  const selected = matches.find(match => match.id === value);

  const games = useMemo(() => [...new Map(matches.map(match => [gameFor(match)?.id || 'other', gameFor(match)])).entries()], [matches]);
  const needle = query.trim().toLowerCase();
  const shown = matches
    .filter(match => status === 'all' || (status === 'live' ? match.status === 'live' : match.status !== 'live'))
    .filter(match => !game || (gameFor(match)?.id || 'other') === game)
    .filter(match => !needle || `${match.matchNumber} ${matchName(match)} ${match.roundName} ${matchTitle(match)} ${gameLabel(gameFor(match))}`.toLowerCase().includes(needle))
    .sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || `${a.scheduledDate || '9'}${a.scheduledTime || ''}`.localeCompare(`${b.scheduledDate || '9'}${b.scheduledTime || ''}`));
  const groups = [...new Map(shown.map(match => [gameFor(match)?.id || 'other', [] as Match[]])).entries()];
  for (const match of shown) groups.find(([id]) => id === (gameFor(match)?.id || 'other'))![1].push(match);
  const liveCount = matches.filter(match => match.status === 'live').length;
  const firstTabStop = shown.some(match => match.id === value) ? value : shown[0]?.id;

  const choose = (id: string) => { onChange(id); setBrowsing(false); };
  const move = (event: React.KeyboardEvent, id: string) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const index = shown.findIndex(match => match.id === id);
    const next = shown[Math.max(0, Math.min(shown.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    list.current?.querySelector<HTMLButtonElement>(`[data-match-id="${CSS.escape(next.id)}"]`)?.focus();
  };

  if (selected && !browsing) {
    const info = STATUS[selected.status];
    const art = gameFor(selected);
    return <div className="mp mp-chosen">
      <span className="mp-label">{label}</span>
      <div className="mp-summary">
        {art ? <img src={art.image} alt="" /> : <span className="mp-art-blank" />}
        <span className="mp-text"><strong>{matchTitle(selected)}</strong><small>{gameLabel(art)} · {matchName(selected)} · {selected.roundName} · {bracketScheduleLabel(selected)}</small></span>
        <span className={`mp-status is-${info.tone}`}>{info.label}</span>
        <button type="button" className="arena-outline arena-sm" disabled={disabled} onClick={() => setBrowsing(true)}>Change match</button>
      </div>
    </div>;
  }

  return <div className="mp">
    <span className="mp-label" id={labelId}>{label}</span>
    {hint && <p className="mp-hint">{hint}</p>}
    <div className="mp-controls">
      <label className="page-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search team, match number or round" aria-label="Search matches" />
      </label>
      {!compact && <div className="ah-chips" role="group" aria-label="Filter matches">
        <button type="button" className="ah-chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>All <span className="mp-count">{matches.length}</span></button>
        <button type="button" className="ah-chip" aria-pressed={status === 'live'} onClick={() => setStatus('live')}>Live <span className="mp-count">{liveCount}</span></button>
        <button type="button" className="ah-chip" aria-pressed={status === 'next'} onClick={() => setStatus('next')}>Up next <span className="mp-count">{matches.length - liveCount}</span></button>
        {games.length > 1 && games.map(([id, item]) => <button key={id} type="button" className="ah-chip" aria-pressed={game === id} onClick={() => setGame(game === id ? '' : id)}>{gameLabel(item)}</button>)}
      </div>}
    </div>
    <div className={`mp-list${compact ? ' mp-list-compact' : ''}`} ref={list} role="radiogroup" aria-labelledby={labelId}>
      {!shown.length && <p className="mp-empty" role="status">{matches.length ? 'No match fits these filters.' : emptyText || 'No published match needs a scan right now.'}</p>}
      {groups.map(([id, rows]) => <div key={id} className="mp-group">
        {!compact && <h4>{gameLabel(gameFor(rows[0]))}<span>{rows.length}</span></h4>}
        {rows.map(match => {
          const info = STATUS[match.status];
          const checked = match.id === value;
          const art = gameFor(match);
          return <button key={match.id} type="button" role="radio" aria-checked={checked} data-match-id={match.id} disabled={disabled}
            tabIndex={match.id === firstTabStop ? 0 : -1}
            className={`mp-row${checked ? ' is-checked' : ''}`} onClick={() => choose(match.id)} onKeyDown={event => move(event, match.id)}>
            {art ? <img src={art.image} alt="" /> : <span className="mp-art-blank" />}
            <span className="mp-text"><strong>{matchTitle(match)}</strong><small>{matchName(match)} · {match.roundName} · {bracketScheduleLabel(match)}</small></span>
            <span className={`mp-status is-${info.tone}`}>{info.label}</span>
            <span className="mp-check" aria-hidden="true">{checked && <Check size={14} strokeWidth={3} />}</span>
          </button>;
        })}
      </div>)}
    </div>
    {selected && <button type="button" className="chat-text-link mp-back" onClick={() => setBrowsing(false)}>Keep {matchTitle(selected)}</button>}
  </div>;
}
