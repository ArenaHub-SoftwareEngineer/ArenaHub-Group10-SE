import React, { useCallback, useEffect, useState } from 'react';
import { auth } from '../../lib/firebase';
import { CATEGORY_LABEL, SIGNAL_CATEGORIES, type MonitorPlatform, type RiskResult, type Severity, type SignalCategory } from '../../lib/integrityRisk';
import { CHEAT_CATALOG, LAYER_LABEL } from '../../lib/cheatCatalog';
import { Modal } from '../ui/Modal';
import { Copy, Monitor, QrCode, ShieldAlert, Users } from '../ui/Icons';
import { Req } from '../ui/Req';
import { errorMessage } from '../../lib/errors';
import { apiUrl } from '../../lib/apiBase';
import { antiCheatCall as call } from '../../lib/antiCheatApi';
import { AntiCheatCheckIn } from './AntiCheatCheckIn';
import { ScreenWall } from './ScreenWall';
import { FacilitatorsPanel, type FacilitatorList } from './FacilitatorsPanel';
import './adminPoster.css';
import { ReportDialog } from './ReportDialog';
import { CONNECTION_LABEL, ScanOverview, type ScanOverviewSession } from './ScanOverview';
import { IOS_INDICATOR_KEYS, IOS_SIDELOAD_INDICATORS, type IosClearance, type IosIndicator } from '../../lib/iosAntiCheat';
import type { BracketDraft } from '../../lib/types';
import '../../monitor.css';

