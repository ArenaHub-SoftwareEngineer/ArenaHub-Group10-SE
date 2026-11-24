import React, { useEffect, useRef, useState } from 'react';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame, evidenceContext } from '../../lib/fairPlayGames';
import type { Match, Team } from '../../lib/types';
import type { IntegrityCase } from '../../lib/integrityChecks';
import { subscribeIntegrityCases, submitIntegrityCase, reviewIntegrityCase, saveVideoReview, subscribeCaseActivity, subscribeCaseAppeal, submitCaseAppeal, resolveCaseAppeal } from '../../lib/integrityService';
import { useAuth } from '../../lib/authContext';
import { VideoReviewWorkbench } from './VideoReviewWorkbench';
import { ShieldCheck, ExternalLink, FileCheck2 } from '../ui/Icons';
import { Modal } from '../ui/Modal';
import { readEvidence, type EvidenceFile } from '../../lib/evidenceStorage';
import type { ReviewGame } from '../../lib/videoReview';
import { Req } from '../ui/Req';
import { errorMessage } from '../../lib/errors';
import { aiService } from '../../lib/ai';
import { buildCaseDigest } from '../../lib/caseDigest';
import { matchLabel } from '../../lib/integrityChecks';
import './FeatureDialogs.css';
import { matchName } from '../../lib/matchName';

function PrivateImage({ file }: { file: EvidenceFile }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let active = true, objectUrl = ''; setUrl(''); setError('');
    readEvidence(file).then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (active) setError('Private image could not open. Check your connection and access.'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.path]);
  return error ? <p className="field-error" role="alert">{error}</p> : url ? <img className="fairplay-private-image" src={url} alt={file.name} /> : <p className="field-hint" role="status">Opening private screenshot…</p>;
}
/**
 * Staff only. A short reading aid for the referee: Arena AI (Groq only, plan Q5) or, without a model, the case
 * digest built on this device. It never decides anything and is not saved to the case.
 */
