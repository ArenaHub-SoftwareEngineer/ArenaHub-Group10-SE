import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../../lib/firebase';
import type { Match } from '../../lib/types';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from '../../lib/fairPlayGames';
import { CATEGORY_LABEL, GAME_LABEL, GAME_PLATFORMS, MONITOR_GAMES, PLATFORM_LABEL, SEVERITIES, SIGNAL_CATEGORIES, type BlockEntry, type MonitorConfig, type MonitorGame, type MonitorPlatform, type RiskResult, type Severity, type SignalCategory } from '../../lib/integrityRisk';
import { CHEAT_CATALOG, LAYER_LABEL } from '../../lib/cheatCatalog';
import { MatchArena } from './MatchArena';
import { Modal } from '../ui/Modal';
import { Copy, QrCode, RefreshCw, ShieldAlert, ShieldCheck } from '../ui/Icons';
import { Req } from '../ui/Req';
import { errorMessage } from '../../lib/errors';
import { apiUrl } from '../../lib/apiBase';
import { antiCheatCall as call } from '../../lib/antiCheatApi';
import { PreMatchScanPanel } from './PreMatchScanPanel';
import { rosterPlayerKey, type ScanReadiness } from '../../lib/preMatchScan';
import { IOS_INDICATOR_KEYS, IOS_INSPECTION_CHECKS, IOS_SIDELOAD_INDICATORS, type IosClearance, type IosIndicator } from '../../lib/iosAntiCheat';
import '../../monitor.css';

interface SessionView {
  id: string; matchId: string; matchLabel: string; game: MonitorGame; gameLabel: string; platform: MonitorPlatform; playerName: string; team: string; expectedSteamId: string;
  status: 'pending' | 'active' | 'ended' | 'declined'; connection: 'waiting' | 'online' | 'paired' | 'lost' | 'ended' | 'declined'; record: boolean; createdAt: number; expiresAt: number; claimedAt: number | null; endedAt: number | null;
  lastSeen: number | null; device: { model?: string; os?: string; agent?: string } | null; gsi: { matchId: string; steamId: string; hero: string; gameState: string; clockTime: number | null } | null;
  reviewNote: string; hold: boolean; mediaBytes: number; risk: RiskResult;
  inspection?: { status: string; detail: string };
  scan?: ScanReadiness;
  iosClearance?: IosClearance | null;
}
interface SessionDetail extends SessionView {
  signals: { id: string; severity: Severity; evidence: string; firstSeen: number; lastSeen: number; count: number; title: string; explain: string; category: SignalCategory; fingerprint?: { sha256: string; listed: boolean } }[];
  media: { id: number; kind: 'video' | 'image'; bytes: number; createdAt: number }[];
  audit: { at: number; actor: string; action: string; note: string }[];
  lastFacts?: { dota?: { found: boolean; buildId?: string; manifestSha256?: string; updatePending?: boolean } } | null;
}
interface Pairing { id: string; code: string; codeExpiresAt: number; platform: MonitorPlatform; link: string; qr: string; agentCommand: string }

