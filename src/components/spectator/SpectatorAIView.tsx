import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Check, Copy, Download, LoaderCircle, PanelLeft, PanelLeftClose, Pencil, Plus, RotateCcw, Search, Settings2, ThumbsDown, ThumbsUp, Trash2, X } from '../ui/Icons';
import { rateAnswer, type AiRating } from '../../lib/aiFeedback';
import { aiService, AI_MODES, type AskFocus, type Allowance } from '../../lib/ai';
import type { AnswerBlock } from '../../lib/aiBlocks';
import type { AiMode } from '../../lib/chatHistory';
import { AnswerBlocks } from './AnswerBlocks';
import { ThinkingPanel } from './ThinkingPanel';
import { AiModePicker, AllowanceMeter } from './AiModePicker';
import './arenaAi.css';
import { browserHistoryStorage, ChatHistory, ChatMessage, ChatThread, ChatReference, deleteThread, parseReferences, emptyHistory, historyKey, legacyKeys, loadHistory, modelHistory, pruneHistory, RetentionDays, saveHistory } from '../../lib/chatHistory';
import { CleanFormattedText } from '../common/CleanFormattedText';
import { ArenaCharacter } from '../ui/ArenaCharacter';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useToast } from '../ui/Toast';
import { Req } from '../ui/Req';

interface SpectatorAIViewProps {
  currentUser?: { id: string; name: string; email: string; role: string; avatarInitials: string; collegeName?: string };
  sidebarOpen?: boolean; onToggleSidebar?: () => void; onOpenBrackets?: () => void;
  /** Opens the bracket or match an answer was checked against. */
  onOpenReference?: (ref: ChatReference) => void;
  /** What the viewer was looking at before opening Arena AI; questions are answered about it. */
  focus?: AskFocus | null;
  onClearFocus?: () => void;
  /** Extra header controls, such as the staff feedback review. */
  headerActions?: React.ReactNode;
}
const retentionLabel = (days: RetentionDays) => days ? `Auto-delete after ${days} days` : 'Keep until I delete';
const uid = () => crypto.randomUUID();

