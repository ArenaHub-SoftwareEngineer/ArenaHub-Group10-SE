import React from 'react';
import type { WatchCard } from '../../lib/watchCards';
import { bracketScheduleLabel } from '../../lib/calendar';
import { CollegeLogo } from '../common/CollegeLogo';
import { Play } from '../ui/Icons';

const teamName = (team?: { name?: string }) => team?.name || 'Awaiting team';
/** "Team A vs Team B", or "Game 2: 12-squad lobby" for a Battle Royale game. */
export const cardTitle = (match: WatchCard['match']) => match.lobby ? `${match.roundName}: ${match.lobby.squads}-squad lobby` : `${teamName(match.team1)} vs ${teamName(match.team2)}`;
const code = (team?: { collegeCode?: string; name?: string }) => team?.collegeCode || (team?.name || 'TBD').replace(/^DEMO\s+/i, '').slice(0, 3).toUpperCase();
export const cardStatus = (card: WatchCard) => card.state === 'live' ? 'Live now' : card.state === 'waiting' ? 'Live · broadcast starting soon'
  : card.state === 'upcoming' ? bracketScheduleLabel(card.match) : card.match.status === 'completed' ? (card.match.lobby?.winner ? `Won by ${card.match.lobby.winner}` : 'Ended') : 'Not scheduled';

/**
 * A match shown like a video: 16:9 thumbnail (game art, the two college crests, a LIVE or time badge),
 * then the title and channel-style details. `row` is the compact Up next layout.
 */
export function WatchCardView({ card, layout = 'grid', onOpen }: { card: WatchCard; layout?: 'grid' | 'row'; onOpen: (card: WatchCard) => void }) {
  const { match } = card;
  const live = card.state === 'live';
  const title = cardTitle(match);
  return <button type="button" className={`watch-card watch-card-${layout}${live ? ' is-live' : ''}`} onClick={() => onOpen(card)}>
    <span className="watch-thumb">
      {card.image ? <img src={card.image} alt="" loading="lazy" /> : <span className="watch-thumb-fallback" />}
      <span className="watch-thumb-shade" />
      {match.lobby ? <span className="watch-thumb-versus watch-thumb-lobby" aria-hidden="true"><b>{match.lobby.squads}</b><small>squads</small></span>
        : <span className="watch-thumb-versus" aria-hidden="true">
          <CollegeLogo code={code(match.team1)} size={layout === 'row' ? 'sm' : 'md'} /><b>VS</b><CollegeLogo code={code(match.team2)} size={layout === 'row' ? 'sm' : 'md'} />
        </span>}
      {live ? <span className="watch-badge watch-badge-live" aria-hidden="true"><i />LIVE</span>
        : card.state === 'waiting' ? <span className="watch-badge watch-badge-soon" aria-hidden="true">Starting soon</span> : null}
      <span className="watch-badge watch-badge-corner">{match.lobby ? 'Lobby' : match.status === 'live' || match.status === 'completed' ? `${match.score.team1Score}–${match.score.team2Score}` : match.matchFormat || 'Bo3'}</span>
      <span className="watch-play" aria-hidden="true"><Play size={layout === 'row' ? 16 : 22} /></span>
    </span>
    <span className="watch-meta">
      {layout === 'grid' && <span className="watch-avatar">{card.image ? <img src={card.image} alt="" /> : null}</span>}
      <span className="watch-text">
        <strong className="watch-title">{title}</strong>
        <span className="watch-channel">{card.gameLabel}{card.mode ? ` · ${card.mode}` : ''}</span>
        <span className="watch-sub">{[card.bracket.title, match.roundName].filter(Boolean).join(' · ')}</span>
        <span className={`watch-status${live ? ' is-live' : ''}`}>{cardStatus(card)}
        </span>
      </span>
    </span>
  </button>;
}
