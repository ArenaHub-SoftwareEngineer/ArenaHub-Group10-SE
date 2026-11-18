import React, { useState } from 'react';
import type { BracketDraft } from '../../lib/types';
import { publicationGameKey } from '../../lib/bracketPublication';
import { GAME_ARTWORK } from '../common/GameArtworkTiles';
import { ArrowRight, GitBranch, Radio } from '../ui/Icons';

export function ChooseTournamentView({ brackets, onSelectBracket }: {
  brackets: BracketDraft[];
  onSelectBracket: (bracket: BracketDraft) => void;
}) {
  const [game, setGame] = useState('all');
  const visible = brackets.filter(bracket => game === 'all' || publicationGameKey(bracket) === `game-${game}`);

  return <div className="module-page">
    <header className="dashboard-page-heading">
      <h1>Brackets</h1>
      <p>Choose a game to view its published bracket, scores, and live matches.</p>
    </header>
    {/* One filter row, the same chips Match center uses; each count says whether a game has a bracket before you click. */}
    <div className="ah-chips" role="group" aria-label="Filter brackets by game">
      <button type="button" className="ah-chip" aria-pressed={game === 'all'} onClick={() => setGame('all')}>All games <span className="ah-chip-count">{brackets.length}</span></button>
      {GAME_ARTWORK.map(item => {
        const count = brackets.filter(bracket => publicationGameKey(bracket) === `game-${item.id}`).length;
        return <button key={item.id} type="button" className="ah-chip" aria-pressed={game === item.id} onClick={() => setGame(item.id)}>
          <img className="ah-chip-img" src={item.image} alt="" />{item.name}<span className="ah-chip-count">{count}</span>
        </button>;
      })}
    </div>
    {visible.length ? <div className="viewer-bracket-grid">
      {visible.map(bracket => {
        const artwork = GAME_ARTWORK.find(item => `game-${item.id}` === publicationGameKey(bracket));
        const live = bracket.matches.filter(match => match.status === 'live').length;
        return <button type="button" key={bracket.id} className="stream-game-card" onClick={() => onSelectBracket(bracket)}>
          {artwork && <img src={artwork.image} alt="" />}
          <span className="stream-game-card-body">
            <span className="studio-muted">{bracket.gameName}</span>
            <strong>{bracket.title}</strong>
            {live ? <span className="viewer-live-label"><Radio size={15} /> {live} live {live === 1 ? 'match' : 'matches'}</span>
              : <span className="studio-muted"><GitBranch size={14} className="inline mr-1" /> {bracket.teamsCount} teams</span>}
            <span className="arena-text-button">View bracket <ArrowRight size={15} /></span>
          </span>
        </button>;
      })}
    </div> : <div className="ah-empty-panel"><GitBranch size={22} aria-hidden="true" /><strong>No bracket for this game yet</strong><p>Organizers publish brackets here once teams are confirmed.</p>{game !== 'all' && <button type="button" className="arena-outline" onClick={() => setGame('all')}>Show all games</button>}</div>}
  </div>;
}
