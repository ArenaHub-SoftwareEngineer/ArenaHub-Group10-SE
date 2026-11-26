import React, { useEffect, useState } from 'react';
import { BroadcastPlayer } from '../common/BroadcastPlayer';
import { Match, User } from '../../lib/types';
import { hasCampusEmail } from '../../lib/campusAccess';
import type { WatchCard } from '../../lib/watchCards';
import { useToast } from '../ui/Toast';
import { CollegeLogo } from '../common/CollegeLogo';
import { MatchRostersAndCareerStats } from './MatchRostersAndCareerStats';
import { WatchCardView, cardTitle } from './WatchCardView';
import { bracketScheduleLabel, scheduleDate, timeOrder } from '../../lib/calendar';
import { ShareMatchDialog } from './ShareMatchDialog';
import { LiveChatPanel } from './LiveChatPanel';
import { ChevronDown, Clock, Link2, Users } from '../ui/Icons';
import { formatViewers, useViewerCounts, useWatchPresence } from '../../lib/presence';

interface LiveMatchViewProps {
  match: Match; gameName?: string; gameImage?: string; currentUser: User; onBack: () => void; readOnly?: boolean;
  /** Other matches to watch, shown under the chat like a video site's Up next list. */
  upNext?: WatchCard[]; onOpenCard?: (card: WatchCard) => void;
  onOpenArenaAI?: () => void;
}

const hasTime = (match: Match) => Boolean(match.scheduledDate?.trim() || match.scheduledTime?.trim());

/** Start of a scheduled match in Manila time, or null when the date or time is not set. */
function startsAt(match: Match): number | null {
  const date = scheduleDate(match.scheduledDate?.trim() || '');
  const minutes = timeOrder(match.scheduledTime?.trim() || '');
  if (!date || minutes === 9999) return null;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0'), mm = String(minutes % 60).padStart(2, '0');
  const at = Date.parse(`${date}T${hh}:${mm}:00+08:00`);
  return Number.isNaN(at) ? null : at;
}

/** "in 2h 15m", "in 3d 4h", "starting now"; null when the start is unknown. */
function countdown(at: number | null, now: number) {
  if (at === null) return null;
  const mins = Math.round((at - now) / 60000);
  if (mins <= 0) return 'starting now';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return 'in ' + (d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`);
}

/** The watch page: player, title and actions, a description box with the score, then chat and Up next. */
export const LiveMatchView: React.FC<LiveMatchViewProps> = ({ match, gameName, gameImage, currentUser, readOnly = false, upNext = [], onOpenCard, onOpenArenaAI }) => {
  const { showToast } = useToast();
  const statusLabel = ({ live: 'Live', completed: 'Completed', upcoming: 'Upcoming', 'pre-match': 'Pre-match', alert: 'Needs review' } as Record<string, string>)[match.status] || match.status;
  const [more, setMore] = useState(false);
  // Everyone signed in here is admitted: campus accounts, or guests who joined with a student invite.
  // Guests can comment; inviting others and Arena AI stay with campus accounts.
  const campus = hasCampusEmail(currentUser.email);
  const canPost = !readOnly;
  const team1 = match.team1?.name || 'Awaiting team', team2 = match.team2?.name || 'Awaiting team';
  // This viewer counts toward the match while the page is open; Up next shows the other live counts.
  const viewers = useWatchPresence(match.id, match.status === 'live');
  const upNextCounts = useViewerCounts(upNext.filter(card => card.state === 'live').map(card => card.match.id));

  const [sharing, setSharing] = useState(false);
  // The next scheduled match, so players and viewers can see when to get ready.
  const next = upNext.find(card => card.state === 'waiting' || card.state === 'upcoming');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const nextIn = next ? (next.state === 'waiting' ? 'starting soon' : countdown(startsAt(next.match), now)) : null;

  return <div className="watch-page">
    <div className="watch-primary">
      <BroadcastPlayer match={match} />

      {/* One aligned bar: both colleges and the score, then status, schedule, viewers and the next match's start time. */}
      <section className={`watch-matchbar${more ? ' is-open' : ''}`} aria-label="Match details">
        <h1 className="sr-only">{team1} vs {team2}</h1>
        <div className="watch-scoreboard" aria-label={`Score ${team1} ${match.score.team1Score}, ${team2} ${match.score.team2Score}`}>
          <div><CollegeLogo code={match.team1?.collegeCode || team1.slice(0, 3)} size="md" /><span><strong>{team1}</strong><small>{match.team1?.collegeCode}</small></span></div>
          <strong className="watch-score">{match.score.team1Score}<span>–</span>{match.score.team2Score}</strong>
          <div className="is-right"><span><strong>{team2}</strong><small>{match.team2?.collegeCode}</small></span><CollegeLogo code={match.team2?.collegeCode || team2.slice(0, 3)} size="md" /></div>
        </div>
        <div className="watch-matchbar-meta">
          <span className={`watch-status-pill status-${match.status}`}>{match.status === 'live' && <i aria-hidden="true" />}{statusLabel}</span>
          <span className="watch-matchbar-game">{gameImage && <img src={gameImage} alt="" />}{[gameName, match.roundName, match.matchFormat].filter(Boolean).join(' · ')}</span>
          {hasTime(match) && <span className="watch-matchbar-time"><Clock size={14} aria-hidden="true" />{bracketScheduleLabel(match)}</span>}
          {match.status === 'live' && typeof viewers === 'number' && viewers > 0 && <span className="watch-viewers-inline" aria-live="off">{formatViewers(viewers)}</span>}
          <span className="watch-matchbar-actions">
            <button type="button" className="watch-action" aria-haspopup="dialog" aria-label="Share match" onClick={() => setSharing(true)}><Link2 size={16} /><span className="watch-action-label">Share</span></button>
            <button type="button" className="watch-action" aria-expanded={more} aria-label={more ? 'Hide rosters' : 'Show rosters'} onClick={() => setMore(value => !value)}><Users size={16} className="watch-action-icon" /><span className="watch-action-label">Rosters</span><ChevronDown size={16} className={more ? 'rotate-180' : ''} /></button>
          </span>
        </div>
        {next && <button type="button" className="watch-next" onClick={() => onOpenCard?.(next)} disabled={!onOpenCard}>
          <span className="watch-next-label">Next match</span>
          <strong>{cardTitle(next.match)}</strong>
          <span className="watch-next-time"><Clock size={14} aria-hidden="true" />{bracketScheduleLabel(next.match)}{nextIn && <b>{nextIn}</b>}</span>
        </button>}
        {more && <div className="watch-rosters"><MatchRostersAndCareerStats match={match} /></div>}
      </section>
    </div>

    <ShareMatchDialog open={sharing} onClose={() => setSharing(false)} match={match} gameName={gameName} canInvite={canPost && campus && (currentUser.role === 'admin' || currentUser.spectatorInviteApproved !== false)} />

    <aside className="watch-secondary">
      <LiveChatPanel matchId={match.id} currentUser={currentUser} readOnly={readOnly} canPost={canPost} canReport={campus} onOpenArenaAI={campus ? onOpenArenaAI : undefined} />

      {upNext.length > 0 && onOpenCard && <section className="watch-upnext" aria-labelledby="watch-upnext-title">
        <h2 id="watch-upnext-title">Up next</h2>
        <div className="watch-upnext-list">{upNext.map(card => <WatchCardView key={card.match.id} card={card} layout="row" viewers={upNextCounts[card.match.id]} onOpen={onOpenCard} />)}</div>
      </section>}
    </aside>
  </div>;
};
