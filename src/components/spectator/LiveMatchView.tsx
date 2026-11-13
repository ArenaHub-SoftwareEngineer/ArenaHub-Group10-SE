import React, { useEffect, useState } from 'react';
import { BroadcastPlayer } from '../common/BroadcastPlayer';
import { Match, User } from '../../lib/types';
import { hasCampusEmail } from '../../lib/campusAccess';
import { sendMatchChat, watchMatchChat, type LiveChatMessage } from '../../lib/matchChat';
import { matchBroadcasts } from '../../lib/streamUtils';
import type { WatchCard } from '../../lib/watchCards';
import { useToast } from '../ui/Toast';
import { PlatformLogo, PLATFORM_NAMES } from '../ui/PlatformLogo';
import { CollegeLogo } from '../common/CollegeLogo';
import { MatchRostersAndCareerStats } from './MatchRostersAndCareerStats';
import { WatchCardView } from './WatchCardView';
import { ChevronDown, ExternalLink, Flag, Link2, Send } from '../ui/Icons';
import { reportLiveMessage } from '../../lib/communityReports';

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
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([]);
  const [chatAvailable, setChatAvailable] = useState(false);
  const [chatError, setChatError] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [more, setMore] = useState(false);
  const canPost = !readOnly && hasCampusEmail(currentUser.email);
  const team1 = match.team1?.name || 'Awaiting team', team2 = match.team2?.name || 'Awaiting team';
  const links = matchBroadcasts(match);

  useEffect(() => {
    setChatMessages([]); setChatAvailable(false); setChatError('');
    if (readOnly) return;
    return watchMatchChat(match.id, messages => { setChatMessages(messages); setChatAvailable(true); }, () => { setChatError('Match chat is unavailable.'); setChatAvailable(false); });
  }, [match.id, readOnly]);

  const handleSendChat = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!canPost || !chatAvailable || !text || sending) return;
    setSending(true);
    try {
      const name = currentUser.name.trim();
      await sendMatchChat(match.id, currentUser.id, anonymous || !name || name.includes('@') ? 'Anonymous' : name, text);
      setChatInput('');
    } catch { showToast('Could not send the message. Check your school sign-in and try again.', 'error'); }
    finally { setSending(false); }
  };
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
          {links.map(link => <a key={link.platform} className="watch-action" href={link.url} target="_blank" rel="noopener noreferrer"><PlatformLogo platform={link.platform} size={18} />{PLATFORM_NAMES[link.platform]}<ExternalLink size={13} /></a>)}
        </div>
      </div>

      <section className={`watch-description${more ? ' is-open' : ''}`} aria-label="Match details">
        <p className="watch-description-meta"><span className={`watch-status-pill status-${match.status}`}>{match.status === 'live' && <i aria-hidden="true" />}{statusLabel}</span>{match.streamTitle && <span>{match.streamTitle}</span>}</p>
        <div className="watch-scoreboard" aria-label={`Score ${team1} ${match.score.team1Score}, ${team2} ${match.score.team2Score}`}>
          <div><CollegeLogo code={match.team1?.collegeCode || team1.slice(0, 3)} size="md" /><span><strong>{team1}</strong><small>{match.team1?.collegeCode}</small></span></div>
          <strong className="watch-score">{match.score.team1Score}<span>–</span>{match.score.team2Score}</strong>
          <div className="is-right"><span><strong>{team2}</strong><small>{match.team2?.collegeCode}</small></span><CollegeLogo code={match.team2?.collegeCode || team2.slice(0, 3)} size="md" /></div>
        </div>
        {more && <div className="watch-rosters"><MatchRostersAndCareerStats match={match} /></div>}
        <button type="button" className="watch-more" aria-expanded={more} onClick={() => setMore(value => !value)}>{more ? 'Show less' : 'Rosters and player stats'}<ChevronDown size={16} className={more ? 'rotate-180' : ''} /></button>
      </section>
    </div>

    <aside className="watch-secondary">
      <section className="watch-chat" aria-label="Match chat">
        <header><h2>Live chat</h2><small>{chatMessages.length ? `${chatMessages.length} messages` : 'Visible to viewers of this match'}</small></header>
        <div className="watch-chat-log" role="log" aria-label="Match messages">
          {chatError && <p className="module-error" role="alert">{chatError}</p>}
          {!chatMessages.length && !chatError && <p className="watch-chat-empty">{readOnly ? 'Chat is available for published matches.' : chatAvailable ? 'No messages yet. Say hi to the other viewers.' : 'Loading chat…'}</p>}
          {chatMessages.map(message => <article key={message.id} className="watch-chat-message">
            <span className="watch-chat-avatar" aria-hidden="true">{initials(message.author)}</span>
            <p><strong>{message.author}</strong> {message.text}</p>
            {canPost && <button type="button" className="watch-chat-report" aria-label={`Report message by ${message.author}`} data-tip="Report"
              onClick={() => { void reportLiveMessage(match.id, message).then(() => showToast('Message reported privately to tournament staff.', 'success')).catch(() => showToast('This message may already be reported by you, or reporting is unavailable.', 'error')); }}><Flag size={14} /></button>}
          </article>)}
        </div>
        {canPost ? <form className="watch-chat-form" onSubmit={handleSendChat}>
          <span className="watch-chat-avatar" aria-hidden="true">{anonymous ? '?' : initials(currentUser.name || 'You')}</span>
          <input type="text" aria-label="Match chat message" value={chatInput} onChange={event => setChatInput(event.target.value)} placeholder="Chat…" maxLength={500} disabled={!chatAvailable || sending} />
          <button type="submit" className="shell-icon-button" aria-label="Send chat message" disabled={!chatInput.trim() || !chatAvailable || sending}><Send size={18} /></button>
          <label className="watch-chat-anon"><input type="checkbox" checked={anonymous} onChange={event => setAnonymous(event.target.checked)} /> Post anonymously</label>
        </form> : !readOnly && <p className="watch-chat-readonly">You can read chat. Posting is reserved for verified WMSU accounts.</p>}
      </section>

      {upNext.length > 0 && onOpenCard && <section className="watch-upnext" aria-labelledby="watch-upnext-title">
        <h2 id="watch-upnext-title">Up next</h2>
        <div className="watch-upnext-list">{upNext.map(card => <WatchCardView key={card.match.id} card={card} layout="row" onOpen={onOpenCard} />)}</div>
      </section>}
    </aside>
  </div>;
};
