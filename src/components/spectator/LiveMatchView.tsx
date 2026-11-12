import React, { useEffect, useState } from 'react';
import { BroadcastPlayer } from '../common/BroadcastPlayer';
import { Match, User } from '../../lib/types';
import { hasCampusEmail } from '../../lib/campusAccess';
import { sendMatchChat, watchMatchChat, type LiveChatMessage } from '../../lib/matchChat';
import { useToast } from '../ui/Toast';
import { MatchRostersAndCareerStats } from './MatchRostersAndCareerStats';
import { ArrowLeft, Play, Send } from '../ui/Icons';
import { reportLiveMessage } from '../../lib/communityReports';

interface LiveMatchViewProps {
  match: Match; gameName?: string; currentUser: User; onBack: () => void; readOnly?: boolean;
}

export const LiveMatchView: React.FC<LiveMatchViewProps> = ({ match, gameName, currentUser, onBack, readOnly = false }) => {
  const { showToast } = useToast();
  const statusLabel = ({ live: 'Live', completed: 'Completed', upcoming: 'Upcoming', 'pre-match': 'Pre-match', alert: 'Needs review' } as Record<string, string>)[match.status] || match.status;
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([]);
  const [chatAvailable, setChatAvailable] = useState(false);
  const [chatError, setChatError] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const canPost = !readOnly && hasCampusEmail(currentUser.email);
  useEffect(() => {
    setChatMessages([]);
    setChatAvailable(false);
    setChatError('');
    if (readOnly) return;
    return watchMatchChat(match.id, messages => {
      setChatMessages(messages);
      setChatAvailable(true);
    }, () => { setChatError('Match chat is unavailable.'); setChatAvailable(false); });
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
    } catch {
      showToast('Could not send the message. Check your school sign-in and try again.', 'error');
    } finally {
      setSending(false);
    }
  };

  return <div className="space-y-6 max-w-7xl">
    <button onClick={onBack} className="inline-flex items-center gap-2 text-xs font-medium text-[#888888] hover:text-white"><ArrowLeft size={14} />All live matches</button>
    <header className="dashboard-page-heading">
      <div className="flex items-center gap-2">
        {gameName && <p className="viewer-bracket-game">{gameName}</p>}
        {match.streamTitle && <span className="text-[11px] font-bold text-[#ff6600] px-2 py-0.5 rounded bg-[#ff6600]/10 border border-[#ff6600]/30">{match.streamTitle}</span>}
      </div>
      <h1>{match.team1?.name || 'Awaiting team'} vs {match.team2?.name || 'Awaiting team'}</h1>
      <p>{match.roundName} · {match.matchFormat}</p>
    </header>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <BroadcastPlayer match={match}/>
        <div className="arena-panel live-match-scoreboard">
          <div><strong>{match.team1?.name || 'Awaiting team'}</strong><small>{match.team1?.collegeCode}</small></div>
          <div className="live-match-score"><span className="match-center-live-badge">{statusLabel}</span><strong>{match.score.team1Score} – {match.score.team2Score}</strong></div>
          <div><strong>{match.team2?.name || 'Awaiting team'}</strong><small>{match.team2?.collegeCode}</small></div>
        </div>
        <MatchRostersAndCareerStats match={match} />
      </div>
      <section className="arena-panel live-chat-panel">
        <header><h2>Match chat</h2><p>Visible to viewers of this match.</p></header>
        <div className="live-chat-messages" role="log" aria-label="Match messages">
          {chatError && <p className="module-error" role="alert">{chatError}</p>}
          {!chatMessages.length && !chatError && <p className="studio-muted">{readOnly ? 'Chat is available for published matches.' : chatAvailable ? 'No messages yet.' : 'Loading chat…'}</p>}
          {chatMessages.map(message => <article key={message.id}>
            <strong>{message.author}</strong><p>{message.text}</p>
            {canPost && <button type="button" className="arena-text-button" aria-label={`Report message by ${message.author}`} onClick={() => { void reportLiveMessage(match.id, message).then(() => showToast('Message reported privately to tournament staff.', 'success')).catch(() => showToast('This message may already be reported by you, or reporting is unavailable.', 'error')); }}>Report</button>}
          </article>)}
        </div>
        {canPost ? <form className="live-chat-form" onSubmit={handleSendChat}>
          <label><input type="checkbox" checked={anonymous} onChange={event => setAnonymous(event.target.checked)} /> Post anonymously</label>
          <div><input type="text" aria-label="Match chat message" value={chatInput} onChange={event => setChatInput(event.target.value)}
            placeholder="Say something…" maxLength={500} disabled={!chatAvailable || sending} />
            <button type="submit" aria-label="Send chat message" disabled={!chatInput.trim() || !chatAvailable || sending} className="arena-primary"><Send size={16} /></button>
          </div>
        </form> : !readOnly && <p className="live-chat-readonly">You can read chat. Posting is reserved for verified WMSU accounts.</p>}
      </section>
    </div>
  </div>;
};