const DEVICE_LABEL: Record<MonitorPlatform, string> = { android: 'Android companion', ios: 'iPhone supervised anti-cheat', pc: 'PC agent' };
async function mediaUrl(sessionId: string, mediaId: number) {
  const user = auth.currentUser; if (!user) throw new Error('Sign in again.');
  const response = await fetch(apiUrl(`/api/integrity/sessions/${sessionId}/media/${mediaId}`), { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  if (!response.ok) throw new Error('This recording could not be opened.');
  return URL.createObjectURL(await response.blob());
}

const time = (ms: number | null) => ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const gameOf = (match: Match): MonitorGame | '' => (FAIR_PLAY_GAMES.find(g => belongsToFairPlayGame(match, g))?.id as MonitorGame) || '';
const CONNECTION_LABEL = { waiting: 'Waiting for device', online: 'Online', paired: 'Checked in', lost: 'Not reporting', ended: 'Ended', declined: 'Declined' };

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
const entriesToText = (entries: BlockEntry[]) => entries.map(e => `${e.match} | ${e.label} | ${e.severity}`).join('\n');
function textToEntries(text: string): BlockEntry[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => {
    const [match, label, severity] = line.split('|').map(part => part.trim());
    if (!match || !label || !SEVERITIES.includes(severity as Severity)) throw new Error(`Line ${index + 1} must look like: pattern | label | ${SEVERITIES.join('/')}`);
    return { match: match.toLowerCase(), label, severity: severity as Severity };
  });
}
const hashesToText = (entries: { sha256: string; label: string; severity: Severity }[] = []) => entries.map(e => `${e.sha256} | ${e.label} | ${e.severity}`).join('\n');
function textToHashes(text: string) {
  return textToEntries(text).map(({ match: sha256, ...entry }, index) => {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Fingerprint line ${index + 1} needs exactly 64 hexadecimal characters.`);
    return { sha256, ...entry };
  });
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
            <button type="button" className="arena-outline" disabled={busy} onClick={() => void navigator.clipboard.writeText(caseSummary(detail)).then(() => setNotice('Case summary copied. Paste it into a Fair play report.'), () => setError('Copy failed. Select the text manually.'))}><Copy size={15} /> Copy case summary</button>
            <button type="button" className="arena-outline" disabled={busy} onClick={() => void act(() => call(`/sessions/${id}/review`, { body: { note, hold } }), 'Review saved.')}>Save review</button>
            {detail.status !== 'ended' && <button type="button" className="arena-primary" disabled={busy} onClick={() => void act(() => call(`/sessions/${id}/end`, { body: {} }), 'Monitoring ended. The device stops on its next report.')}>End monitoring</button>}
          </div>
        </div>
        <details><summary>Activity log</summary><ol className="monitor-audit">{detail.audit.map((a, i) => <li key={i}><strong>{a.action.replaceAll('-', ' ')}</strong> · {time(a.at)} · {a.note}</li>)}</ol></details>
      </>}
    </div>
  </Modal>;
}

function SettingsPanel() {
  const [config, setConfig] = useState<MonitorConfig | null>(null), [android, setAndroid] = useState(''), [pc, setPc] = useState('');
  const [installed, setInstalled] = useState(''), [modules, setModules] = useState(''), [fileHashes, setFileHashes] = useState(''), [certificates, setCertificates] = useState('');
  const [fileSweep, setFileSweep] = useState(false), [manifests, setManifests] = useState('');
  const [thresholds, setThresholds] = useState({ watch: 15, review: 35, urgent: 70 }), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const load = () => call<MonitorConfig>('/config').then(c => { setConfig(c); setAndroid(entriesToText(c.android.blockedPackages)); setPc(entriesToText(c.pc.blockedProcesses)); setInstalled(entriesToText(c.pc.blockedApplications || [])); setModules(entriesToText(c.pc.blockedModules || [])); setFileHashes(hashesToText(c.pc.blockedFileHashes)); setCertificates(hashesToText(c.android.blockedCertificates)); setFileSweep(c.pc.fileSweep === true); setManifests(hashesToText(c.pc.trustedDotaManifests)); setThresholds(c.thresholds); }).catch(e => setError(e.message));
  return <details className="operations-section" onToggle={e => { if ((e.target as HTMLDetailsElement).open && !config) void load(); }}>
    <summary><strong>Blocklists and thresholds</strong></summary>
    <p className="field-hint">One entry per line: <code>pattern | label | severity</code>. A trailing * matches the start of a name. Review these lists before every event; cheat tools rename themselves often.</p>
    {error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="module-notice" role="status">{notice}</p>}
    {config && <form className="module-form" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); setNotice(''); try {
      const next: MonitorConfig = { ...config, android: { ...config.android, blockedPackages: textToEntries(android), blockedCertificates: textToHashes(certificates) }, pc: { ...config.pc, blockedProcesses: textToEntries(pc), blockedApplications: textToEntries(installed), blockedModules: textToEntries(modules), blockedFileHashes: textToHashes(fileHashes), fileSweep, trustedDotaManifests: textToHashes(manifests) }, thresholds };
      void call<MonitorConfig>('/config', { method: 'PUT', body: next }).then(c => { setConfig(c); setNotice('Saved. Devices pick up the new lists on their next report.'); }).catch(err => setError(err.message)).finally(() => setBusy(false));
    } catch (err) { setError(errorMessage(err, 'Check the lists.')); setBusy(false); } }}>
      <label>Android apps (package names)<textarea rows={8} value={android} onChange={e => setAndroid(e.target.value)} spellCheck={false} /></label>
      <label>PC programs (process names)<textarea rows={8} value={pc} onChange={e => setPc(e.target.value)} spellCheck={false} /></label>
      <label>PC installed software (registered display names)<textarea rows={5} value={installed} onChange={e => setInstalled(e.target.value)} spellCheck={false} /></label>
      <label>Dota 2 restricted libraries (DLL names)<textarea rows={4} value={modules} onChange={e => setModules(e.target.value)} spellCheck={false} /></label>
      <details><summary>Fingerprint checks</summary><p className="field-hint">One verified fingerprint per line: SHA-256 | label | severity. File fingerprints identify inspected executables and loaded Dota 2 libraries even after renaming. Certificate fingerprints identify Android apps signed with a listed key. Use independently verified indicators; a match still needs review.</p>
        <label>PC executable SHA-256 fingerprints<textarea rows={4} value={fileHashes} onChange={e => setFileHashes(e.target.value)} spellCheck={false} /></label>
        <label>Android signing-certificate SHA-256 fingerprints<textarea rows={4} value={certificates} onChange={e => setCertificates(e.target.value)} spellCheck={false} /></label>
        <label>Dota 2 reference file lists (dota.signatures SHA-256)<textarea rows={3} value={manifests} onChange={e => setManifests(e.target.value)} spellCheck={false} placeholder="sha256 | Build 26632873 | high" /></label>
        <p className="field-hint">Optional. On an organizer PC, run Steam's Verify integrity for Dota 2, then start the PC agent: it prints the build and the SHA-256 of Valve's file list. Add one line per build in use. Players whose list differs are blocked until they verify their game files. Leave empty to rely on the per-file check alone.</p>
      </details>
      <label className="settings-toggle">Cheat-file folder check on player PCs<input type="checkbox" checked={fileSweep} onChange={e => setFileSweep(e.target.checked)} /></label>
      <p className="field-hint">On by default (tournament rule). The PC agent asks the player for permission, then checks the user profile and other drives by content, not by name: renamed copies of listed tools, unsigned programs that target dota2.exe or contain DLL-injection functions, cheat-loader protectors, Cheat Engine tables, macro scripts and ZIP archives. Only matching file names are sent. Players who refuse cannot pass the pre-match scan, so publish this rule before the event.</p>
      <div className="monitor-thresholds">{(['watch', 'review', 'urgent'] as const).map(k => <label key={k}>{k} at score<input type="number" min={1} max={100} value={thresholds[k]} onChange={e => setThresholds(t => ({ ...t, [k]: Number(e.target.value) }))} /></label>)}</div>
      <p className="field-hint">Trusted game signatures: MLBB {config.android.games.mlbb.trustedCertSha256.length}, CODM {config.android.games.codm.trustedCertSha256.length}. Add them from a session with a known-good phone.</p>
      <div className="feature-dialog-actions"><button className="arena-primary" disabled={busy}>Save settings</button></div>
    </form>}
  </details>;
}

export function MatchMonitorView({ matches }: { matches: Match[] }) {
  const [sessions, setSessions] = useState<SessionView[]>([]), [urls, setUrls] = useState<string[]>([]), [error, setError] = useState(''), [downloads, setDownloads] = useState<string[]>([]), [publicUrl, setPublicUrl] = useState('');
  const [matchId, setMatchId] = useState(''), [customLabel, setCustomLabel] = useState(''), [game, setGame] = useState<MonitorGame>('mlbb');
  const [player, setPlayer] = useState(''), [steamId, setSteamId] = useState(''), [hours, setHours] = useState(4), [server, setServer] = useState('');
  const [platform, setPlatform] = useState<MonitorPlatform>('android'), [team, setTeam] = useState(''), [record, setRecord] = useState(false);
  const [playerKey, setPlayerKey] = useState('');
  const [dismissed, setDismissed] = useState<string[]>([]), [desktopAlerts, setDesktopAlerts] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const announced = useRef<Set<string> | null>(null);
  // An event day can pile up hundreds of sessions and alerts; show the newest first and let staff expand on demand.
  const [allSessions, setAllSessions] = useState(false), [allAlerts, setAllAlerts] = useState(false);
  const [pairing, setPairing] = useState<Pairing & { playerName: string } | null>(null), [busy, setBusy] = useState(false), [openId, setOpenId] = useState(''), [filter, setFilter] = useState('');
  const monitorable = useMemo(() => matches.filter(m => gameOf(m) && (m.lobby || (m.team1 && m.team2 && !m.team1.isBye && !m.team2.isBye)) && m.status !== 'completed'), [matches]);
  const match = monitorable.find(m => m.id === matchId);
  const matchTeams = match ? match.lobby?.teams || [match.team1, match.team2].filter(t => !!t) : [];
  useEffect(() => { if (!GAME_PLATFORMS[game].includes(platform)) setPlatform(GAME_PLATFORMS[game][0]); }, [game]);
  const refresh = useCallback(() => call<SessionView[]>(`/sessions${filter ? `?matchId=${encodeURIComponent(filter)}` : ''}`).then(s => { setSessions(s); setError(''); }).catch(e => setError(e.message)), [filter]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { call<{ urls: string[]; downloads?: string[]; publicUrl?: string }>('/server-info').then(info => { setUrls(info.urls); setDownloads(info.downloads || []); setPublicUrl(info.publicUrl || ''); setServer(s => s || info.urls[0] || ''); }).catch(() => {}); }, []);
  useEffect(() => { if (match) { const g = gameOf(match); if (g) setGame(g); } }, [matchId]);
  const alerts = useMemo(() => alertsFor(sessions).filter(a => !dismissed.includes(a.key)), [sessions, dismissed]);
  // New alerts pop up as desktop notifications (if allowed) and show a count in the browser tab.
  useEffect(() => {
    const keys = alertsFor(sessions).map(a => a.key);
    if (announced.current === null) { if (sessions.length) announced.current = new Set(keys); return; }
    for (const alert of alertsFor(sessions)) {
      if (announced.current.has(alert.key)) continue;
      announced.current.add(alert.key);
      if (desktopAlerts && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('ArenaHub match monitor', { body: alert.text, tag: alert.key });
    }
  }, [sessions, desktopAlerts]);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = alerts.length ? `(${alerts.length}) ${base}` : base;
    return () => { document.title = document.title.replace(/^\(\d+\) /, ''); };
  }, [alerts.length]);

  const pair = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(''); setPairing(null);
    try {
      const label = match ? match.lobby ? `${match.roundName} · ${match.lobby.squads} squads` : `${match.matchNumber} · ${match.team1?.name} vs ${match.team2?.name}` : customLabel.trim();
      const selected = matchTeams.flatMap(team => team!.players.filter(p => p.ign === player).map(p => rosterPlayerKey(team!.id, p.id)));
      const result = await call<Pairing>('/pairings', { body: { matchId: match?.id || `scrim-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`, matchLabel: label, game, platform, team: team.trim(), playerKey: match ? playerKey || (selected.length === 1 ? selected[0] : '') : '', record, playerName: player.trim(), expectedSteamId: game === 'dota2' ? steamId.trim() : '', hours, serverUrl: server.trim().replace(/\/$/, '') } });
      setPairing({ ...result, playerName: player.trim() }); setPlayer(''); setSteamId(''); void refresh();
    } catch (err) { setError(errorMessage(err, 'Pairing failed.')); } finally { setBusy(false); }
  };
  const serverBase = server.trim().endsWith('/') ? server.trim().slice(0, -1) : server.trim();
  const counts = { online: sessions.filter(s => ['online', 'paired'].includes(s.connection)).length, lost: sessions.filter(s => s.connection === 'lost').length, declined: sessions.filter(s => s.connection === 'declined').length, flagged: sessions.filter(s => ['review', 'urgent'].includes(s.risk.level)).length };
  const matchOptions = [...new Map(sessions.map(s => [s.matchId, s.matchLabel])).entries()];
  const arenaMatch = filter || sessions[0]?.matchId || '';
  const arenaPlayers = sessions.filter(s => s.matchId === arenaMatch);

  return <div className="module-page monitor-page">
    <header className="dashboard-page-heading"><h1>Anti-cheat</h1>
      <p>Required device scans before MLBB, CODM BR/MP and Dota 2 matches. Resolve restricted tools before players join.</p></header>
    <PreMatchScanPanel matches={monitorable} onPair={(id, key, name, team) => { const selected = monitorable.find(match => match.id === id); setMatchId(id); setPlayerKey(key); setPlayer(name); setTeam(team); setRecord(false); if (selected) { const game = gameOf(selected); if (game) { setGame(game); setPlatform(game === 'dota2' ? 'pc' : 'android'); } } document.querySelector('.monitor-pair-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
    {error && <p className="field-error" role="alert">{error}</p>}
    {alerts.length > 0 && <section className="monitor-alerts" role="alert" aria-label="Needs your attention">
      <div className="operations-row"><strong>Needs your attention ({alerts.length})</strong>{typeof Notification !== 'undefined' && !desktopAlerts && <button type="button" className="arena-outline" onClick={() => void Notification.requestPermission().then(p => setDesktopAlerts(p === 'granted'))}>Turn on desktop alerts</button>}</div>
      <ul>{(allAlerts ? alerts : alerts.slice(0, 5)).map(a => <li key={a.key}><span>{a.text}</span><span className="monitor-alert-actions"><button type="button" className="arena-outline" onClick={() => setOpenId(a.sessionId)}>Open</button><button type="button" className="arena-outline" onClick={() => setDismissed(d => [...d, a.key])}>Done</button></span></li>)}</ul>
      {alerts.length > 5 && <button type="button" className="arena-text-button monitor-more" aria-expanded={allAlerts} onClick={() => setAllAlerts(v => !v)}>{allAlerts ? 'Show fewer alerts' : `Show all ${alerts.length} alerts`}</button>}
    </section>}
    {alerts.length === 0 && typeof Notification !== 'undefined' && !desktopAlerts && <p className="field-hint"><button type="button" className="arena-outline" onClick={() => void Notification.requestPermission().then(p => setDesktopAlerts(p === 'granted'))}>Turn on desktop alerts</button> to be told when a player declines or a device goes quiet, even in another tab.</p>}
    <div className="feature-summary monitor-summary" aria-label="Monitor overview"><div><strong>{counts.online}</strong><span>Checked in</span></div><div><strong>{counts.declined}</strong><span>Declined</span></div><div><strong>{counts.lost}</strong><span>Not reporting</span></div><div><strong>{counts.flagged}</strong><span>Need a referee</span></div></div>

    <section className="operations-section">
      <div className="operations-section-heading"><QrCode size={20} /><div><h2>Pair a device</h2><p>Every player scans the code with their phone camera (PC players can type the address shown). The page that opens opens the companion or iPhone inspection flow and lets players agree or decline. Codes work once and expire in 5 minutes.</p></div></div>
      <form className="module-form monitor-pair-form" onSubmit={e => void pair(e)}>
        <label>Match<select value={matchId} onChange={e => { setMatchId(e.target.value); setPlayerKey(''); setTeam(''); }}><option value="">Scrim or unlisted match</option>{monitorable.map(m => <option key={m.id} value={m.id}>{m.lobby ? `${m.roundName} - ${m.lobby.squads} squads` : `${m.matchNumber} - ${m.team1?.name} vs ${m.team2?.name}`}</option>)}</select></label>
        {!match && <label><Req>Match name</Req><input required maxLength={200} value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="e.g. Practice scrim CCS vs COE" /></label>}
        <label>Game<select value={game} onChange={e => setGame(e.target.value as MonitorGame)}>{MONITOR_GAMES.map(g => <option key={g} value={g}>{GAME_LABEL[g]}</option>)}</select></label>
        <label>Device<select value={platform} onChange={e => setPlatform(e.target.value as MonitorPlatform)}>{GAME_PLATFORMS[game].map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
        <label>Team{matchTeams.length ? <select value={team} onChange={e => setTeam(e.target.value)}><option value="">Choose team</option>{matchTeams.map(t => <option key={t!.id} value={t!.name}>{t!.name}</option>)}</select> : <input maxLength={80} value={team} onChange={e => setTeam(e.target.value)} placeholder="e.g. CCS Phoenix" />}</label>
        <label><Req>Player (IGN)</Req>{match ? <select required value={playerKey} onChange={event => { setPlayerKey(event.target.value); const selected = matchTeams.flatMap(team => team!.players.map(player => ({ key: rosterPlayerKey(team!.id, player.id), player, team: team! }))).find(item => item.key === event.target.value); setPlayer(selected?.player.ign || selected?.player.name || ''); if (selected) setTeam(selected.team.name); }}><option value="">Choose the roster player</option>{matchTeams.filter(item => !team || item!.name === team).flatMap(item => item!.players.map(player => <option key={rosterPlayerKey(item!.id, player.id)} value={rosterPlayerKey(item!.id, player.id)}>{player.ign} · {item!.name}</option>))}</select> : <input required maxLength={80} value={player} onChange={event => { setPlayer(event.target.value); setPlayerKey(''); }} />}</label>
        {game === 'dota2' && <label>Steam ID (17 digits, optional)<input inputMode="numeric" maxLength={17} value={steamId} onChange={e => setSteamId(e.target.value.replace(/\D/g, ''))} placeholder="7656119..." /></label>}
        {<label className="settings-toggle">{platform === 'ios' ? 'Allow player recording uploads' : platform === 'pc' ? 'Take screenshots during the match' : 'Record the screen during the match'}<input type="checkbox" checked={record} onChange={e => setRecord(e.target.checked)} /></label>}
        {platform !== 'ios' && <p className="field-hint">{record ? 'Uses a little battery and data (about 11 MB a minute on Wi-Fi, 4.5 MB on mobile data). Turn it off for casual matches; device checks still run.' : 'Only device checks run. Record from the observer slot if you need video.'}</p>}
        {platform === 'ios' && <p className="field-hint">After the player agrees in Safari, open their session and complete the iPhone inspection. Arrange continuous supervision and player-view or observer recording. Supervised clearance lasts 15 minutes for admission.</p>}
        <label>Monitoring window (hours)<input type="number" min={0.5} max={12} step={0.5} value={hours} onChange={e => setHours(Number(e.target.value))} /></label>
        <label><Req>Address players will use</Req><input required list="monitor-urls" value={server} onChange={e => setServer(e.target.value)} placeholder="https://....trycloudflare.com" /><datalist id="monitor-urls">{urls.map(u => <option key={u} value={u} />)}</datalist></label>
        {publicUrl && server === publicUrl ? <p className="field-hint monitor-online">Online: players can join from any Wi-Fi or mobile data.</p>
          : publicUrl ? <p className="field-hint">This is a Wi-Fi address: only devices on the same network as this laptop can use it. Choose {publicUrl} so players can join from anywhere.</p>
          : <p className="field-hint">{urls.length ? 'Wi-Fi only: players must be on the same network as this laptop.' : 'Players cannot reach this laptop yet.'} To let players join from their own Wi-Fi or mobile data, stop the server and start it with npm run online.</p>}
        <div className="feature-dialog-actions"><button className="arena-primary" disabled={busy}>{busy ? 'Creating...' : 'Create pairing code'}</button></div>
      </form>
      {pairing && <div className="monitor-pairing" role="status">
        <img src={pairing.qr} alt={`Pairing QR code for ${pairing.playerName}`} width={220} height={220} />
        <div><p className="field-hint">For {pairing.playerName} · expires {time(pairing.codeExpiresAt)}</p><p className="monitor-code">{pairing.code}</p>
          {pairing.platform === 'android' ? <><p>The player scans this with the phone camera. The page that opens offers <strong>Download the app</strong> the first time and <strong>Open ArenaHub Companion</strong> after that. They agree or decline inside the app.</p>{!downloads.includes('arenahub-companion.apk') && <p className="field-error">The Android app is unavailable on this API server. Run npm run build:companion.</p>}</>
            : pairing.platform === 'ios' ? <p>The player scans this with the iPhone camera and agrees in Safari. Open their session to inspect the device, verify recording and approve supervised iPhone clearance.</p>
            : <><p>On the player's PC, open <code className="monitor-command">{pairing.link}</code> to download the agent, or if it is already there, run:</p><code className="monitor-command">{pairing.agentCommand}</code>{!downloads.includes('arenahub-agent.exe') && <p className="field-error">The PC agent is unavailable on this API server. Run npm run build:agent.</p>}</>}
        </div>
      </div>}
    </section>

    {arenaPlayers.length > 0 && <section className="operations-section">
      <div className="feature-section-bar"><div><h2>Match arena</h2><p className="field-hint">{arenaPlayers[0].matchLabel} · {arenaPlayers[0].gameLabel}</p></div></div>
      <MatchArena players={arenaPlayers} onOpen={setOpenId} />
    </section>}

    <section className="operations-section">
      <div className="feature-section-bar"><div><h2>Player scans</h2><p className="field-hint">Updates every 5 seconds from the monitor API. Reports and recordings use its private storage.</p></div>
        <div className="module-form monitor-inline"><label>Match<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All recent</option>{matchOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button type="button" className="arena-outline" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button></div></div>
      {!sessions.length ? <p className="field-hint">No sessions yet. Create a pairing code above.</p> : <ul className="monitor-sessions">{(allSessions ? sessions : sessions.slice(0, 24)).map(s => <li key={s.id} className={`monitor-session ${s.risk.level}`}>
        <div className="operations-row"><strong>{s.playerName}</strong><span className={`monitor-conn ${s.connection}`}>{CONNECTION_LABEL[s.connection]}</span></div>
        <p className="field-hint">{s.gameLabel} · {PLATFORM_LABEL[s.platform]}{s.team ? ` · ${s.team}` : ''}{s.platform !== 'ios' && !s.record ? ' · recording off' : ''} · {s.matchLabel}</p>
        <div className="monitor-session-risk"><span className={`monitor-risk ${s.risk.level}`}>{s.risk.score}</span><span>{s.scan?.label || 'Scan required'}</span></div>
        <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setOpenId(s.id)}>{['review', 'urgent'].includes(s.risk.level) ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />} Open session</button>
      </li>)}</ul>}
      {sessions.length > 24 && <button type="button" className="arena-outline monitor-more" aria-expanded={allSessions} onClick={() => setAllSessions(v => !v)}>{allSessions ? 'Show the 24 newest' : `Show all ${sessions.length} sessions`}</button>}
    </section>
    <SettingsPanel />
    {openId && <SessionDialog id={openId} onClose={() => setOpenId('')} onChanged={() => void refresh()} />}
  </div>;
}
