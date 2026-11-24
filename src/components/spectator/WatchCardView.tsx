import React, { useState } from 'react';
import type { WatchCard } from '../../lib/watchCards';
import { bracketScheduleLabel } from '../../lib/calendar';
import { matchThumbnails } from '../../lib/streamUtils';
import { formatViewers } from '../../lib/presence';
import { CollegeLogo } from '../common/CollegeLogo';

const teamName = (team?: { name?: string }) => team?.name || 'Awaiting team';
/** "Team A vs Team B", or "Game 2: 12-squad lobby" for a Battle Royale game. */
export const cardTitle = (match: WatchCard['match']) => match.lobby ? `${match.roundName}: ${match.lobby.squads}-squad lobby` : `${teamName(match.team1)} vs ${teamName(match.team2)}`;
const code = (team?: { collegeCode?: string; name?: string }) => team?.collegeCode || (team?.name || 'TBD').slice(0, 3).toUpperCase();
export const cardStatus = (card: WatchCard) => card.state === 'live' ? 'Live now' : card.state === 'waiting' ? 'Live · broadcast starting soon'
  : card.state === 'upcoming' ? bracketScheduleLabel(card.match) : card.match.status === 'completed' ? (card.match.lobby?.winner ? `Won by ${card.match.lobby.winner}` : 'Ended') : 'Not scheduled';

/** The organizer's chosen thumbnail (uploaded picture, stream frame or game artwork), then the fallbacks, then a plain stage. */
function Thumb({ card }: { card: WatchCard }) {
  const sources = matchThumbnails(card.match, card.image);
  const [index, setIndex] = useState(0);
  const src = sources[index];
  const isArtwork = !src || src === card.image;
  return <>
    {/* YouTube answers a missing frame with a 120 x 90 grey placeholder instead of an error: treat that as missing. */}
    {src ? <img key={src} src={src} alt="" loading="lazy" decoding="async" onError={() => setIndex(i => i + 1)}
      onLoad={event => { if (!isArtwork && event.currentTarget.naturalWidth <= 120) setIndex(i => i + 1); }} className={isArtwork ? 'is-artwork' : undefined} />
      : <span className="watch-thumb-fallback" />}
    {isArtwork && <span className="watch-thumb-versus" aria-hidden="true">
      {card.match.lobby ? <span className="watch-thumb-lobby"><b>{card.match.lobby.squads}</b><small>squads</small></span>
        : <><CollegeLogo code={code(card.match.team1)} size="md" /><b>vs</b><CollegeLogo code={code(card.match.team2)} size="md" /></>}
    </span>}
  </>;
}

/**
 * A match shown like a live channel: 16:9 thumbnail with LIVE and the viewer count on the frame, then the
 * title, the tournament as the "channel", the game, and tags. `row` is the compact Up next layout.
 */
export function WatchCardView({ card, layout = 'grid', viewers, onOpen }: {
  card: WatchCard; layout?: 'grid' | 'row'; viewers?: number; onOpen: (card: WatchCard) => void;
}) {
  const { match } = card;
  const live = card.state === 'live';
  const title = cardTitle(match);
  const score = match.lobby ? null : match.status === 'live' || match.status === 'completed' ? `${match.score.team1Score}–${match.score.team2Score}` : null;
  const tags = [match.matchFormat || (match.lobby ? 'Lobby' : 'Bo3'), card.mode, match.roundName].filter(Boolean) as string[];
  return <button type="button" className={`watch-card watch-card-${layout}${live ? ' is-live' : ''}`} onClick={() => onOpen(card)}>
    <span className="watch-thumb">
      <Thumb card={card} />
      {live ? <span className="watch-badge watch-badge-live">Live</span>
        : card.state === 'waiting' ? <span className="watch-badge watch-badge-soon">Starting soon</span>
        : card.state === 'upcoming' ? <span className="watch-badge watch-badge-time">{bracketScheduleLabel(match)}</span> : null}
      {live && typeof viewers === 'number' && viewers > 0 && <span className="watch-viewers">{formatViewers(viewers)}</span>}
      {score && <span className="watch-thumb-score">{score}</span>}
    </span>
    <span className="watch-meta">
      {layout === 'grid' && <span className="watch-avatar" aria-hidden="true">{card.image ? <img src={card.image} alt="" /> : null}</span>}
      <span className="watch-text">
        <strong className="watch-title">{title}</strong>
        <span className="watch-channel">{card.bracket.title}</span>
        <span className="watch-game">{card.gameLabel}</span>
        {layout === 'grid' ? <span className="watch-tags">{tags.map(tag => <span key={tag} className="watch-tag">{tag}</span>)}</span>
          : <span className={`watch-status${live ? ' is-live' : ''}`}>{live && typeof viewers === 'number' && viewers > 0 ? formatViewers(viewers) : cardStatus(card)}</span>}
      </span>
    </span>
  </button>;
}
