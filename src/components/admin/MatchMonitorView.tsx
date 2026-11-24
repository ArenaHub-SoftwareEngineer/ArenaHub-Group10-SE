import React, { useCallback, useEffect, useState } from 'react';
import { auth } from '../../lib/firebase';
import { CATEGORY_LABEL, SIGNAL_CATEGORIES, type MonitorPlatform, type RiskResult, type Severity, type SignalCategory } from '../../lib/integrityRisk';
import { CHEAT_CATALOG, LAYER_LABEL } from '../../lib/cheatCatalog';
import { Modal } from '../ui/Modal';
import { Copy, ShieldAlert } from '../ui/Icons';
import { Req } from '../ui/Req';
import { errorMessage } from '../../lib/errors';
import { apiUrl } from '../../lib/apiBase';
import { antiCheatCall as call } from '../../lib/antiCheatApi';
import { RoomCodePanel } from './RoomCodePanel';
import { ScreenWall } from './ScreenWall';
import { CONNECTION_LABEL, ScanOverview, type ScanOverviewSession } from './ScanOverview';
import { IOS_INDICATOR_KEYS, IOS_INSPECTION_CHECKS, IOS_SIDELOAD_INDICATORS, type IosClearance, type IosIndicator } from '../../lib/iosAntiCheat';
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
/** A referee fills these in by hand: software cannot know who is watching or where the recording comes from. */
export const NOTE_BLANK = '[fill in]';
/** Drafts the iPhone inspection note from the indicator answers, so the referee only adds what they saw. */
export function iosNoteDraft(s: Pick<SessionDetail, 'playerName' | 'matchLabel' | 'device'>, indicators: Partial<Record<IosIndicator, 'clear' | 'found'>>) {
  const found = IOS_INDICATOR_KEYS.filter(key => indicators[key] === 'found').map(key => IOS_SIDELOAD_INDICATORS[key].found);
  return [
    `Inspected ${s.playerName}'s ${[s.device?.model, s.device?.os].filter(Boolean).join(' ') || 'iPhone'} for ${s.matchLabel}. Device and in-game account matched the roster.`,
    found.length ? `Found: ${found.join('; ')}. The player was told how to remove it.` : `All ${IOS_INDICATOR_KEYS.length} sideload and jailbreak indicators were not present.`,
    `Recording source: ${NOTE_BLANK}. Supervising referee: ${NOTE_BLANK}.`,
  ].join(' ');
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
  const [iosChecks, setIosChecks] = useState<Partial<Record<keyof typeof IOS_INSPECTION_CHECKS, boolean>>>({}), [iosNote, setIosNote] = useState('');
  const [iosIndicators, setIosIndicators] = useState<Partial<Record<IosIndicator, 'clear' | 'found'>>>({});
  const [blocking, setBlocking] = useState<{ sha256: string; label: string } | null>(null);
  const indicatorFound = IOS_INDICATOR_KEYS.some(key => iosIndicators[key] === 'found');
  const load = useCallback(() => call<SessionDetail>(`/sessions/${id}`).then(d => { setDetail(d); setError(''); }).catch(e => setError(e.message)), [id]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (detail) { setNote(n => n || detail.reviewNote); setHold(h => h || detail.hold); } }, [detail?.id]);
  const act = async (work: () => Promise<unknown>, done: string) => { setBusy(true); setError(''); setNotice(''); try { await work(); setNotice(done); await load(); onChanged(); } catch (e) { setError(errorMessage(e, 'That action failed.')); } finally { setBusy(false); } };
  const unverified = detail?.signals.filter(s => s.id === 'game-signature-unverified') || [];
  return <Modal open title={detail ? `${detail.playerName} · ${detail.gameLabel}` : 'Monitor session'} description={detail ? `${detail.matchLabel} · ${CONNECTION_LABEL[detail.connection]}` : 'Loading'} busy={busy} onClose={onClose} className="feature-dialog feature-dialog-wide">
    <div className="feature-dialog-body monitor-detail">
      {error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="module-notice" role="status">{notice}</p>}
      {!detail ? <p className="field-hint" role="status">Loading session...</p> : <>
        <div className="monitor-risk-strip"><span className={`monitor-risk ${detail.risk.level}`}>{detail.risk.score}<small>/100</small></span><div><strong>{detail.risk.level === 'clear' ? 'No listed indicators reported' : `Level: ${detail.risk.level}`}</strong><p className="field-hint">A referee decides. Signals describe the device, not the player's intent.</p></div></div>
        <p className="module-notice"><strong>Detection coverage: {detail.inspection?.status || 'not reported'}. </strong>{detail.inspection?.detail || 'No inspection coverage is available. An empty finding list does not prove a clean device.'}</p>
        {detail.platform === 'ios' && <section className="operations-section" aria-label="iPhone anti-cheat inspection">
          <h3>iPhone anti-cheat inspection</h3>
          <p role="status"><strong>{detail.scan?.label}</strong> {detail.scan?.detail}</p>
          <p className="field-hint">Inspect the physical playing device with the player. Clearance lasts 15 minutes for match admission. Maintain supervision and recording throughout play, and revoke clearance when supervision stops or the device changes.</p>
          {detail.iosClearance && <p className="field-hint">Last reviewed at {time(detail.iosClearance.reviewedAt)} by {detail.iosClearance.actor}. {detail.iosClearance.note}</p>}
          <form className="module-form" onSubmit={event => { event.preventDefault(); void act(async () => { await call(`/sessions/${id}/ios-review`, { body: { approved: true, checks: iosChecks, indicators: iosIndicators, note: iosNote } }); setIosChecks({}); setIosIndicators({}); setIosNote(''); }, 'iPhone inspection saved. Supervised clearance lasts up to 15 minutes.'); }}>
            {Object.entries(IOS_INSPECTION_CHECKS).map(([key, label]) => <label className="settings-toggle" key={key}>{label}<input type="checkbox" required checked={iosChecks[key as keyof typeof IOS_INSPECTION_CHECKS] === true} onChange={event => setIosChecks(checks => ({ ...checks, [key]: event.target.checked }))} /></label>)}
            <fieldset className="ios-indicators"><legend>Sideload and jailbreak indicators <span className="ios-progress">Checked {IOS_INDICATOR_KEYS.filter(key => iosIndicators[key]).length} of {IOS_INDICATOR_KEYS.length}</span></legend>
              <p className="field-hint">Check each place on the phone with the player. Any indicator marked found blocks approval until it is removed and the phone is inspected again.</p>
              {IOS_INDICATOR_KEYS.map(key => { const item = IOS_SIDELOAD_INDICATORS[key]; return <div className="ios-indicator" key={key} role="radiogroup" aria-label={item.found}>
                <p><strong>{item.where}</strong><br />{item.found}. <span className="field-hint">{item.why}</span></p>
                <div className="ah-choice">{([['clear', 'Not present'], ['found', 'Found']] as const).map(([value, label]) => <label key={value} className={iosIndicators[key] === value ? 'is-active' : ''}><input type="radio" name={`ios-${key}`} value={value} required checked={iosIndicators[key] === value} onChange={() => setIosIndicators(current => ({ ...current, [key]: value }))} />{label}</label>)}</div>
                {iosIndicators[key] === 'found' && <p className="ios-fix"><strong>Tell the player:</strong> {item.fix} Then check this place again.</p>}
              </div>; })}
            </fieldset>
            {indicatorFound && <p className="field-error" role="alert">An indicator is marked found. Revoke clearance with a note, or have the player remove it and inspect again.</p>}
            <label>iPhone inspection note<textarea required minLength={10} maxLength={2000} value={iosNote} onChange={event => setIosNote(event.target.value)} placeholder="Record the account, device, inspection findings, recording source and supervising referee." /></label>
            <div className="operations-actions"><button type="button" className="arena-outline" disabled={busy || !IOS_INDICATOR_KEYS.every(key => iosIndicators[key])} onClick={() => setIosNote(iosNoteDraft(detail, iosIndicators))}>Write note from checks</button></div>
            {iosNote.includes(NOTE_BLANK) && <p className="field-hint" role="status">Replace each {NOTE_BLANK} in the note before saving.</p>}
            <div className="operations-actions"><button className="arena-primary" disabled={busy || detail.status !== 'active' || indicatorFound || iosNote.includes(NOTE_BLANK)}>Approve supervised iPhone</button><button type="button" className="arena-outline" disabled={busy || iosNote.trim().length < 10 || iosNote.includes(NOTE_BLANK)} onClick={() => void act(async () => { await call(`/sessions/${id}/ios-review`, { body: { approved: false, indicators: iosIndicators, note: iosNote } }); setIosChecks({}); setIosIndicators({}); setIosNote(''); }, 'iPhone clearance revoked. A new inspection is required before admission.')}>Revoke iPhone clearance</button></div>
          </form>
        </section>}
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
      </>}
    </div>
  </Modal>;
}

export function MatchMonitorView({ brackets = [] }: { brackets?: BracketDraft[] }) {
  const [tab, setTab] = useState<'screens' | 'checkin'>('screens');
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

  return <div className="module-page monitor-page">
    <header className="dashboard-page-heading"><h1>Monitor</h1>
      <p>Watch players’ screens live during their match, and check devices before play.</p></header>
    <div className="page-toolbar"><div className="ah-tabs" role="tablist" aria-label="Monitor views">
      {([['screens', 'Live screens'], ['checkin', alerts.length ? `Check-in and scans (${alerts.length})` : 'Check-in and scans']] as const).map(([id, label]) =>
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div></div>
    {tab === 'screens' ? <ScreenWall brackets={brackets} onOpenSession={setOpenId} /> : <>
      <RoomCodePanel onOpenSession={setOpenId} />
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
    {openId && <SessionDialog key={openId} id={openId} onClose={() => setOpenId('')} onChanged={() => void refresh()} />}
  </div>;
}
