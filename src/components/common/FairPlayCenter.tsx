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
import './FeatureDialogs.css';

function PrivateImage({ file }: { file: EvidenceFile }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let active = true, objectUrl = ''; setUrl(''); setError('');
    readEvidence(file).then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (active) setError('Private image could not open. Check your connection and access.'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.path]);
  return error ? <p className="field-error" role="alert">{error}</p> : url ? <img className="fairplay-private-image" src={url} alt={file.name} /> : <p className="field-hint" role="status">Opening private screenshot…</p>;
}
function CaseHistory({ record, staff, onBusyChange }: { record: IntegrityCase; staff: boolean; onBusyChange: (busy: boolean) => void }) {
  const [events, setEvents] = useState<any[]>([]), [appeal, setAppeal] = useState<any>(null), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { setEvents([]); setAppeal(null); setError(''); const a = subscribeCaseActivity(record.id, setEvents, setError), b = subscribeCaseAppeal(record.id, setAppeal, setError); return () => { a(); b(); }; }, [record.id]);
  const act = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); setNote(''); } catch (e) { setError(e instanceof Error ? e.message : 'This action could not be saved.'); } finally { setBusy(false); } };
  return <div className="case-history"><h3>Case history</h3><ol><li><strong>Evidence submitted</strong><span>{record.id}</span></li>{events.map(event => <li key={event.id}><strong>{event.action.replaceAll('-', ' ')}</strong><span>{event.note}</span>{event.frames?.length > 0 && <small>{event.frames.length} model observations saved · human review required</small>}</li>)}</ol>
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
  const eligibleMatches = matches.filter(m => belongsToFairPlayGame(m, game) && m.team1 && m.team2 && !m.team1.isBye && !m.team2.isBye);
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
    catch (e) { setDialogError(e instanceof Error ? e.message : 'The decision could not be saved.'); } finally { setBusy(false); }
  };
  const counts = { open: cases.filter(c => ['open', 'reviewing'].includes(c.status)).length, closed: cases.filter(c => ['resolved', 'dismissed'].includes(c.status)).length };
  return <div className="module-page fairplay-video-page">
    <header className="dashboard-page-heading"><span className="section-overline">FAIR PLAY</span><h1>Review the moment.</h1><p>{staff ? 'Inspect private evidence and record clear referee decisions.' : 'Choose a game to send a clip. Follow your report in the same place.'}</p></header>
    {error && <p className="field-error" role="alert">{error}</p>}{success && <p className="module-notice" role="status">{success}</p>}
    <div className="fairplay-game-grid">{FAIR_PLAY_GAMES.map(g => <button type="button" className="directory-game" key={g.id} aria-haspopup="dialog" onClick={() => openUpload(g.id)}><img src={g.image} alt="" /><div><span><strong>{g.name}</strong><small>{g.mode} · Submit evidence</small></span><ShieldCheck size={20} /></div></button>)}</div>
    <div className="feature-summary" aria-label="Evidence overview"><div><strong>{cases.length}</strong><span>{staff ? 'Private reports' : 'Your reports'}</span></div><div><strong>{counts.open}</strong><span>Awaiting decision</span></div><div><strong>{counts.closed}</strong><span>Closed cases</span></div></div>
    <section className="operations-section"><div className="feature-section-bar"><div><h2>{staff ? 'Private review queue' : 'Your reports'}</h2><p className="field-hint">Open a report to inspect its evidence, decision and review history.</p></div><span className="feature-privacy"><ShieldCheck size={15} /> Authorized accounts only</span></div>
      <div className="fairplay-report-filters module-form"><label>Game<select value={filterGame} onChange={e => setFilterGame(e.target.value)}><option value="all">All games</option>{FAIR_PLAY_GAMES.map(g => <option key={g.id} value={g.id}>{g.name} · {g.mode}</option>)}</select></label><label>Report status<select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label></div>
      {!visibleCases.length ? <div className="notification-empty"><FileCheck2 size={28} /><p>{cases.length ? 'No reports match these filters.' : 'No reports yet. Choose a game above to submit evidence.'}</p></div> : <div className="fairplay-report-grid">{visibleCases.map(record => <article key={record.id} className="fairplay-report-card"><div className="operations-row"><span className="field-hint">{gameFor(record)?.name || 'Match evidence'}</span><span className={`operations-status ${record.status}`}>{record.status}</span></div><h3>{matches.find(m => m.id === record.matchId)?.matchNumber || 'Match report'}</h3><p className="field-hint">{record.evidenceFiles?.[0]?.name || record.reason}</p><button className="arena-outline" aria-haspopup="dialog" onClick={() => openCase(record.id)}>Open private report</button></article>)}</div>}
    </section>
    <Modal open={dialog !== null} title={dialog === 'upload' ? `${game.name} · Submit evidence` : 'Private evidence review'} description={dialog === 'upload' ? `${game.mode} · Choose a match and share the encounter.` : selected ? `Case ${selected.id}` : 'Loading your report…'} busy={locked} onClose={close} className="feature-dialog feature-dialog-wide">
      {dialog && <div className="feature-dialog-body">
        {dialogError && <p className="field-error feature-dialog-error" role="alert">{dialogError}</p>}
        {uploadProgress !== null && <p className="video-stage" role="status">Uploading original evidence · {uploadProgress}%</p>}
        {dialog === 'upload' && <>{!eligibleMatches.length ? <p className="module-notice">No confirmed matches are published for this game yet. An organizer must publish a match before you can report it.</p> : <VideoReviewWorkbench key={game.id} matches={eligibleMatches} game={game.id} staff={staff} onSubmit={sendClip} onBusyChange={setMediaBusy} />}
          <details className="evidence-link-option"><summary>Have a screenshot or recording link instead?</summary><form className="module-form" onSubmit={e => { e.preventDefault(); setBusy(true); setDialogError(''); void submitIntegrityCase({ matchId: linkMatch, reason: 'Suspected cheating', details: evidenceContext(game, `External match evidence submitted for organizer review. ${linkNotes || 'Please inspect the supplied recording or screenshot and its surrounding context.'}`), evidenceUrl: link }).then(received).catch(e => setDialogError(e instanceof Error ? e.message : 'Evidence could not be saved.')).finally(() => setBusy(false)); }}><fieldset disabled={locked}><label><Req>Match</Req><select required value={linkMatch} onChange={e => setLinkMatch(e.target.value)}><option value="">Choose match</option>{eligibleMatches.map(m => <option key={m.id} value={m.id}>{m.matchNumber} · {m.team1?.name} vs {m.team2?.name}</option>)}</select></label><label><Req>Evidence link</Req><input required type="url" maxLength={1500} value={link} onChange={e => setLink(e.target.value)} placeholder="YouTube, Drive, Streamable, Imgur, or Twitch" /></label><label>Optional note<textarea maxLength={1800} value={linkNotes} onChange={e => setLinkNotes(e.target.value)} /></label></fieldset><div className="feature-dialog-actions"><button disabled={locked || !eligibleMatches.length} className="arena-primary">{busy ? 'Sending…' : 'Send evidence'}</button></div></form></details></>}
        {dialog === 'case' && (selected ? <><div className="operations-row"><strong>{matches.find(m => m.id === selected.matchId)?.matchNumber || 'Match evidence'}{selectedGame ? ` · ${selectedGame.name}` : ''}</strong><span className={`operations-status ${selected.status}`}>{selected.status}</span></div>
          {selected.evidenceFiles?.map(file => file.mime.startsWith('video/') && selectedGame ? <VideoReviewWorkbench key={file.path} matches={matches.filter(m => m.id === selected.matchId)} game={selectedGame.id} staff={staff} attachment={file} caseId={selected.id} onSubmit={sendClip} onSaveReview={staff ? saveVideoReview : undefined} onBusyChange={setMediaBusy} /> : file.mime.startsWith('image/') ? <PrivateImage key={file.path} file={file} /> : <p className="field-hint" key={file.path}>This attachment needs a recognized game context before video review is available.</p>)}
          {selected.evidenceUrl && <a className="report-evidence" href={selected.evidenceUrl} target="_blank" rel="noopener noreferrer">Open original evidence <ExternalLink size={14} /></a>}
          <details className="case-original-note"><summary>Original submission</summary><p className="whitespace-pre-wrap">{selected.details}</p></details>
          {selected.resolution && <p className="module-notice"><strong>Organizer decision</strong><br />{selected.resolution}</p>}
          {staff && !['resolved', 'dismissed'].includes(selected.status) && <div className="module-form case-decision"><label><Req>What did you establish?</Req><textarea aria-required="true" value={note} disabled={locked} maxLength={2000} onChange={e => setNote(e.target.value)} placeholder="Record verified observations, limitations, and the reason for your decision." /></label><div className="feature-dialog-actions"><button disabled={locked} className="arena-outline" onClick={() => void review('reviewing')}>Start review</button><button disabled={locked} className="arena-outline" onClick={() => void review('dismissed')}>Dismiss concern</button><button disabled={locked} className="arena-primary" onClick={() => void review('resolved')}>Resolve case</button></div><p className="field-hint">No automatic penalties. Record tournament eligibility decisions at the Tournament desk.</p></div>}
          <CaseHistory key={selected.id} record={selected} staff={staff} onBusyChange={setHistoryBusy} />
        </> : <p className={error ? "field-error" : "field-hint"} role={error ? "alert" : "status"}>{error || "Waiting for your saved report…"}</p>)}
        <p className="video-review-footnote">Footage supports a human investigation. Publisher anti-cheat handles hidden game modifications.</p>
      </div>}
    </Modal>
  </div>;
}
