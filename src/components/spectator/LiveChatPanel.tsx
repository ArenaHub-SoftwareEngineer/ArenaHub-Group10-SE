import React, { useEffect, useRef, useState } from 'react';
import type { User } from '../../lib/types';
import {
  deleteChatMessage, kickChatUser, lastMessageAt, muteChatUser, pinChatMessage, sendMatchChat, setSlowMode, unmuteChatUser,
  unpinChatMessage, watchChatState, watchMatchChat, watchMatchMutes, watchMyMute,
  type ChatMute, type ChatState, type LiveChatMessage,
} from '../../lib/matchChat';
import {
  DEFAULT_MUTE_MINUTES, formatChatTime, formatCountdown, isStaffRole, KICK_HOURS, MUTE_PRESETS, muteSecondsLeft,
  SLOW_MODE_OPTIONS, slowModeLabel, slowModeSecondsLeft,
} from '../../lib/chatModeration';
import { reportLiveMessage } from '../../lib/communityReports';
import { useToast } from '../ui/Toast';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Clock, Flag, Pin, Send, Shield, X } from '../ui/Icons';

interface LiveChatPanelProps { matchId: string; currentUser: User; readOnly: boolean; canPost: boolean }

const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
const failure = (error: unknown, fallback: string) => {
  const code = (error as { code?: string })?.code;
  if (code === 'permission-denied') return `${fallback} Your session may have lost staff access; sign in again.`;
  if (code === 'unavailable') return `${fallback} You appear to be offline.`;
  return error instanceof Error && !code ? error.message : fallback;
};