function CaseSummary({ record, events, label }: { record: IntegrityCase; events: any[]; label: string }) {
  const [state, setState] = useState<{ phase: 'idle' | 'busy' } | { phase: 'done'; text: string; source: 'model' | 'digest'; note?: string }>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = async () => {
    controller.current?.abort();
    const current = controller.current = new AbortController();
    setState({ phase: 'busy' });
    const result = await aiService.summarizeCase(record.id, current.signal);
    if (current.signal.aborted) return;
    setState(result.ok ? { phase: 'done', text: result.summary, source: result.source }
      : { phase: 'done', text: buildCaseDigest(record, events, label).text, source: 'digest', note: `${result.message} Showing the case digest from this device.` });
  };
  return <section className="case-summary" aria-labelledby={`case-summary-${record.id}`}>
    <div className="case-summary-head">
      <h3 id={`case-summary-${record.id}`}>Summary for review</h3>
      <button type="button" className="arena-outline arena-sm" disabled={state.phase === 'busy'} onClick={() => void run()}>
        {state.phase === 'busy' ? 'Summarizing…' : state.phase === 'done' ? 'Summarize again' : 'Summarize case'}
      </button>
    </div>
    {state.phase === 'idle' && <p className="field-hint">Reads the report, evidence list and staff history. Reporter accounts, emails and links are left out.</p>}
    {state.phase === 'busy' && <p className="field-hint" role="status">Reading the case…</p>}
    {state.phase === 'done' && <>
      <p className="case-summary-source"><span className={`status-pill ${state.source === 'model' ? 'is-info' : ''}`}>{state.source === 'model' ? 'Arena AI draft' : 'Case digest'}</span> Not a decision. The referee decides.</p>
      {state.note && <p className="field-hint" role="status">{state.note}</p>}
      <p className="case-summary-text" aria-live="polite">{state.text}</p>
    </>}
  </section>;
}
function CaseHistory({ record, staff, onBusyChange, label = '' }: { record: IntegrityCase; staff: boolean; onBusyChange: (busy: boolean) => void; label?: string }) {
  const [events, setEvents] = useState<any[]>([]), [appeal, setAppeal] = useState<any>(null), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { setEvents([]); setAppeal(null); setError(''); const a = subscribeCaseActivity(record.id, setEvents, setError), b = subscribeCaseAppeal(record.id, setAppeal, setError); return () => { a(); b(); }; }, [record.id]);
  const act = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); setNote(''); } catch (e) { setError(errorMessage(e, 'This action could not be saved.')); } finally { setBusy(false); } };
  return <div className="case-history">{staff && <CaseSummary record={record} events={events} label={label} />}<h3>Case history</h3><ol><li><strong>Evidence submitted</strong><span>{record.id}</span></li>{events.map(event => <li key={event.id}><strong>{event.action.replaceAll('-', ' ')}</strong><span>{event.note}</span>{event.frames?.length > 0 && <small>{event.frames.length} model observations saved · human review required</small>}</li>)}</ol>
    {['resolved', 'dismissed'].includes(record.status) && <details className="case-appeal"><summary>{appeal ? `Review request · ${appeal.status}` : 'Request a review of this decision'}</summary>{appeal ? <><p>{appeal.note}</p>{appeal.resolution && <p className="module-notice">{appeal.resolution}</p>}</> : <p className="field-hint">The reporter can request one review of a closed case. Original evidence and decisions remain in the history.</p>}{(!staff && !appeal || staff && appeal?.status === 'open') && <div className="module-form"><label><Req>{staff ? 'Appeal decision note' : 'What should the organizer reconsider?'}</Req><textarea aria-required="true" value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label><div className="operations-actions">{staff ? <><button disabled={busy} className="arena-primary" onClick={() => void act(() => resolveCaseAppeal(record.id, 'accepted', note))}>Accept review request</button><button disabled={busy} className="arena-outline" onClick={() => void act(() => resolveCaseAppeal(record.id, 'rejected', note))}>Keep decision</button></> : <button disabled={busy} className="arena-outline" onClick={() => void act(() => submitCaseAppeal(record.id, note))}>Send review request</button>}</div></div>}</details>}{error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
export function FairPlayCenter({ matches, staff = false, initialCaseId }: { matches: Match[]; teams?: Team[]; staff?: boolean; onSignIn?: () => void; initialCaseId?: string | null }) {
  const { firebaseUser } = useAuth();
  const [cases, setCases] = useState<IntegrityCase[]>([]), [gameId, setGameId] = useState<ReviewGame>('mlbb');
  const [dialog, setDialog] = useState<'upload' | 'case' | null>(null), [selectedCaseId, setSelectedCaseId] = useState('');
  const [error, setError] = useState(''), [dialogError, setDialogError] = useState(''), [success, setSuccess] = useState(''), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [mediaBusy, setMediaBusy] = useState(false), [historyBusy, setHistoryBusy] = useState(false), [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [filterGame, setFilterGame] = useState('all'), [filterStatus, setFilterStatus] = useState('all');
  const [linkMatch, setLinkMatch] = useState(''), [link, setLink] = useState(''), [linkNotes, setLinkNotes] = useState('');
  const openedInitial = useRef('');
  const game = FAIR_PLAY_GAMES.find(g => g.id === gameId)!;
  const gameFor = (record: IntegrityCase) => FAIR_PLAY_GAMES.find(g => record.details.startsWith('[ArenaHub:') ? record.details.startsWith(`[ArenaHub:${g.id}]`) : matches.some(m => m.id === record.matchId && belongsToFairPlayGame(m, g)));
  const eligibleMatches = matches.filter(m => belongsToFairPlayGame(m, game) && (m.lobby || m.team1 && m.team2 && !m.team1.isBye && !m.team2.isBye));
  const visibleCases = cases.filter(c => (filterGame === 'all' || gameFor(c)?.id === filterGame) && (filterStatus === 'all' || c.status === filterStatus));
  const selected = cases.find(c => c.id === selectedCaseId), selectedGame = selected && gameFor(selected);
  const locked = busy || mediaBusy || historyBusy || uploadProgress !== null;
  useEffect(() => { setCases([]); return subscribeIntegrityCases(staff, setCases, setError); }, [staff, firebaseUser?.uid]);
  const openCase = (id: string) => { setSelectedCaseId(id); setNote(''); setDialogError(''); setDialog('case'); };
  useEffect(() => {
    if (!initialCaseId || openedInitial.current === initialCaseId || !cases.some(c => c.id === initialCaseId)) return;
    openCase(initialCaseId); openedInitial.current = initialCaseId;
  }, [cases, initialCaseId]);
  const openUpload = (id: ReviewGame) => { setGameId(id); setLinkMatch(''); setLink(''); setLinkNotes(''); setDialogError(''); setDialog('upload'); };
  const close = () => { if (!locked) { setDialog(null); setDialogError(''); } };
  const received = (id: string) => { setSuccess('Evidence received. You can follow its status in your private reports.'); openCase(id); };
  const sendClip = async (matchId: string, file: File, notes: string) => {
    setDialogError(''); setUploadProgress(0);
    try {
      const details = evidenceContext(game, `Video evidence submitted for organizer review. Original file: ${file.name.slice(0, 150)}. ${notes ? `Reporter note: ${notes}` : 'The reporter requests review of the uploaded encounter and surrounding context.'}`);
      received(await submitIntegrityCase({ matchId, reason: 'Suspected cheating', details, evidenceUrl: '' }, file, setUploadProgress));
    } finally { setUploadProgress(null); }
  };
  const review = async (status: 'reviewing' | 'resolved' | 'dismissed') => {
    if (!selected) return; setBusy(true); setDialogError('');
    try { await reviewIntegrityCase(selected.id, status, note); setNote(''); setSuccess('Decision recorded. The reporter was notified.'); }
    catch (e) { setDialogError(errorMessage(e, 'The decision could not be saved.')); } finally { setBusy(false); }
  };
  const counts = { open: cases.filter(c => ['open', 'reviewing'].includes(c.status)).length, closed: cases.filter(c => ['resolved', 'dismissed'].includes(c.status)).length };
  return <div className="module-page fairplay-video-page">
    {!staff && <header className="dashboard-page-heading"><h1>Fair play</h1><p>Choose a game to send a clip. Follow your report in the same place.</p></header>}
    {error && <p className="field-error" role="alert">{error}</p>}{success && <p className="module-notice" role="status">{success}</p>}
    <div className="feature-summary" aria-label="Evidence overview"><div><strong>{cases.length}</strong><span>{staff ? 'Private reports' : 'Your reports'}</span></div><div><strong>{counts.open}</strong><span>Awaiting decision</span></div><div><strong>{counts.closed}</strong><span>Closed cases</span></div></div>
    {!staff && <section className="fairplay-report-start" aria-labelledby="fairplay-start-title">
      <div className="feature-section-bar"><div><h2 id="fairplay-start-title">Report a match</h2><p className="field-hint">Choose the game the match was played in, then attach a clip, screenshot or link.</p></div></div>
      <div className="fairplay-game-grid">{FAIR_PLAY_GAMES.map(g => <button type="button" className="directory-game" key={g.id} aria-haspopup="dialog" onClick={() => openUpload(g.id)}><img src={g.image} alt="" /><div><span><strong>{g.name}</strong><small>{g.mode} · Submit evidence</small></span><ShieldCheck size={20} aria-hidden="true" /></div></button>)}</div>
    </section>}
    <section className="operations-section"><div className="feature-section-bar"><div><h2>{staff ? 'Private review queue' : 'Your reports'}</h2><p className="field-hint">Open a report to inspect its evidence, decision and review history.</p></div><span className="feature-privacy"><ShieldCheck size={15} /> Authorized accounts only</span></div>
      <div className="fairplay-report-filters module-form"><label>Game<select value={filterGame} onChange={e => setFilterGame(e.target.value)}><option value="all">All games</option>{FAIR_PLAY_GAMES.map(g => <option key={g.id} value={g.id}>{g.name} · {g.mode}</option>)}</select></label><label>Report status<select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label></div>
      {!visibleCases.length ? <div className="notification-empty"><FileCheck2 size={28} /><p>{cases.length ? 'No reports match these filters.' : staff ? 'No private reports are awaiting review.' : 'No reports yet. Choose a game above to submit evidence.'}</p></div> : <div className="fairplay-report-grid">{visibleCases.map(record => <article key={record.id} className="fairplay-report-card"><div className="operations-row"><span className="field-hint">{gameFor(record)?.name || 'Match evidence'}</span><span className={`operations-status ${record.status}`}>{record.status}</span></div><h3>{matchName(matches.find(m => m.id === record.matchId)) || 'Match report'}</h3><p className="field-hint">{record.evidenceFiles?.[0]?.name || record.reason}</p><button className="arena-outline" aria-haspopup="dialog" onClick={() => openCase(record.id)}>Open private report</button></article>)}</div>}
    </section>
    {staff && <details className="monitor-options">
      <summary>File evidence for a match</summary>
      <div className="operations-actions">{FAIR_PLAY_GAMES.map(g => <button type="button" className="arena-outline" key={g.id} aria-haspopup="dialog" onClick={() => openUpload(g.id)}>{g.name} · {g.mode}</button>)}</div>
    </details>}
    <Modal open={dialog !== null} title={dialog === 'upload' ? `${game.name} · Submit evidence` : 'Private evidence review'} description={dialog === 'upload' ? `${game.mode} · Choose a match and share the encounter.` : selected ? `Case ${selected.id}` : 'Loading your report…'} busy={locked} onClose={close} className="feature-dialog feature-dialog-wide">
      {dialog && <div className="feature-dialog-body">
        {dialogError && <p className="field-error feature-dialog-error" role="alert">{dialogError}</p>}
        {uploadProgress !== null && <p className="video-stage" role="status">Uploading original evidence · {uploadProgress}%</p>}
        {dialog === 'upload' && <>{!eligibleMatches.length ? <p className="module-notice">No confirmed matches are published for this game yet. An organizer must publish a match before you can report it.</p> : <VideoReviewWorkbench key={game.id} matches={eligibleMatches} game={game.id} staff={staff} onSubmit={sendClip} onBusyChange={setMediaBusy} />}
          <details className="evidence-link-option"><summary>Have a screenshot or recording link instead?</summary><form className="module-form" onSubmit={e => { e.preventDefault(); setBusy(true); setDialogError(''); void submitIntegrityCase({ matchId: linkMatch, reason: 'Suspected cheating', details: evidenceContext(game, `External match evidence submitted for organizer review. ${linkNotes || 'Please inspect the supplied recording or screenshot and its surrounding context.'}`), evidenceUrl: link }).then(received).catch(e => setDialogError(errorMessage(e, 'Evidence could not be saved.'))).finally(() => setBusy(false)); }}><fieldset disabled={locked}><label><Req>Match</Req><select required value={linkMatch} onChange={e => setLinkMatch(e.target.value)}><option value="">Choose match</option>{eligibleMatches.map(m => <option key={m.id} value={m.id}>{matchLabel(m)}</option>)}</select></label><label><Req>Evidence link</Req><input required type="url" maxLength={1500} value={link} onChange={e => setLink(e.target.value)} placeholder="YouTube, Drive, Streamable, Imgur, or Twitch" /></label><label>Optional note<textarea maxLength={1800} value={linkNotes} onChange={e => setLinkNotes(e.target.value)} /></label></fieldset><div className="feature-dialog-actions"><button disabled={locked || !eligibleMatches.length} className="arena-primary">{busy ? 'Sending…' : 'Send evidence'}</button></div></form></details></>}
        {dialog === 'case' && (selected ? <><div className="operations-row"><strong>{matchName(matches.find(m => m.id === selected.matchId)) || 'Match evidence'}{selectedGame ? ` · ${selectedGame.name}` : ''}</strong><span className={`operations-status ${selected.status}`}>{selected.status}</span></div>
          {selected.evidenceFiles?.map(file => file.mime.startsWith('video/') && selectedGame ? <VideoReviewWorkbench key={file.path} matches={matches.filter(m => m.id === selected.matchId)} game={selectedGame.id} staff={staff} attachment={file} caseId={selected.id} onSubmit={sendClip} onSaveReview={staff ? saveVideoReview : undefined} onBusyChange={setMediaBusy} /> : file.mime.startsWith('image/') ? <PrivateImage key={file.path} file={file} /> : <p className="field-hint" key={file.path}>This attachment needs a recognized game context before video review is available.</p>)}
          {selected.evidenceUrl && <a className="report-evidence" href={selected.evidenceUrl} target="_blank" rel="noopener noreferrer">Open original evidence <ExternalLink size={14} /></a>}
          <details className="case-original-note"><summary>Original submission</summary><p className="whitespace-pre-wrap">{selected.details}</p></details>
          {selected.resolution && <p className="module-notice"><strong>Organizer decision</strong><br />{selected.resolution}</p>}
          {staff && !['resolved', 'dismissed'].includes(selected.status) && <div className="module-form case-decision"><label><Req>What did you establish?</Req><textarea aria-required="true" value={note} disabled={locked} maxLength={2000} onChange={e => setNote(e.target.value)} placeholder="Record verified observations, limitations, and the reason for your decision." /></label><div className="feature-dialog-actions"><button disabled={locked} className="arena-outline" onClick={() => void review('reviewing')}>Start review</button><button disabled={locked} className="arena-outline" onClick={() => void review('dismissed')}>Dismiss concern</button><button disabled={locked} className="arena-primary" onClick={() => void review('resolved')}>Resolve case</button></div><p className="field-hint">No automatic penalties. Record tournament eligibility decisions at the Tournament desk.</p></div>}
          <CaseHistory key={selected.id} record={selected} staff={staff} onBusyChange={setHistoryBusy} label={(() => { const m = matches.find(item => item.id === selected.matchId); return m ? matchLabel(m) : ''; })()} />
        </> : <p className={error ? "field-error" : "field-hint"} role={error ? "alert" : "status"}>{error || "Waiting for your saved report…"}</p>)}
        <p className="video-review-footnote">Footage supports a human investigation. Publisher anti-cheat handles hidden game modifications.</p>
      </div>}
    </Modal>
  </div>;
}