export const SpectatorAIView: React.FC<SpectatorAIViewProps> = ({ currentUser, sidebarOpen: controlledSidebar, onToggleSidebar, onOpenBrackets, onOpenReference, focus, onClearFocus, headerActions }) => {
  const userId = currentUser?.id || 'guest';
  const { showToast } = useToast();
  const [initial] = useState(() => {
    try { return { ...loadHistory(browserHistoryStorage, userId), error: '' }; }
    catch { return { data: emptyHistory(), removed: 0, error: 'Saved history could not be opened. Your original data is unchanged. Export it before resetting history.' }; }
  });
  const [data, setData] = useState<ChatHistory>(initial.data);
  const dataRef = useRef(data); dataRef.current = data;
  const canSave = useRef(!initial.error);
  const [storageError, setStorageError] = useState(initial.error);
  const [notice, setNotice] = useState(initial.removed ? `${initial.removed} inactive conversation${initial.removed === 1 ? ' was' : 's were'} removed under your history policy.` : '');
  const [localSidebar, setLocalSidebar] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const sidebarOpen = controlledSidebar ?? localSidebar;
  const toggleSidebar = () => onToggleSidebar ? onToggleSidebar() : setLocalSidebar(value => !value);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyFeedback, setPolicyFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [policyDays, setPolicyDays] = useState<RetentionDays>(data.retentionDays);
  const [toDelete, setToDelete] = useState<ChatThread | 'all' | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  // The chosen mode is a per-browser convenience; the server enforces the allowance whatever is chosen.
  const modeKey = `arenahub_ai_mode_${userId}`;
  const [mode, setModeState] = useState<AiMode>(() => {
    try { const saved = localStorage.getItem(modeKey); return saved === 'quick' || saved === 'deep' ? saved : 'think'; } catch { return 'think'; }
  });
  const setMode = (next: AiMode) => { setModeState(next); try { localStorage.setItem(modeKey, next); } catch { /* not remembered */ } };
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void aiService.getAllowance(controller.signal).then(value => { if (!controller.signal.aborted) setAllowance(value); });
    return () => controller.abort();
  }, [userId]);
  const request = useRef<{ controller: AbortController; threadId: string; messageId: string } | null>(null);
  const mounted = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const historyToggle = useRef<HTMLButtonElement>(null);
  const historyId = useId();
  const end = useRef<HTMLDivElement>(null);
  const active = data.threads.find(thread => thread.id === data.activeThreadId);
  const messages = active?.messages || [];
  const visibleThreads = useMemo(() => [...data.threads].sort((a,b) => b.updatedAt - a.updatedAt).filter(thread => `${thread.title} ${thread.messages.map(m => m.text).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())), [data.threads, search]);

  const persist = (current: ChatHistory) => {
    if (!canSave.current) return;
    try { saveHistory(browserHistoryStorage, userId, current); setStorageError(''); }
    catch { setStorageError('History could not be saved. Older chats have not been removed. Free browser storage or download your chats.'); }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => persist(data), 180);
    return () => window.clearTimeout(timer);
  }, [data, userId]);
  useEffect(() => {
    mounted.current = true;
    const flush = () => { if (canSave.current) { try { saveHistory(browserHistoryStorage, userId, dataRef.current); } catch {} } };
    window.addEventListener('pagehide', flush);
    return () => { mounted.current = false; request.current?.controller.abort(); flush(); window.removeEventListener('pagehide', flush); };
  }, [userId]);
  useEffect(() => {
    const cleanup = () => {
      if (document.visibilityState === 'hidden') return;
      const result = pruneHistory(dataRef.current);
      if (result.removed) { setData(result.data); setNotice(`${result.removed} inactive conversation${result.removed === 1 ? ' was' : 's were'} removed under your history policy.`); }
    };
    const timer = window.setInterval(cleanup, 60_000);
    window.addEventListener('focus', cleanup); document.addEventListener('visibilitychange', cleanup);
    return () => { clearInterval(timer); window.removeEventListener('focus', cleanup); document.removeEventListener('visibilitychange', cleanup); };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'auto', block: 'end' }); }, [messages.length, loading, messages.at(-1)?.text]);

  const updateReply = (threadId: string, messageId: string, update: Partial<ChatMessage>) => {
    if (!mounted.current) return;
    setData(current => ({ ...current, threads: current.threads.map(thread => thread.id === threadId ? { ...thread, updatedAt: Date.now(), messages: thread.messages.map(message => message.id === messageId ? { ...message, ...update } : message) } : thread) }));
  };
  const runReply = async (threadId: string, messageId: string, prompt: string, previous: ChatMessage[]) => {
    const controller = new AbortController(); request.current = { controller, threadId, messageId }; setLoading(true);
    let text = '', thinking = '', firstText: number | undefined;
    const steps: string[] = [], blocks: AnswerBlock[] = [];
    const startedAt = Date.now();
    updateReply(threadId, messageId, { mode, timestamp: startedAt });
    try {
      for await (const chunk of aiService.streamAnswer(prompt, modelHistory(previous), controller.signal, focus, mode)) {
        if (chunk.step) steps.push(chunk.step);
        if (chunk.thinking) thinking += chunk.thinking;
        if (chunk.block) blocks.push(chunk.block);
        text = chunk.replace ? chunk.delta : text + chunk.delta;
        if (text && firstText === undefined) firstText = Date.now() - startedAt;
        const meta = chunk.meta;
        if (meta?.allowance) setAllowance(meta.allowance);
        if (meta?.allowanceUsed) setNotice(`You have used this window’s Arena AI allowance, so the live records answered.${meta.allowance?.resetsAt ? ` A fresh allowance starts at ${new Date(meta.allowance.resetsAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}.` : ''}`);
        updateReply(threadId, messageId, {
          text, source: chunk.source, status: chunk.done ? 'complete' : 'writing',
          steps: [...steps], ...(thinking ? { thinking } : {}), blocks: [...blocks],
          // Thinking ends at the first word of the answer; the server's own measurement wins when it sends one.
          ...(meta?.thoughtMs !== undefined ? { thoughtMs: meta.thoughtMs } : firstText !== undefined ? { thoughtMs: firstText } : {}),
          ...(meta?.cached ? { cached: true } : {}), ...(meta?.mode ? { mode: meta.mode } : {}),
          ...(chunk.references?.length ? { references: parseReferences(chunk.references) } : {}),
        });
        if (chunk.done) break;
      }
      if (controller.signal.aborted) throw new Error('stopped');
      updateReply(threadId, messageId, { status: 'complete' });
    } catch {
      // A broken stream keeps what was already written; Retry asks again.
      updateReply(threadId, messageId, { text: text || (controller.signal.aborted ? 'Response stopped. You can try again.' : 'That response could not be completed. Please try again.'), status: controller.signal.aborted ? 'stopped' : 'error' });
    } finally { request.current = null; if (mounted.current) setLoading(false); }
  };
  const send = async (suggestion?: string) => {
    const prompt = (suggestion ?? input).trim();
    if (!prompt || prompt.length > 4000 || request.current) return;
    const now = Date.now(); const threadId = active?.id || uid(); const messageId = uid();
    const userMessage: ChatMessage = { id: uid(), sender: 'user', text: prompt, timestamp: now, status: 'complete' };
    const assistantMessage: ChatMessage = { id: messageId, sender: 'assistant', text: '', timestamp: now, status: 'writing' };
    const previous = active?.messages || [];
    setData(current => ({ ...current, activeThreadId: threadId, threads: active ? current.threads.map(thread => thread.id === threadId ? { ...thread, updatedAt: now, messages: [...thread.messages, userMessage, assistantMessage] } : thread) : [{ id: threadId, title: prompt.slice(0, 70), createdAt: now, updatedAt: now, messages: [userMessage, assistantMessage] }, ...current.threads] }));
    setInput(''); setNotice('');
    await runReply(threadId, messageId, prompt, previous);
  };
  const retry = async (message: ChatMessage) => {
    if (!active || request.current) return;
    const index = active.messages.findIndex(m => m.id === message.id);
    let userIndex = index - 1;
    while (userIndex >= 0 && active.messages[userIndex].sender !== 'user') userIndex--;
    if (userIndex < 0) return;
    updateReply(active.id, message.id, { text: '', status: 'writing', references: undefined, source: undefined, steps: undefined, thinking: undefined, blocks: undefined, thoughtMs: undefined, cached: undefined, rating: undefined });
    await runReply(active.id, message.id, active.messages[userIndex].text, active.messages.slice(0,userIndex));
  };
  const rate = async (message: ChatMessage, rating: AiRating) => {
    if (!active || message.rating) return;
    const index = active.messages.findIndex(m => m.id === message.id);
    const question = [...active.messages.slice(0, index)].reverse().find(m => m.sender === 'user')?.text || '';
    updateReply(active.id, message.id, { rating });
    try {
      await rateAnswer({ messageId: message.id, rating, question, answer: message.text, source: message.source, references: message.references });
      showToast(rating === 'up' ? 'Thanks for the feedback.' : 'Thanks. Tournament staff review answers marked not helpful.', 'success');
    } catch {
      updateReply(active.id, message.id, { rating: undefined });
      showToast('Your rating could not be saved. Try again.', 'error');
    }
  };
  const exportChats = () => {
    const originals: Record<string, string> = {};
    if (!canSave.current) for (const key of [historyKey(userId), ...legacyKeys(userId)]) {
      try { const raw = browserHistoryStorage.getItem(key); if (raw !== null) originals[key] = raw; } catch {}
    }
    const file = new Blob([JSON.stringify({ ...dataRef.current, ...(Object.keys(originals).length ? { unreadableOriginals: originals } : {}) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'arenahub-conversations.json'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openPolicy = () => {
    setPolicyDays(data.retentionDays);
    setPolicyFeedback(null);
    setPolicyOpen(true);
  };
  const pendingPolicy = pruneHistory({ ...data, retentionDays: policyDays });
  const applyPolicy = () => {
    if (loading || !canSave.current) return;
    try {
      saveHistory(browserHistoryStorage, userId, pendingPolicy.data);
    } catch {
      setPolicyFeedback({ text: 'The policy could not be saved to browser storage. Your previous policy is still active.', error: true });
      return;
    }

    setData(pendingPolicy.data);
    setStorageError('');
    const removed = pendingPolicy.removed;
    setPolicyFeedback({
      text: `Policy saved. ${retentionLabel(policyDays)}.${removed ? ` Removed ${removed} inactive conversation${removed === 1 ? '' : 's'}.` : ''}`,
    });
  };
  const closeHistory = () => {
    toggleSidebar();
    historyToggle.current?.focus();
  };
  const closeMobileHistory = () => {
    if (sidebarOpen && window.matchMedia('(max-width: 767px)').matches) closeHistory();
  };
  const newChat = () => {
    if (request.current) return;
    setData(current => ({ ...current, activeThreadId: null }));
    setInput('');
    setNotice('');
    closeMobileHistory();
    composer.current?.focus();
  };

  return <div className={`arena-chat ${sidebarOpen ? 'has-history' : ''}`} onKeyDown={event => {
    if (event.key === 'Escape' && sidebarOpen && !event.defaultPrevented && !policyOpen && !toDelete && !renameId) closeHistory();
  }}>
    <button ref={historyToggle} type="button" className="quiet-icon-button chat-history-toggle"
      aria-label={sidebarOpen ? 'Hide conversation history' : 'Show conversation history'}
      data-tooltip={sidebarOpen ? 'Hide history' : 'Show history'}
      aria-controls={historyId} aria-expanded={sidebarOpen} onClick={toggleSidebar}>
      {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
    </button>
    {sidebarOpen && <div className="chat-history-scrim" aria-hidden="true" onClick={closeHistory} />}
    <aside id={historyId} className="chat-history" hidden={!sidebarOpen} aria-label="Conversation history">
      <div className="chat-history-heading">History</div>
      <div className="chat-history-tools">
        <button type="button" className="chat-new" disabled={loading} onClick={newChat}><Plus size={17} /> New chat</button>
        <label className="chat-history-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search conversations" placeholder="Search conversations" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </div>
      <h2 className="chat-history-list-heading">Recent chats</h2>
      <div className="chat-history-list">
        {visibleThreads.length === 0 && <p className="chat-history-empty">{search ? 'No conversations match your search.' : 'Your conversations will appear here.'}</p>}
        {visibleThreads.map(thread => <div key={thread.id} className={`chat-history-row ${thread.id === active?.id ? 'is-active' : ''}`}>
          <button type="button" className="chat-history-select" title={thread.title} aria-current={thread.id === active?.id ? 'true' : undefined} disabled={loading}
            onClick={() => { setData(current => ({ ...current, activeThreadId: thread.id })); setInput(''); closeMobileHistory(); }}>
            <span className="chat-history-title">{thread.title}</span>
          </button>
          <button className="quiet-icon-button chat-delete" disabled={loading} aria-label={`Delete ${thread.title}`} data-tooltip="Delete chat" data-tooltip-align="end" onClick={() => setToDelete(thread)}><Trash2 size={15} /></button>
        </div>)}
      </div>
      <button className="chat-history-policy" onClick={openPolicy}><Settings2 size={16} /><span>History settings<small>{retentionLabel(data.retentionDays)}</small></span></button>
    </aside>
    <section className="chat-conversation" aria-label="Arena AI conversation">
      <header className="chat-header">
        <div><ArenaCharacter /><h1 title={active?.title}>{active?.title || 'Arena AI'}</h1></div>
        {headerActions}
        {active && <button type="button" className="quiet-icon-button" disabled={loading} aria-label="Rename conversation" data-tooltip="Rename chat" data-tooltip-align="end"
          onClick={() => { setRenameId(active.id); setRenameTitle(active.title); }}><Pencil size={16} /></button>}
      </header>
      {storageError && <div className="chat-storage-error" role="alert"><span>{storageError}</span><button onClick={exportChats}>Download chats</button></div>}
      {notice && <div className="chat-inline-notice" role="status"><span>{notice}</span><button className="quiet-icon-button" aria-label="Dismiss history notice" data-tooltip="Dismiss" data-tooltip-align="end" onClick={() => setNotice('')}><X size={14} /></button></div>}
      <div className="chat-scroll" role="log" aria-label="Conversation messages" aria-live="polite" aria-busy={loading}>
        {!messages.length ? <div className="chat-empty"><img className="arena-character" src="/arenahub-logo.svg" alt="" width="90" height="106"/><h2>Ask about your next match</h2><p>Scores, schedules, standings and rosters, checked against the published records.<br />Ask in English or Filipino.</p><div className="chat-suggestions">{['Who plays next?', 'When is our next match?', 'Top MLBB players by KDA', 'Sino nanalo sa MLBB?'].map(text => <button key={text} onClick={() => void send(text)}>{text}<ArrowUpRight size={14} aria-hidden="true" /></button>)}</div></div> : <div className="chat-messages">{messages.map((message, index) => <article key={message.id} className={`chat-message from-${message.sender}`} aria-label={message.sender === 'user' ? 'You' : 'Arena AI'}>
          {message.sender === 'user' ? <div className="chat-user-text">{message.text}</div> : <div className="chat-assistant-text"><span className="chat-answer-label"><img src="/arenahub-logo.svg" alt="" width={18} height={21} /> Arena AI{message.mode && <span className="chat-mode-tag">{AI_MODES.find(m => m.id === message.mode)?.name}</span>}</span>
            {(message.mode && message.mode !== 'quick') || message.steps?.length || message.thinking
              ? <ThinkingPanel steps={message.steps || []} thinking={message.thinking} working={message.status === 'writing' && !message.text} thoughtMs={message.thoughtMs} startedAt={message.timestamp} /> : null}
            {message.text ? <CleanFormattedText text={message.text} isStreaming={message.status === 'writing'} />
              : message.status === 'writing' && (!message.mode || message.mode === 'quick') ? <span className="chat-writing"><LoaderCircle size={15} className="animate-spin" /> Writing a response…</span> : null}
            {!!message.blocks?.length && <AnswerBlocks blocks={message.blocks} />}
            {message.status !== 'writing' && !!message.references?.length && <p className="chat-references"><span>Checked:</span> {message.references.map((ref, i) => <React.Fragment key={`${ref.bracketId}-${ref.matchId}-${i}`}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              {onOpenReference && (ref.bracketId || ref.matchId) ? <button type="button" className="chat-reference" onClick={() => onOpenReference(ref)}>{ref.label}</button> : <span>{ref.label}</span>}
            </React.Fragment>)}</p>}
            {message.status !== 'writing' && <div className="chat-response-actions"><button className="quiet-icon-button" aria-label="Copy response" data-tooltip={copied === message.id ? 'Copied' : 'Copy'} onClick={async () => { try { await navigator.clipboard.writeText(message.text); setCopied(message.id); window.setTimeout(() => setCopied(null), 1600); } catch { showToast('Copy is unavailable. Select the response text to copy it.', 'error'); } }}>{copied === message.id ? <Check size={16} /> : <Copy size={16} />}</button>{message.source && message.status === 'complete' && userId !== 'guest' && <>
              <button className={`quiet-icon-button${message.rating === 'up' ? ' is-chosen' : ''}`} disabled={!!message.rating} aria-pressed={message.rating === 'up'} aria-label="Helpful answer" data-tooltip={message.rating ? 'Rated' : 'Helpful'} onClick={() => void rate(message, 'up')}><ThumbsUp size={15} /></button>
              <button className={`quiet-icon-button${message.rating === 'down' ? ' is-chosen' : ''}`} disabled={!!message.rating} aria-pressed={message.rating === 'down'} aria-label="Not helpful answer" data-tooltip={message.rating ? 'Rated' : 'Not helpful: staff see the question and answer'} onClick={() => void rate(message, 'down')}><ThumbsDown size={15} /></button>
            </>}{index === messages.length - 1 && <button className="quiet-icon-button" disabled={loading} aria-label="Retry response" data-tooltip="Retry" onClick={() => void retry(message)}><RotateCcw size={16} /></button>}<small>{message.status === 'stopped' ? 'Stopped' : message.status === 'error' ? 'Response unavailable' : message.source || 'Saved response'}</small>{message.cached && message.status === 'complete' && <span className="chat-reused" title="Someone asked this recently and the records have not changed, so the same answer was reused. It did not use your allowance.">Reused answer</span>}{onOpenBrackets && /bracket/i.test(message.text) && <button className="chat-text-link" onClick={onOpenBrackets}>Open bracket studio <ArrowUpRight size={14} aria-hidden="true" /></button>}</div>}
          </div>}
        </article>)}<div ref={end} /></div>}
      </div>
      <div className="chat-composer-area">{focus && <p className="chat-focus" role="status"><span>Thinking about:</span> <strong>{focus.label}</strong>{onClearFocus && <button type="button" className="quiet-icon-button" aria-label={`Stop asking about ${focus.label}`} data-tooltip="Ask about everything" onClick={onClearFocus}><X size={13} /></button>}</p>}<form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}><textarea ref={composer} aria-label="Message Arena AI" value={input} maxLength={4000} rows={2} placeholder="Ask Arena anything…" onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><footer><div className="chat-composer-tools"><AiModePicker mode={mode} onChange={setMode} allowance={allowance} disabled={loading} /><AllowanceMeter allowance={allowance} /></div>{loading ? <button type="button" className="chat-send is-stop" aria-label="Stop response" data-tooltip="Stop response" data-tooltip-align="end" onClick={() => request.current?.controller.abort()}><span /></button> : <button className="chat-send" type="submit" disabled={!input.trim()} aria-label="Send message" data-tooltip="Send message" data-tooltip-align="end"><ArrowUp size={18} /></button>}</footer></form><p className="chat-footnote">{data.retentionDays ? `Chats auto-delete after ${data.retentionDays} days without a new message.` : 'Chats stay until you delete them.'} <button onClick={openPolicy}>History settings</button></p></div>
    </section>
    <Modal open={policyOpen} title="Your history, your choice." description="One history for Arena AI, shared between your viewer and organizer workspaces on this browser." onClose={() => setPolicyOpen(false)}>
      <form className="module-form" onSubmit={event => { event.preventDefault(); applyPolicy(); }}><label>Automatically delete inactive chats<select aria-label="History retention" value={policyDays} onChange={event => { setPolicyDays(Number(event.target.value) as RetentionDays); setPolicyFeedback(null); }}><option value="30">After 30 days without a new message</option><option value="90">After 90 days without a new message</option><option value="180">After 180 days without a new message</option><option value="0">Keep until I delete</option></select></label>
        <div className="history-policy-copy"><p>The timer starts from the last message sent or received. Opening or reading a chat does not extend it.</p><p>Cleanup runs when Arena AI opens, when you return to it, and every minute while it is open. If it is closed, expired chats are removed the next time you open it.</p><p>Chats are saved for this account in this browser. Signing out keeps them. They are not synced across devices. Clearing site data, private browsing, or browser storage limits can affect saved history.</p><p>Long conversations stay in history even when only recent messages are used to answer. This policy covers ArenaHub’s saved copy; the online AI provider has its own retention policy.</p></div>
        {pendingPolicy.removed > 0 && <p className="module-error" role="alert">Applying this policy will permanently remove {pendingPolicy.removed} inactive conversation{pendingPolicy.removed === 1 ? '' : 's'} now. Download them first if you want a copy.</p>}
        <div className="history-data-actions"><button type="button" className="chat-text-link" onClick={exportChats}><Download size={15} /> Download chats</button><button type="button" disabled={loading || (!data.threads.length && canSave.current)} className="chat-text-link danger" onClick={() => { setPolicyOpen(false); setToDelete('all'); }}>Delete all chats</button></div>
        {policyFeedback && <p className={policyFeedback.error ? 'module-error' : 'settings-notice'} role={policyFeedback.error ? 'alert' : 'status'}>{policyFeedback.text}</p>}
        <footer className="dialog-actions">
          <button type="button" className="arena-outline" onClick={() => setPolicyOpen(false)}>{policyFeedback && !policyFeedback.error ? 'Done' : 'Cancel'}</button>
          {(!policyFeedback || policyFeedback.error) && <button className="arena-primary" type="submit" disabled={loading || !canSave.current}>{pendingPolicy.removed ? `Apply and delete ${pendingPolicy.removed} chats` : 'Save policy'}</button>}
        </footer>
      </form>
    </Modal>
    <ConfirmModal isOpen={toDelete !== null} title={toDelete === 'all' ? 'Delete all conversations?' : 'Delete this conversation?'} description={toDelete === 'all' ? 'All Arena AI conversations saved for this account in this browser will be permanently removed. Your history policy will be kept. Download a copy first if you need one.' : `“${toDelete?.title || ''}” will be permanently removed from this browser’s history.`} confirmLabel={toDelete === 'all' ? 'Delete all chats' : 'Delete conversation'} isDestructive onCancel={() => setToDelete(null)} onConfirm={() => { if (!toDelete) return; const next: ChatHistory = toDelete === 'all' ? { ...data, threads: [], activeThreadId: null } : deleteThread(data, toDelete.id); if (canSave.current || toDelete === 'all') { saveHistory(browserHistoryStorage, userId, next); canSave.current = true; setStorageError(''); } setData(next); setInput(''); setToDelete(null); }} />
    <Modal open={renameId !== null} title="Rename conversation" onClose={() => setRenameId(null)}><form className="module-form" onSubmit={event => { event.preventDefault(); if (!renameTitle.trim()) return; setData(current => ({ ...current, threads: current.threads.map(thread => thread.id === renameId ? { ...thread, title: renameTitle.trim() } : thread) })); setRenameId(null); }}><label><Req>Conversation name</Req><input autoFocus required maxLength={100} value={renameTitle} onChange={event => setRenameTitle(event.target.value)} /></label><footer className="dialog-actions"><button type="button" className="arena-outline" onClick={() => setRenameId(null)}>Cancel</button><button className="arena-primary" type="submit">Save name</button></footer></form></Modal>
  </div>;
};
