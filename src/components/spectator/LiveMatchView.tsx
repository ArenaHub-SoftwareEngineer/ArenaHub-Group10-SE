import React, { useState } from 'react';
import { BroadcastPlayer } from '../common/BroadcastPlayer';
import { Match, User } from '../../lib/types';
import { hasCampusEmail } from '../../lib/campusAccess';
import { matchBroadcasts } from '../../lib/streamUtils';
import type { WatchCard } from '../../lib/watchCards';
import { useToast } from '../ui/Toast';
import { CollegeLogo } from '../common/CollegeLogo';
import { MatchRostersAndCareerStats } from './MatchRostersAndCareerStats';
import { WatchCardView } from './WatchCardView';
import { LiveChatPanel } from './LiveChatPanel';
import { MatchTimeline } from './MatchTimeline';
import { MatchPlayerStatsSummary } from './MatchPlayerStatsSummary';
import { hasPlayerStats } from '../../lib/matchStats';
import { MVPCard } from '../ui/MVPCard';
import { ChevronDown, ExternalLink, Link2 } from '../ui/Icons';

interface LiveMatchViewProps {
  match: Match; gameName?: string; gameImage?: string; currentUser: User; onBack: () => void; readOnly?: boolean;
  /** Other matches to watch, shown under the chat like a video site's Up next list. */
  upNext?: WatchCard[]; onOpenCard?: (card: WatchCard) => void;
}

const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';

/** The watch page: player, title and actions, a description box with the score, then chat and Up next. */
export const LiveMatchView: React.FC<LiveMatchViewProps> = ({ match, gameName, gameImage, currentUser, onBack, readOnly = false, upNext = [], onOpenCard }) => {
  const { showToast } = useToast();
  const statusLabel = ({ live: 'Live', completed: 'Completed', upcoming: 'Upcoming', 'pre-match': 'Pre-match', alert: 'Needs review' } as Record<string, string>)[match.status] || match.status;
  const [more, setMore] = useState(false);
  const canPost = !readOnly && hasCampusEmail(currentUser.email);
  const team1 = match.team1?.name || 'Awaiting team', team2 = match.team2?.name || 'Awaiting team';
  const links = matchBroadcasts(match);
  // Only real entries: without recorded stats the table would show every player at 0/0/0.
  const hasStats = hasPlayerStats(match);

  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); showToast('Link copied. Anyone with ArenaHub access can open this match.', 'success'); }
    catch { showToast('Copy the address from your browser bar to share this match.', 'info'); }
  };

  return <div className="watch-page">
    <div className="watch-primary">
      <nav className="watch-crumbs" aria-label="Breadcrumb"><button type="button" onClick={onBack}>Match center</button><span aria-hidden="true">/</span><span>{gameName || 'Live match'}</span></nav>
      <BroadcastPlayer match={match} />

      <h1 className="watch-heading">{team1} vs {team2}</h1>
      <div className="watch-actions-row">
        <div className="watch-channel-block">
          <span className="watch-channel-avatar">{gameImage ? <img src={gameImage} alt="" /> : initials(gameName || 'ArenaHub')}</span>
          <span><strong>{gameName || 'ArenaHub'}</strong><small>{[match.roundName, match.matchFormat].filter(Boolean).join(' · ')}</small></span>
        </div>
        <div className="watch-actions">
          <button type="button" className="watch-action" onClick={() => void share()}><Link2 size={18} />Share</button>
          {links[0] && <a className="watch-action" href={links[0].url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Open original</a>}
        </div>
      </div>

      <section className={`watch-description${more ? ' is-open' : ''}`} aria-label="Match details">
        <p className="watch-description-meta"><span className={`watch-status-pill status-${match.status}`}>{match.status === 'live' && <i aria-hidden="true" />}{statusLabel}</span>{match.streamTitle && <span>{match.streamTitle}</span>}</p>
        <div className="watch-scoreboard" aria-label={`Score ${team1} ${match.score.team1Score}, ${team2} ${match.score.team2Score}`}>
          <div><CollegeLogo code={match.team1?.collegeCode || team1.slice(0, 3)} size="md" /><span><strong>{team1}</strong><small>{match.team1?.collegeCode}</small></span></div>
          <strong className="watch-score">{match.score.team1Score}<span>–</span>{match.score.team2Score}</strong>
          <div className="is-right"><span><strong>{team2}</strong><small>{match.team2?.collegeCode}</small></span><CollegeLogo code={match.team2?.collegeCode || team2.slice(0, 3)} size="md" /></div>
        </div>
        {match.mvp && <MVPCard mvp={match.mvp} status={match.status} className="mt-3" />}
        {more && <div className="watch-rosters"><MatchTimeline match={match} className="mb-4" />{hasStats && <MatchPlayerStatsSummary match={match} className="mb-4" />}<MatchRostersAndCareerStats match={match} /></div>}
        <button type="button" className="watch-more" aria-expanded={more} onClick={() => setMore(value => !value)}>{more ? 'Show less' : match.timelineEvents?.length ? 'Timeline, rosters and player stats' : 'Rosters and player stats'}<ChevronDown size={16} className={more ? 'rotate-180' : ''} /></button>
      </section>
    </div>

    <aside className="watch-secondary">
      <LiveChatPanel matchId={match.id} currentUser={currentUser} readOnly={readOnly} canPost={canPost} />

      {upNext.length > 0 && onOpenCard && <section className="watch-upnext" aria-labelledby="watch-upnext-title">
        <h2 id="watch-upnext-title">Up next</h2>
        <div className="watch-upnext-list">{upNext.map(card => <WatchCardView key={card.match.id} card={card} layout="row" onOpen={onOpenCard} />)}</div>
      </section>}
    </aside>
  </div>;
};
