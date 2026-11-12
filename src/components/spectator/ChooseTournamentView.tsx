import React, { useState } from 'react';
import type { BracketDraft } from '../../lib/types';
import { publicationGameKey } from '../../lib/bracketPublication';
import { GAME_ARTWORK, GameArtworkTiles } from '../common/GameArtworkTiles';
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
    <GameArtworkTiles label="Filter brackets by game" selected={game} onSelect={setGame} />
    <div><button className="arena-outline" type="button" aria-pressed={game === 'all'} onClick={() => setGame('all')}>All games</button></div>
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
    </div> : <p className="arena-panel studio-muted">No bracket has been published for this selection yet.</p>}
  </div>;
}