/** Live match chat with timed mutes, kicks, slow mode, a pinned message and staff badges. */
export const LiveChatPanel: React.FC<LiveChatPanelProps> = ({ matchId, currentUser, readOnly, canPost }) => {
  const { showToast } = useToast();
  const staff = canPost && isStaffRole(currentUser.role);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<ChatState>({ slowModeSec: 0, pinned: null });
  const [myMute, setMyMute] = useState<ChatMute | null>(null);
  const [mutes, setMutes] = useState<Array<ChatMute & { uid: string }>>([]);
  const [lastSent, setLastSent] = useState<number | undefined>();
  const [now, setNow] = useState(() => Date.now());
  const [input, setInput] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [kickTarget, setKickTarget] = useState<LiveChatMessage | null>(null);
  const [showMutes, setShowMutes] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]); setAvailable(false); setError('');
    if (readOnly) return;
    const stops = [
      watchMatchChat(matchId, list => { setMessages(list); setAvailable(true); }, () => { setError('Match chat is unavailable.'); setAvailable(false); }),
      watchChatState(matchId, setState),
    ];
    if (canPost) {
      // Refresh the clock with each mute change so the countdown starts from the real time, not the mount time.
      stops.push(watchMyMute(matchId, currentUser.id, mute => { setNow(Date.now()); setMyMute(mute); }));
      void lastMessageAt(matchId, currentUser.id).then(at => { setNow(Date.now()); setLastSent(at); });
    }
    if (staff) stops.push(watchMatchMutes(matchId, list => { setNow(Date.now()); setMutes(list); }));
    return () => stops.forEach(stop => stop());
  }, [matchId, readOnly, canPost, staff, currentUser.id]);

  const muteLeft = muteSecondsLeft(myMute?.until, now);
  const slowLeft = slowModeSecondsLeft(lastSent, state.slowModeSec, now, staff);
  // Tick once a second only while a countdown is showing.
  useEffect(() => {
    if (!muteLeft && !slowLeft && !(staff && mutes.length)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [muteLeft > 0, slowLeft > 0, staff && mutes.length > 0]);

  useEffect(() => { const log = logRef.current; if (log) log.scrollTop = log.scrollHeight; }, [messages.length]);
  useEffect(() => {
    if (!menuFor) return;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as HTMLElement).closest('.watch-chat-menu, .watch-chat-moderate')) setMenuFor(null);
    };
    document.addEventListener('keydown', close); document.addEventListener('mousedown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', close); };
  }, [menuFor]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!canPost || !available || !text || sending || muteLeft || slowLeft) return;
    setSending(true);
    try {
      const name = currentUser.name.trim();
      await sendMatchChat(matchId, currentUser.id, anonymous || !name || name.includes('@') ? 'Anonymous' : name, text, staff);
      setInput(''); setLastSent(Date.now()); setNow(Date.now());
    } catch (err) {
      const code = (err as { code?: string })?.code;
      showToast(code === 'permission-denied'
        ? (state.slowModeSec ? `Slow mode is on. Wait ${slowModeLabel(state.slowModeSec)} between messages.` : 'Could not send. You may be muted, or posting too fast.')
        : 'Could not send the message. Check your school sign-in and try again.', 'error');
      void lastMessageAt(matchId, currentUser.id).then(setLastSent);
    } finally { setSending(false); }
  };

  const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
    setMenuFor(null);
    try { await action(); showToast(success, 'success'); } catch (err) { showToast(failure(err, fallback), 'error'); }
  };
  const mute = (message: LiveChatMessage, minutes: number) => run(() => muteChatUser(matchId, currentUser.id, message, minutes),
    `${message.author} is muted for ${minutes} minutes.`, 'Could not mute this viewer.');
  const kick = async () => {
    const target = kickTarget; if (!target) return;
    const removed = await kickChatUser(matchId, currentUser.id, target, 'Removed by staff');
    setKickTarget(null);
    showToast(`Removed from chat for ${KICK_HOURS} hours. ${removed} message${removed === 1 ? '' : 's'} deleted.`, 'success');
  };

  const muteText = myMute?.kind === 'kick' ? 'Staff removed you from this chat.' : 'Staff muted you in this chat.';

  return <section className="watch-chat" aria-label="Match chat">
    <header>
      <h2>Live chat</h2>
      <small>{state.slowModeSec ? <span className="watch-chat-slow"><Clock size={12} />Slow mode {slowModeLabel(state.slowModeSec)}</span>
        : messages.length ? `${messages.length} messages` : 'Visible to viewers of this match'}</small>
    </header>

    {staff && <div className="watch-chat-staffbar">
      <label>Slow mode
        <select value={state.slowModeSec} onChange={event => { const seconds = Number(event.target.value); void run(() => setSlowMode(matchId, currentUser.id, seconds, state), seconds ? `Slow mode set to ${slowModeLabel(seconds)}.` : 'Slow mode is off.', 'Could not change slow mode.'); }}>
          {SLOW_MODE_OPTIONS.map(sec => <option key={sec} value={sec}>{slowModeLabel(sec)}</option>)}
        </select>
      </label>
      <button type="button" className="watch-chat-mutes-toggle" aria-expanded={showMutes} onClick={() => setShowMutes(value => !value)} disabled={!mutes.length}>
        <Shield size={14} />{mutes.length ? `${mutes.length} muted` : 'No one muted'}
      </button>
    </div>}
    {staff && showMutes && mutes.length > 0 && <ul className="watch-chat-mutes" aria-label="Muted viewers">
      {mutes.map(item => <li key={item.uid}>
        <span>{item.kind === 'kick' ? 'Removed' : 'Muted'}: <strong>{item.name || 'Viewer'}</strong> · {formatCountdown(muteSecondsLeft(item.until, now))} left</span>
        <button type="button" onClick={() => void run(() => unmuteChatUser(matchId, currentUser.id, item.uid), 'Viewer can post again.', 'Could not lift the mute.')}>Lift</button>
      </li>)}
    </ul>}

    {state.pinned && <div className="watch-chat-pinned" role="note" aria-label="Pinned message">
      <Pin size={14} />
      <p><strong>{state.pinned.author}</strong> {state.pinned.text}</p>
      {staff && <button type="button" aria-label="Unpin message" onClick={() => void run(() => unpinChatMessage(matchId, currentUser.id, state), 'Message unpinned.', 'Could not unpin.')}><X size={14} /></button>}
    </div>}

    <div className="watch-chat-log" role="log" aria-label="Match messages" ref={logRef}>
      {error && <p className="module-error" role="alert">{error}</p>}
      {!messages.length && !error && <p className="watch-chat-empty">{readOnly ? 'Chat is available for published matches.' : available ? 'No messages yet. Say hi to the other viewers.' : 'Loading chat…'}</p>}
      {messages.map(message => <article key={message.id} className={`watch-chat-message${message.badge ? ' is-staff' : ''}`}>
        <span className="watch-chat-avatar" aria-hidden="true">{initials(message.author)}</span>
        <p>
          <strong>{message.author}</strong>
          {message.badge && <span className="watch-chat-badge">Staff</span>}
          {message.createdAt && <time dateTime={new Date(message.createdAt).toISOString()}>{formatChatTime(message.createdAt)}</time>}
          <span className="watch-chat-text">{message.text}</span>
        </p>
        {staff ? <>
          <button type="button" className="watch-chat-report watch-chat-moderate" aria-label={`Moderate message by ${message.author}`} aria-haspopup="menu" aria-expanded={menuFor === message.id} data-tip="Moderate"
            onClick={() => setMenuFor(open => open === message.id ? null : message.id)}><Shield size={14} /></button>
          {menuFor === message.id && <div className="watch-chat-menu" role="menu" aria-label={`Moderate ${message.author}`}>
            <button type="button" role="menuitem" onClick={() => void run(() => pinChatMessage(matchId, currentUser.id, message, state), 'Message pinned.', 'Could not pin.')}>Pin message</button>
            <button type="button" role="menuitem" onClick={() => void run(() => deleteChatMessage(matchId, currentUser.id, message.id, state), 'Message deleted.', 'Could not delete.')}>Delete message</button>
            <span className="watch-chat-menu-label">Mute author</span>
            {MUTE_PRESETS.map(minutes => <button key={minutes} type="button" role="menuitem" onClick={() => void mute(message, minutes)}>
              {minutes} minutes{minutes === DEFAULT_MUTE_MINUTES ? ' (default)' : ''}</button>)}
            <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuFor(null); setKickTarget(message); }}>Remove from chat…</button>
          </div>}
        </> : canPost && <button type="button" className="watch-chat-report" aria-label={`Report message by ${message.author}`} data-tip="Report"
          onClick={() => { void reportLiveMessage(matchId, message).then(() => showToast('Message reported privately to tournament staff.', 'success')).catch(() => showToast('This message may already be reported by you, or reporting is unavailable.', 'error')); }}><Flag size={14} /></button>}
      </article>)}
    </div>

    {canPost ? muteLeft ? <p className="watch-chat-muted" role="status"><Shield size={14} /><span>{muteText} You can post again in <strong>{formatCountdown(muteLeft)}</strong>.</span></p>
      : <form className="watch-chat-form" onSubmit={send}>
        <span className="watch-chat-avatar" aria-hidden="true">{anonymous ? '?' : initials(currentUser.name || 'You')}</span>
        <input type="text" aria-label="Match chat message" value={input} onChange={event => setInput(event.target.value)} placeholder={slowLeft ? `Slow mode: wait ${slowLeft}s` : 'Chat…'} maxLength={500} disabled={!available || sending} />
        <button type="submit" className="shell-icon-button" aria-label={slowLeft ? `Wait ${slowLeft} seconds` : 'Send chat message'} disabled={!input.trim() || !available || sending || slowLeft > 0}>
          {slowLeft ? <span className="watch-chat-wait" aria-hidden="true">{slowLeft}</span> : <Send size={18} />}
        </button>
        <label className="watch-chat-anon"><input type="checkbox" checked={anonymous} onChange={event => setAnonymous(event.target.checked)} /> Post anonymously</label>
      </form>
      : !readOnly && <p className="watch-chat-readonly">You can read chat. Posting is reserved for verified WMSU accounts.</p>}

    <ConfirmModal isOpen={!!kickTarget} title="Remove this viewer from chat?"
      description={`${kickTarget?.author || 'This viewer'} will not be able to post for ${KICK_HOURS} hours, and their messages in this match will be deleted. This is recorded in the audit log.`}
      confirmLabel="Remove from chat" isDestructive onConfirm={kick} onCancel={() => setKickTarget(null)} />
  </section>;
};