interface SessionView extends ScanOverviewSession {
  status: 'pending' | 'active' | 'ended' | 'declined'; expiresAt: number; claimedAt: number | null; endedAt: number | null;
  lastSeen: number | null; device: { model?: string; os?: string; agent?: string } | null; gsi: { matchId: string; steamId: string; hero: string; gameState: string; clockTime: number | null } | null;
  reviewNote: string; hold: boolean; mediaBytes: number; risk: RiskResult;
  inspection?: { status: string; detail: string };
  iosClearance?: IosClearance | null;
}
interface SessionDetail extends SessionView {
  signals: { id: string; severity: Severity; evidence: string; firstSeen: number; lastSeen: number; count: number; title: string; explain: string; category: SignalCategory; fingerprint?: { sha256: string; listed: boolean } }[];
  media: { id: number; kind: 'video' | 'image'; bytes: number; createdAt: number }[];
  audit: { at: number; actor: string; action: string; note: string }[];
  lastFacts?: { dota?: { found: boolean; buildId?: string; manifestSha256?: string; updatePending?: boolean } } | null;
}
const DEVICE_LABEL: Record<MonitorPlatform, string> = { android: 'Android companion', ios: 'iPhone supervised anti-cheat', pc: 'PC agent' };
async function mediaUrl(sessionId: string, mediaId: number) {
  const user = auth.currentUser; if (!user) throw new Error('Sign in again.');
  const response = await fetch(apiUrl(`/api/integrity/sessions/${sessionId}/media/${mediaId}`), { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  if (!response.ok) throw new Error('This recording could not be opened.');
  return URL.createObjectURL(await response.blob());
}

const time = (ms: number | null) => ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Things a referee must act on now: a player declined, refused recording, or went silent. */
interface MonitorAlert { key: string; sessionId: string; text: string }
function alertsFor(sessions: SessionView[]): MonitorAlert[] {
  const out: MonitorAlert[] = [];
  for (const s of sessions) {
    const who = `${s.playerName}${s.team ? ` (${s.team})` : ''}`;
    if (s.connection === 'declined') out.push({ key: `${s.id}:declined`, sessionId: s.id, text: `${who} declined monitoring for ${s.matchLabel}. Arrange an organizer device or watch them in person.` });
    if (s.risk.reasons.some(r => r.id === 'recording-refused')) out.push({ key: `${s.id}:recording`, sessionId: s.id, text: `${who} agreed to monitoring but did not allow screen recording.` });
    if (s.connection === 'lost') out.push({ key: `${s.id}:lost`, sessionId: s.id, text: `${who}'s device stopped reporting. Check that the app or agent is still running.` });
  }
  return out;
}
type IosAnswers = Partial<Record<IosIndicator, 'clear' | 'found'>>;
/** What the referee confirms at the table, besides the six places on the phone. */
const IOS_TABLE_CHECKS = [
  ['roster', 'Phone and game account match the roster'],
  ['store', 'Game is the official App Store version'],
  ['watch', 'A referee is watching and recording is on'],
] as const;
type IosTableCheck = typeof IOS_TABLE_CHECKS[number][0];
/** The inspection note is written from the referee's taps; an optional line of their own is added. */
export function iosReviewNote(s: Pick<SessionDetail, 'playerName' | 'matchLabel' | 'device'>, answers: IosAnswers, extra: string) {
  const found = IOS_INDICATOR_KEYS.filter(key => answers[key] === 'found').map(key => IOS_SIDELOAD_INDICATORS[key].found);
  const phone = [s.device?.model, s.device?.os].filter(Boolean).join(' ') || 'iPhone';
  return [
    found.length
      ? `Not cleared: ${s.playerName}'s ${phone} for ${s.matchLabel}. Found: ${found.join('; ')}. The player was told how to fix it.`
      : `Inspected ${s.playerName}'s ${phone} for ${s.matchLabel}. Device and account matched the roster, the game is the App Store version, all ${IOS_INDICATOR_KEYS.length} sideload and jailbreak checks were clear, and a referee is watching with recording on.`,
    extra.trim(),
  ].filter(Boolean).join(' ');
}

/** Optional referee spot check. The player already confirmed these at check-in, so it stays folded until a referee is with the phone. */
function IosInspection({ detail, busy, act }: { detail: SessionDetail; busy: boolean; act: (work: () => Promise<unknown>, done: string) => Promise<void> }) {
  const [answers, setAnswers] = useState<IosAnswers>({});
  const [table, setTable] = useState<Partial<Record<IosTableCheck, boolean>>>({});
  const [extra, setExtra] = useState('');
  const found = IOS_INDICATOR_KEYS.filter(key => answers[key] === 'found');
  const checked = IOS_INDICATOR_KEYS.filter(key => answers[key]).length + IOS_TABLE_CHECKS.filter(([key]) => table[key]).length;
  const total = IOS_INDICATOR_KEYS.length + IOS_TABLE_CHECKS.length;
  const clearance = detail.iosClearance;
  const cleared = !!clearance?.approved && clearance.validUntil > Date.now();
  const save = (approved: boolean) => void act(async () => {
    const note = iosReviewNote(detail, answers, extra);
    await call(`/sessions/${detail.id}/ios-review`, { body: approved
      ? { approved, indicators: answers, note, checks: { deviceAndAccount: true, officialGame: true, deviceSettings: true, supervision: true, recording: true } }
      : { approved, indicators: answers, note } });
    setAnswers({}); setTable({}); setExtra('');
  }, approved ? 'Cleared to play for 15 minutes. The player\'s phone turns green.' : 'Not cleared. The player sees what to fix.');
  const revoked = !!clearance && !clearance.approved;
  return <details className="operations-section ios-check" open={revoked}>
    <summary className="ios-check-head">
      <h3>Referee spot check <small>(optional)</small></h3>
      <span className={`ios-state ${cleared ? 'is-ok' : clearance && !clearance.approved ? 'is-bad' : 'is-wait'}`}>
        {cleared ? `Cleared until ${new Date(clearance!.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : revoked ? 'Not cleared' : 'Player self-checked'}
      </span>
    </summary>
    <p className="field-hint">The player confirmed these on their own phone at check-in, and you can watch their screen on Live screens. Only open this if you are with the player and want to check the phone yourself. Marking a Problem blocks them until it is fixed.</p>
    <div className="ios-meter" aria-hidden="true"><i style={{ width: `${checked / total * 100}%` }} /></div>
    <p className="ios-progress">{checked} of {total} checked</p>
    <div className="ios-rows" role="group" aria-label="On the phone">
      {IOS_INDICATOR_KEYS.map(key => { const item = IOS_SIDELOAD_INDICATORS[key]; return <div key={key} className={`ios-row${answers[key] === 'found' ? ' is-found' : answers[key] === 'clear' ? ' is-clear' : ''}`}>
        <div className="ios-row-text"><strong>{item.ok}</strong><small>{item.where}</small></div>
        <div className="ios-seg" role="radiogroup" aria-label={item.ok}>
          <button type="button" role="radio" aria-checked={answers[key] === 'clear'} onClick={() => setAnswers(a => ({ ...a, [key]: 'clear' }))}>OK</button>
          <button type="button" role="radio" aria-checked={answers[key] === 'found'} className="is-problem" onClick={() => setAnswers(a => ({ ...a, [key]: 'found' }))}>Problem</button>
        </div>
        {answers[key] === 'found' && <p className="ios-fix">Tell the player: {item.fix}</p>}
      </div>; })}
    </div>
    <div className="ios-rows" role="group" aria-label="At the table">
      {IOS_TABLE_CHECKS.map(([key, label]) => <label key={key} className={`ios-row ios-tick${table[key] ? ' is-clear' : ''}`}>
        <span className="ios-row-text"><strong>{label}</strong></span>
        <input type="checkbox" checked={table[key] === true} onChange={event => setTable(t => ({ ...t, [key]: event.target.checked }))} />
      </label>)}
    </div>
    <label className="ios-extra">Note (optional)<input value={extra} maxLength={300} onChange={event => setExtra(event.target.value)} placeholder="e.g. Recorded from the observer slot" /></label>
    <div className="operations-actions">
      {found.length
        ? <button type="button" className="arena-primary arena-danger" disabled={busy} onClick={() => save(false)}>Not cleared, tell the player</button>
        : <button type="button" className="arena-primary" disabled={busy || detail.status !== 'active' || checked < total} onClick={() => save(true)}>Clear to play</button>}
    </div>
  </details>;
}

export function caseSummary(s: SessionDetail) {
  return [
    `[Match monitor] ${s.playerName} - ${s.matchLabel} (${s.gameLabel}, ${DEVICE_LABEL[s.platform]})`,
    `Risk ${s.risk.score}/100 (${s.risk.level}). By category: ${SIGNAL_CATEGORIES.filter(k => s.risk.categories[k] > 0).map(k => `${CATEGORY_LABEL[k]} ${s.risk.categories[k]}`).join(', ') || 'none'}. Monitor session ${s.id}. Device: ${[s.device?.model, s.device?.os].filter(Boolean).join(', ') || 'unknown'}.`,
    ...s.signals.filter(sig => sig.severity !== 'info').map(sig => `- ${sig.title} [${sig.severity}] ${sig.evidence} (seen ${sig.count}x, ${time(sig.firstSeen)} to ${time(sig.lastSeen)})`),
    `Recordings: ${s.media.length} files kept on the tournament API server under this session ID.`,
    'These are device signals for a human referee, not proof of cheating.',
  ].join('\n');
}

function MediaItem({ sessionId, item }: { sessionId: string; item: SessionDetail['media'][number] }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }, [url]);
  const open = () => { setError(''); (item.kind === 'video' ? call<{ url: `/api/${string}` }>(`/sessions/${sessionId}/media/${item.id}/ticket`, { body: {} }).then(t => apiUrl(t.url)) : mediaUrl(sessionId, item.id)).then(setUrl).catch(e => setError(e.message)); };
  return <li className="monitor-media-item">
    {url ? item.kind === 'video' ? <video src={url} controls preload="metadata" /> : <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={`Screenshot at ${time(item.createdAt)}`} /></a>
      : <button type="button" className="arena-outline" onClick={open}>{item.kind === 'video' ? 'Load recording' : 'Load screenshot'} · {time(item.createdAt)} · {megabytes(item.bytes)}</button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </li>;
}

function SessionDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [note, setNote] = useState(''), [hold, setHold] = useState(false), [busy, setBusy] = useState(false), [dotaMatch, setDotaMatch] = useState('');
  const [cheatId, setCheatId] = useState(''), [seenNote, setSeenNote] = useState(''), [seenLevel, setSeenLevel] = useState<Severity>('medium');
  const [blocking, setBlocking] = useState<{ sha256: string; label: string } | null>(null);
  const load = useCallback(() => call<SessionDetail>(`/sessions/${id}`).then(d => { setDetail(d); setError(''); }).catch(e => setError(e.message)), [id]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (detail) { setNote(n => n || detail.reviewNote); setHold(h => h || detail.hold); } }, [detail?.id]);
  const act = async (work: () => Promise<unknown>, done: string) => { setBusy(true); setError(''); setNotice(''); try { await work(); setNotice(done); await load(); onChanged(); } catch (e) { setError(errorMessage(e, 'That action failed.')); } finally { setBusy(false); } };
  const unverified = detail?.signals.filter(s => s.id === 'game-signature-unverified') || [];
  return <Modal open title={detail ? `${detail.playerName} · ${detail.gameLabel}` : 'Monitor session'} description={detail ? `${detail.matchLabel} · ${CONNECTION_LABEL[detail.connection]}` : 'Loading'} busy={busy} onClose={onClose} className="feature-dialog feature-dialog-wide">
    <div className="feature-dialog-body monitor-detail">
      {error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="module-notice" role="status">{notice}</p>}
      {!detail ? <p className="field-hint" role="status">Loading session...</p> : <>
        {detail.platform === 'ios' && <IosInspection detail={detail} busy={busy} act={act} />}
        {(() => {
          const report = <>
        <div className="monitor-risk-strip"><span className={`monitor-risk ${detail.risk.level}`}>{detail.risk.score}<small>/100</small></span><div><strong>{detail.risk.level === 'clear' ? 'No listed indicators reported' : `Level: ${detail.risk.level}`}</strong><p className="field-hint">A referee decides. Signals describe the device, not the player's intent.</p></div></div>
        <p className="module-notice"><strong>Detection coverage: {detail.inspection?.status || 'not reported'}. </strong>{detail.inspection?.detail || 'No inspection coverage is available. An empty finding list does not prove a clean device.'}</p>
        <dl className="monitor-facts">
          <div><dt>Device</dt><dd>{[detail.device?.model, detail.device?.os, detail.device?.agent].filter(Boolean).join(' · ') || (detail.status === 'pending' ? 'Not paired yet' : 'Device details not reported')}</dd></div>
          <div><dt>Last report</dt><dd>{time(detail.lastSeen)}</dd></div>
          <div><dt>Window closes</dt><dd>{time(detail.expiresAt)}</dd></div>
          {detail.lastFacts?.dota && <div><dt>Dota 2 install</dt><dd>{detail.lastFacts.dota.found
            ? <>Build {detail.lastFacts.dota.buildId || 'unknown'}{detail.lastFacts.dota.updatePending ? ' (update pending)' : ''} · Valve file list SHA-256 <code className="monitor-hash">{detail.lastFacts.dota.manifestSha256 || 'not reported'}</code></>
            : 'Not found in this PC\'s Steam libraries'}</dd></div>}
          {detail.gsi && <div><dt>Dota 2 live</dt><dd>{detail.gsi.hero || 'no hero'} · match {detail.gsi.matchId || '-'} · {detail.gsi.gameState || '-'} · Steam {detail.gsi.steamId || '-'}</dd></div>}
        </dl>
        <h3>Risk by category</h3>
        <ul className="monitor-breakdown">{SIGNAL_CATEGORIES.map(k => <li key={k} className={`cat-${k}`}><span>{CATEGORY_LABEL[k]}</span><span className="monitor-bar"><i style={{ width: `${Math.min(100, detail.risk.categories[k])}%` }} /></span><b>{detail.risk.categories[k]}</b></li>)}</ul>
        {detail.signals.length > 0 && (() => {
          const start = detail.claimedAt || detail.createdAt, end = Math.max(start + 60_000, detail.endedAt || 0, detail.lastSeen || 0, ...detail.signals.map(s => s.lastSeen));
          const at = (ms: number) => Math.max(0, Math.min(100, (ms - start) / (end - start) * 100));
          return <><h3>When it happened</h3><div className="monitor-timeline" role="img" aria-label="Timeline of signals by category. The same signals are listed with times below.">
            {SIGNAL_CATEGORIES.filter(k => detail.signals.some(s => s.category === k)).map(k => <div key={k} className={`monitor-timeline-row cat-${k}`}><span>{CATEGORY_LABEL[k]}</span><span className="monitor-track">{detail.signals.filter(s => s.category === k).map(s => <i key={`${s.id}${s.evidence}`} title={`${s.title}: ${time(s.firstSeen)} to ${time(s.lastSeen)}`} style={{ left: `${at(s.firstSeen)}%`, width: `${Math.max(1, at(s.lastSeen) - at(s.firstSeen))}%` }} />)}</span></div>)}
            <div className="monitor-timeline-ends"><span>{time(start)}</span><span>{time(end)}</span></div></div></>;
        })()}
        <h3>Signals</h3>
        {!detail.signals.length ? <p className="field-hint">No signals yet.</p> : <ul className="monitor-signals">{detail.signals.map(s => <li key={`${s.id}${s.evidence}`} className={`sev-${s.severity}`}>
          <div className="operations-row"><strong>{s.title}</strong><span className="monitor-sev">{s.severity}</span></div>
          <p>{s.explain}</p><code>{s.evidence}</code><small>Seen {s.count} times · {time(s.firstSeen)} to {time(s.lastSeen)}</small>
          {s.fingerprint && (s.fingerprint.listed ? <p className="field-hint">This file is on the fingerprint list. Copies on other PCs are flagged even when renamed.</p>
            : blocking?.sha256 === s.fingerprint.sha256 ? <form className="module-form monitor-inline" onSubmit={e => { e.preventDefault(); void act(async () => { await call(`/sessions/${id}/block-fingerprint`, { body: blocking }); setBlocking(null); }, 'Fingerprint added. The same file is now flagged on every PC, even renamed. Players scanned before this change must scan again.'); }}>
              <p className="field-hint">Only add a file you have confirmed is a cheat. Every PC with this exact file will be flagged.</p>
              <label><Req>Name for this file</Req><input required minLength={2} value={blocking.label} maxLength={80} onChange={e => setBlocking({ ...blocking, label: e.target.value })} placeholder="e.g. Dota map hack loader" /></label>
              <div className="operations-actions"><button className="arena-primary" disabled={busy || blocking.label.trim().length < 2}>Add fingerprint</button><button type="button" className="arena-outline" disabled={busy} onClick={() => setBlocking(null)}>Cancel</button></div>
            </form>
            : <button type="button" className="arena-outline" disabled={busy} onClick={() => setBlocking({ sha256: s.fingerprint!.sha256, label: '' })}>Confirmed cheat? Add its fingerprint</button>)}
        </li>)}</ul>}
        {unverified.length > 0 && <div className="module-notice"><strong>Game signature not trusted yet.</strong> Only trust a signature independently verified on a staff-controlled Android phone with the correct regional game from its official store.
          {unverified.map(s => { const cert = s.evidence.match(/[0-9a-f]{64}/)?.[0]; return cert && <button key={cert} type="button" className="arena-outline" disabled={busy} onClick={() => void act(() => call(`/sessions/${id}/trust-signature`, { body: { cert } }), 'Signature trusted. Phones with a different signature will now be flagged as critical.')}>Trust {cert.slice(0, 12)}...</button>; })}
        </div>}
        {detail.game === 'dota2' && <form className="module-form monitor-inline" onSubmit={e => { e.preventDefault(); void act(async () => { const r = await call<{ compared: number; outliers: unknown[] }>(`/sessions/${id}/opendota`, { body: dotaMatch ? { matchId: dotaMatch } : {} }); setNotice(`Compared with ${r.compared} past games: ${r.outliers.length} unusual stats.`); }, ''); }}>
          <label>Dota 2 match ID (blank uses the live one)<input inputMode="numeric" value={dotaMatch} onChange={e => setDotaMatch(e.target.value.replace(/\D/g, ''))} placeholder={detail.gsi?.matchId || 'e.g. 7412345678'} /></label>
          <button className="arena-outline" disabled={busy}>Check stats on OpenDota</button>
        </form>}
        <h3>Recordings and screenshots ({detail.media.length}, {megabytes(detail.mediaBytes)})</h3>
        {!detail.media.length ? <p className="field-hint">Nothing uploaded yet.</p> : <ul className="monitor-media">{detail.media.slice(-24).reverse().map(m => <MediaItem key={m.id} sessionId={id} item={m} />)}</ul>}
        {detail.media.length > 24 && <p className="field-hint">Showing the latest 24. Older files are in the private session folder on the API server.</p>}
        <h3>What to look for in {detail.gameLabel}</h3>
        <p className="field-hint">These are review prompts. Check uncut player-view evidence, legitimate game mechanics and tournament rules. Skill, lag, observer vision or an installed tool alone does not prove cheating.</p>
        <div className="monitor-catalog">{CHEAT_CATALOG[detail.game].map(cheat => <details key={cheat.id}><summary>{cheat.name}</summary><p>{cheat.what}</p>
          <div className="monitor-layers" aria-label="Related evidence sources">{cheat.layers.map(layer => <span key={layer}>{LAYER_LABEL[layer]}</span>)}</div>
          <ul>{cheat.tells.map(tell => <li key={tell}>{tell}</li>)}</ul></details>)}</div>
        <form className="module-form" onSubmit={e => { e.preventDefault(); void act(async () => { await call(`/sessions/${id}/observations`, { body: { cheatId, severity: seenLevel, note: seenNote } }); setSeenNote(''); setCheatId(''); }, 'Observation recorded. It now counts in the Behaviour category.'); }}>
          <div className="monitor-inline">
            <label><Req>I saw signs of</Req><select required value={cheatId} onChange={e => setCheatId(e.target.value)}><option value="">Choose a cheat type</option>{CHEAT_CATALOG[detail.game].map(cheat => <option key={cheat.id} value={cheat.id}>{cheat.name}</option>)}</select></label>
            <label>How strong is it?<select value={seenLevel} onChange={e => setSeenLevel(e.target.value as Severity)}><option value="low">Low: worth a note</option><option value="medium">Medium: needs a second look</option><option value="high">High: clear in the evidence</option></select></label>
          </div>
          <label><Req>What you saw and when</Req><input required minLength={10} maxLength={150} value={seenNote} onChange={e => setSeenNote(e.target.value)} placeholder="e.g. Crosshair followed an enemy behind the wall at 12:40" /></label>
          <div className="feature-dialog-actions"><button className="arena-outline" disabled={busy}>Record observation</button></div>
        </form>
        <div className="module-form case-decision">
          <label><Req>Referee note</Req><textarea aria-required="true" value={note} maxLength={2000} onChange={e => setNote(e.target.value)} placeholder="What you checked and what you concluded." /></label>
          <label className="settings-toggle">Keep this evidence past 30 days (attached to a case)<input type="checkbox" checked={hold} onChange={e => setHold(e.target.checked)} /></label>
          <div className="feature-dialog-actions">
            <button type="button" className="arena-outline" disabled={busy} onClick={() => void navigator.clipboard.writeText(caseSummary(detail)).then(() => setNotice('Session summary copied.'), () => setError('Copy failed. Select the text manually.'))}><Copy size={15} /> Copy session summary</button>
            <button type="button" className="arena-outline" disabled={busy} onClick={() => void act(() => call(`/sessions/${id}/review`, { body: { note, hold } }), 'Review saved.')}>Save review</button>
            {detail.status !== 'ended' && <button type="button" className="arena-primary" disabled={busy} onClick={() => void act(() => call(`/sessions/${id}/end`, { body: {} }), 'Monitoring ended. The device stops on its next report.')}>End monitoring</button>}
          </div>
        </div>
        <details><summary>Activity log</summary><ol className="monitor-audit">{detail.audit.map((a, i) => <li key={i}><strong>{a.action.replaceAll('-', ' ')}</strong> · {time(a.at)} · {a.note}</li>)}</ol></details>
          </>;
          // Nothing is scanned on an iPhone, so the evidence and cheat report stay folded until a referee needs them.
          return detail.platform === 'ios' ? <details className="monitor-more"><summary>Evidence and cheat report</summary>{report}</details> : report;
        })()}
      </>}
    </div>
  </Modal>;
}

type MonitorTab = 'checkin' | 'screens' | 'scans' | 'people';

/**
 * `manage`: admins and organizers (every match, invite facilitators). `facilitator`: an invited facilitator, who sees
 * only their assigned matches; the server enforces the same limits.
 */
export function MatchMonitorView({ brackets = [], facilitator = false, manage = false }: { brackets?: BracketDraft[]; facilitator?: boolean; manage?: boolean }) {
  // Watching screens is what staff do most, so it is the first view. Check-in hands a match straight to it.
  const [tab, setTab] = useState<MonitorTab>('screens');
  const [live, setLive] = useState({ sharing: 0, matches: 0 });
  const [people, setPeople] = useState<FacilitatorList | null>(null);
  const loadPeople = useCallback(() => call<FacilitatorList>('/facilitators').then(setPeople).catch(() => setPeople({ facilitators: [], canInvite: true })), []);
  useEffect(() => { if (manage) void loadPeople(); }, [manage, loadPeople]);
  const [watchKey, setWatchKey] = useState('');
  const [report, setReport] = useState<{ id: string; snapshot: File | null } | null>(null);
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [openId, setOpenId] = useState('');
  const refresh = useCallback(() => call<SessionView[]>('/sessions')
    .then(rows => { setSessions(rows); setError(''); })
    .catch(err => setError(errorMessage(err, 'Player scans could not be loaded.'))), []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const alerts = alertsFor(sessions ?? []).filter(alert => !dismissed.includes(alert.key));

  const tabs: { id: MonitorTab; label: string; icon: typeof Monitor; count?: number }[] = [
    { id: 'screens', label: 'Screens', icon: Monitor, count: live.sharing || undefined },
    { id: 'checkin', label: 'Check-in', icon: QrCode },
    { id: 'scans', label: 'Scans', icon: ShieldAlert, count: alerts.length || undefined },
    ...(manage ? [{ id: 'people' as const, label: 'Facilitators', icon: Users, count: people?.facilitators.length || undefined }] : []),
  ];

  return <div className="module-page monitor-page adp">
    <header className="adp-head ac-head">
      <span className="adp-giant" aria-hidden="true">Anti-cheat</span>
      <div className="adp-title">
        <h1>{live.sharing ? <><span className="adp-count">{live.sharing}</span> <span className="is-thin">sharing</span> now</>
          : <><span className="adp-count">{live.matches}</span> <span className="is-thin">{facilitator ? 'your' : ''}</span> match{live.matches === 1 ? '' : 'es'}</>}</h1>
        <p>{facilitator ? 'Facilitator · your assigned matches' : 'Watch · check in · report'}</p>
      </div>
    </header>
    <nav className="ac-tabs" role="tablist" aria-label="Anti-cheat views">
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`ac-tab${item.id === 'scans' && alerts.length ? ' is-alert' : ''}`} onClick={() => setTab(item.id)}>
        <item.icon size={18} aria-hidden="true" /><span>{item.label}</span>{item.count ? <b>{item.count}</b> : null}
      </button>)}
    </nav>
    {tab === 'checkin' && <AntiCheatCheckIn brackets={brackets} onReport={id => setReport({ id, snapshot: null })} onWatch={matchId => { setWatchKey('m-' + matchId); setTab('screens'); }} />}
    {/* Kept mounted (hidden) so the sharing count in the header stays live on every tab. */}
    <div hidden={tab !== 'screens'}><ScreenWall brackets={brackets} openKey={watchKey} onOpenKey={setWatchKey} onReport={(id, snapshot) => setReport({ id, snapshot })}
      facilitators={people?.facilitators.filter(person => person.status !== 'staff').map(person => person.email) || []}
      onSharingChange={(sharing, matches) => setLive({ sharing, matches })} /></div>
    {tab === 'people' && manage && <FacilitatorsPanel brackets={brackets} data={people} onChange={list => setPeople(current => ({ canInvite: current?.canInvite ?? true, facilitators: list }))} />}
    {tab === 'scans' && <>
      {error && <p className="field-error" role="alert">{error}</p>}
      <ScanOverview sessions={sessions ?? []} loading={!sessions && !error} onRefresh={() => void refresh()} onOpenSession={setOpenId}
        actions={alerts.length > 0 && <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setAlertsOpen(true)}>
          <ShieldAlert size={16} aria-hidden="true" /> Needs your attention ({alerts.length})
        </button>} />
    </>}

    <Modal open={alertsOpen} title="Needs your attention" onClose={() => setAlertsOpen(false)} className="feature-dialog feature-dialog-wide">
      <section className="monitor-alerts" role="alert" aria-label="Needs your attention">
        {alerts.length ? <ul>{alerts.map(alert => <li key={alert.key}>
          <span>{alert.text}</span>
          <span className="monitor-alert-actions">
            <button type="button" className="arena-outline" onClick={() => setOpenId(alert.sessionId)}>Open</button>
            <button type="button" className="arena-outline" onClick={() => setDismissed(current => [...current, alert.key])}>Done</button>
          </span>
        </li>)}</ul> : <p className="field-hint">No scan alerts to review.</p>}
      </section>
    </Modal>
    {report && <ReportDialog key={report.id} sessionId={report.id} snapshot={report.snapshot} onClose={() => setReport(null)} onDetails={() => { setOpenId(report.id); setReport(null); }} />}
    {openId && <SessionDialog key={openId} id={openId} onClose={() => setOpenId('')} onChanged={() => void refresh()} />}
  </div>;
}
