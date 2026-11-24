import React, { useState } from 'react';
import { firestoreService } from '../../lib/firestore';
import { publicationGameKey } from '../../lib/bracketPublication';
import { canEditMatchSchedule, hasMatchSchedule, isScheduleMatch } from '../../lib/streamSchedule';
import type { BracketDraft, GameTitle } from '../../lib/types';
import { GAME_ARTWORK, GameArtworkTiles } from '../common/GameArtworkTiles';
import { bracketArt } from '../common/TournamentPicker';
import { Gamepad2 } from '../ui/Icons';
import { DraftScheduleCalendar } from './DraftScheduleCalendar';
import '../common/schedule.css';

const gameFor = (bracket: BracketDraft) => {
  const key = publicationGameKey(bracket);
  return GAME_ARTWORK.find(game => `game-${game.id}` === key)?.id ?? key;
};

export function PublishedSchedulePage({ brackets, games, bracketId, onChoose }: {
  brackets: BracketDraft[];
  games: GameTitle[];
  bracketId?: string | null;
  onChoose: (id: string) => void;
}) {
  const [game, setGame] = useState('');
  const requested = brackets.find(bracket => bracket.id === bracketId);
  const group = new Map<string, BracketDraft[]>();
  for (const bracket of brackets) {
    const id = gameFor(bracket);
    const known = group.get(id) ?? [];
    known.push(bracket);
    group.set(id, known);
  }
  const firstPublishedGame = GAME_ARTWORK.find(option => group.has(option.id))?.id ?? group.keys().next().value;
  const selectedGame = requested ? gameFor(requested) : game || firstPublishedGame || '';
  const available = group.get(selectedGame) ?? [];
  const selected = requested ?? available[0];
  const matches = selected?.matches.filter(isScheduleMatch) ?? [];
  const unscheduled = matches.filter(match => canEditMatchSchedule(match) && !hasMatchSchedule(match)).length;
  const scheduled = matches.filter(match => hasMatchSchedule(match)).length;
  const meta = Object.fromEntries(GAME_ARTWORK.map(option => [option.id, group.has(option.id) ? 'Published bracket' : 'No published bracket']));

  function selectGame(id: string) {
    setGame(id);
    if (id !== selectedGame || !requested) onChoose(group.get(id)?.[0]?.id ?? '');
  }

  return <div className="module-page schedule-page published-schedule-page">
    <header className="dashboard-page-heading">
      <h1>Match schedule</h1>
      <p>Select a date to see matches or update their times. All times are in Manila time.</p>
    </header>
    <section className="published-schedule-games" aria-labelledby="published-schedule-games">
      <h2 id="published-schedule-games">Choose a game</h2>
      <GameArtworkTiles label="Schedule games" selected={selectedGame} onSelect={selectGame} meta={meta}>
        {[...group].filter(([id]) => !GAME_ARTWORK.some(option => option.id === id)).map(([id, entries]) => {
          const bracket = entries[0];
          const art = bracketArt(bracket) || games.find(game =>
            (bracket.gameId !== 'game-custom' && bracket.gameId === game.id) || game.name.trim().toLowerCase() === bracket.gameName.trim().toLowerCase()
          )?.bannerImage;
          return <button type="button" key={id} className="schedule-game-tile" aria-pressed={selectedGame === id} onClick={() => selectGame(id)}>
            <span className="artwork-media">{art ? <img src={art} alt="" /> : <Gamepad2 size={30} aria-hidden="true" />}</span>
            <span className="artwork-caption"><strong>{bracket.gameName}</strong><small>Published bracket</small></span>
          </button>;
        })}
      </GameArtworkTiles>
    </section>
    {selected ? <section className="arena-panel published-schedule-calendar" aria-label="Manage match schedule">
      <header>
        <div>
          <h2>{selected.title}</h2>
          <div className="published-schedule-meta">
            <span><b>{scheduled}</b> scheduled</span>
            <span className={unscheduled ? 'schedule-meta-pending' : undefined}><b>{unscheduled}</b> unscheduled</span>
          </div>
        </div>
        {available.length > 1 && <label className="module-form schedule-bracket-choice">Published bracket
          <select value={selected.id} onChange={event => onChoose(event.target.value)}>
            {available.map(bracket => <option key={bracket.id} value={bracket.id}>{bracket.title}</option>)}
          </select>
        </label>}
      </header>
      <DraftScheduleCalendar key={selected.id} published game={{ id: selected.gameId, name: selected.gameName }}
        matches={matches} onApply={updates => firestoreService.savePublishedMatchSchedules(selected.id, updates)} />
    </section> : <p className="schedule-empty-panel schedule-empty" role="status">
      {selectedGame ? 'No bracket has been published for this game.' : 'Match schedules appear here once a bracket is published.'}
    </p>}
  </div>;
}
