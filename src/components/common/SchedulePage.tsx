import React, { useState } from 'react';
import type { BracketDraft, Match } from '../../lib/types';
import { manilaToday } from '../../lib/calendar';
import { matchLabel } from '../../lib/integrityChecks';
import { publicationGameKey } from '../../lib/bracketPublication';
import { GAME_ARTWORK, GameArtworkTiles } from './GameArtworkTiles';
import { CalendarDays } from '../ui/Icons';
import { Modal } from '../ui/Modal';
import { calendarMonth, dayLabel, MatchCalendar, scheduledMatchesByDay } from './MatchCalendar';

export function PublishedScheduleDialog({ open, onClose, bracket, onSelect, choices, onChoose }: {
  open: boolean;
  onClose: () => void;
  bracket: BracketDraft | undefined;
  choices?: BracketDraft[];
  onChoose?: (id: string) => void;
  onSelect: (match: Match) => void;
}) {
  return <Modal open={open} title="Match schedule" className="account-dialog viewer-schedule-dialog" onClose={onClose}
    description={bracket ? `${bracket.gameName} · ${bracket.title} · Manila time` : 'Published match dates appear here.'}>
    {choices && choices.length > 1 && <label className="module-form schedule-bracket-choice">Published bracket or mode
      <select value={bracket?.id ?? ''} onChange={event => onChoose?.(event.target.value)}>
        {choices.map(item => <option key={item.id} value={item.id}>{item.gameName} · {item.title}</option>)}
      </select>
    </label>}
    {bracket ? <PublishedCalendar key={bracket.id} matches={bracket.matches} onSelect={match => {
      onClose();
      onSelect(match);
    }} /> : <p className="studio-muted">The organizer hasn’t published a schedule for this selection.</p>}
  </Modal>;
}

function PublishedCalendar({ matches, onSelect }: { matches: Match[]; onSelect: (match: Match) => void }) {
  const today = manilaToday();
  const events = scheduledMatchesByDay(matches.filter(match => ![match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE')), today);
  const dates = [...events.keys()].sort();
  const firstDay = dates.find(date => date >= today) ?? dates.at(-1) ?? today;
  const [selectedDay, setSelectedDay] = useState(firstDay);
  const [month, setMonth] = useState(() => calendarMonth(firstDay));
  const entries = events.get(selectedDay) ?? [];

  return <div className="viewer-schedule">
    {events.size === 0 && <p className="settings-notice">The bracket is published. Match dates and times are still pending.</p>}
    <MatchCalendar month={month} events={events} selectedDay={selectedDay} onSelectDay={setSelectedDay} onMonthChange={next => {
      setMonth(next);
      const prefix = next.toISOString().slice(0, 7);
      setSelectedDay(dates.find(date => date.startsWith(prefix)) ?? (today.startsWith(prefix) ? today : `${prefix}-01`));
    }} />
    <section className="viewer-schedule-agenda" aria-label="Selected date">
      <h3>{dayLabel.format(new Date(`${selectedDay}T00:00:00Z`))}</h3>
      {entries.length ? <ul>{entries.map(match => <li key={match.id}>
        <time>{match.scheduledTime}</time>
        <div><strong>{matchLabel(match)}</strong><small>{match.roundName} · {match.matchFormat}</small></div>
        {match.status === 'live' ? <button type="button" className="arena-outline" onClick={() => onSelect(match)}>Open live match</button>
          : <small>{match.status === 'completed' ? 'Completed' : 'Not live yet'}</small>}
      </li>)}</ul> : <p className="studio-muted">No matches scheduled for this date.</p>}
    </section>
  </div>;
}

export function SchedulePage({ brackets, onSelect }: { brackets: BracketDraft[]; onSelect: (match: Match) => void }) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [bracketId, setBracketId] = useState('');
  const games = GAME_ARTWORK.map(game => ({
    ...game,
    brackets: brackets.filter(bracket => publicationGameKey(bracket) === `game-${game.id}`),
  }));
  const otherBrackets = brackets.filter(bracket => !games.some(game => game.brackets.includes(bracket)));
  const choices = games.find(game => game.id === gameId)?.brackets
    ?? otherBrackets.filter(bracket => `bracket:${bracket.id}` === gameId);
  const bracket = choices.find(item => item.id === bracketId) ?? choices[0];

  function openCalendar(id: string) {
    setBracketId('');
    setGameId(id);
  }

  return <div className="module-page">
    <header className="dashboard-page-heading">
      <h1>Match schedule</h1>
      <p>Select a game to open its calendar.</p>
    </header>
    <GameArtworkTiles label="Game calendars" opensDialog onSelect={openCalendar}>
      {otherBrackets.map(item => <button type="button" className="schedule-game-tile schedule-game-fallback" key={item.id}
        aria-haspopup="dialog" onClick={() => openCalendar(`bracket:${item.id}`)}>
        <CalendarDays size={28} /> <span>{item.gameName} · {item.title}</span>
      </button>)}
    </GameArtworkTiles>
    <PublishedScheduleDialog open={gameId !== null} onClose={() => setGameId(null)} bracket={bracket}
      choices={choices} onChoose={setBracketId} onSelect={onSelect} />
  </div>;
}
