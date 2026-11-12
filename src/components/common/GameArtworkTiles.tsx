import React from 'react';
import { FAIR_PLAY_GAMES } from '../../lib/fairPlayGames';
import { ArrowUpRight } from '../ui/Icons';

export const GAME_ARTWORK = [
  { id: 'mlbb', name: 'Mobile Legends: Bang Bang', image: FAIR_PLAY_GAMES[0].image },
  { id: 'dota2', name: 'Dota 2', image: FAIR_PLAY_GAMES[1].image },
  { id: 'codm-mp', name: 'CODM Multiplayer', image: FAIR_PLAY_GAMES[3].image, mode: 'Multiplayer' },
  { id: 'codm-br', name: 'CODM Battle Royale', image: FAIR_PLAY_GAMES[2].image, mode: 'Battle Royale' },
];

export function GameArtworkTiles({ label, selected, opensDialog, onSelect, children, compact = false }: {
  label: string;
  selected?: string;
  opensDialog?: boolean;
  onSelect: (id: string) => void;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return <div className={`schedule-game-grid artwork-picker ${compact?'artwork-picker-compact':''}`} role="group" aria-label={label}>
    {GAME_ARTWORK.map(game => <button key={game.id} type="button" className="schedule-game-tile"
      data-game={game.id}
      aria-label={game.name} title={game.name} aria-pressed={selected === undefined ? undefined : selected === game.id}
      aria-haspopup={opensDialog ? 'dialog' : undefined} onClick={() => onSelect(game.id)}>
      <img src={game.image} alt="" />
      {game.id.startsWith('codm') && <span className="artwork-codm-logo" aria-hidden="true"/>}
      {game.mode && <span className="schedule-game-mode">{game.mode}</span>}
      <span className="artwork-action" aria-hidden="true"><ArrowUpRight size={18}/></span>
    </button>)}
    {children}
  </div>;
}
