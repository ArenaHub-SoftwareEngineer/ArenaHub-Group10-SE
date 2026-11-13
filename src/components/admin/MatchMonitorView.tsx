import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../../lib/firebase';
import type { Match } from '../../lib/types';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from '../../lib/fairPlayGames';
import { CATEGORY_LABEL, GAME_LABEL, GAME_PLATFORMS, MONITOR_GAMES, PLATFORM_LABEL, SEVERITIES, SIGNAL_CATEGORIES, type BlockEntry, type MonitorConfig, type MonitorGame, type MonitorPlatform, type RiskResult, type Severity, type SignalCategory } from '../../lib/integrityRisk';
import { CHEAT_CATALOG, LAYER_LABEL } from '../../lib/cheatCatalog';
import { MatchArena } from './MatchArena';
import { Modal } from '../ui/Modal';
import { Copy, QrCode, RefreshCw, ShieldAlert, ShieldCheck } from '../ui/Icons';
import '../../monitor.css';

interface SessionView {
  id: string; matchId: string; matchLabel: string; game: MonitorGame; gameLabel: string; platform: MonitorPlatform; playerName: string; team: string; expectedSteamId: string;
  status: 'pending' | 'active' | 'ended' | 'declined'; connection: 'waiting' | 'online' | 'paired' | 'lost' | 'ended' | 'declined'; record: boolean; createdAt: number; expiresAt: number; claimedAt: number | null; endedAt: number | null;
  lastSeen: number | null; device: { model?: string; os?: string; agent?: string } | null; gsi: { matchId: string; steamId: string; hero: string; gameState: string; clockTime: number | null } | null;
  reviewNote: string; hold: boolean; mediaBytes: number; risk: RiskResult;
}
interface SessionDetail extends SessionView {
  signals: { id: string; severity: Severity; evidence: string; firstSeen: number; lastSeen: number; count: number; title: string; explain: string; category: SignalCategory }[];
  media: { id: number; kind: 'video' | 'image'; bytes: number; createdAt: number }[];
  audit: { at: number; actor: string; action: string; note: string }[];
}
interface Pairing { id: string; code: string; codeExpiresAt: number; platform: MonitorPlatform; link: string; qr: string; agentCommand: string }

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with a staff account to use the match monitor.');
  const response = await fetch(`/api/integrity${path}`, { method: init.method || (init.body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' }, body: init.body ? JSON.stringify(init.body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `The monitor service answered ${response.status}. Is the ArenaHub server running on this laptop?`);
  return data as T;
}
const DEVICE_LABEL: Record<MonitorPlatform, string> = { android: 'Android companion', ios: 'iPhone check-in', pc: 'PC agent' };
async function mediaUrl(sessionId: string, mediaId: number) {
  const user = auth.currentUser; if (!user) throw new Error('Sign in again.');
  const response = await fetch(`/api/integrity/sessions/${sessionId}/media/${mediaId}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
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
export function caseSummary(s: SessionDetail) {
  return [
    `[Match monitor] ${s.playerName} - ${s.matchLabel} (${s.gameLabel}, ${DEVICE_LABEL[s.platform]})`,
    `Risk ${s.risk.score}/100 (${s.risk.level}). By category: ${SIGNAL_CATEGORIES.filter(k => s.risk.categories[k] > 0).map(k => `${CATEGORY_LABEL[k]} ${s.risk.categories[k]}`).join(', ') || 'none'}. Monitor session ${s.id}. Device: ${[s.device?.model, s.device?.os].filter(Boolean).join(', ') || 'unknown'}.`,
    ...s.signals.filter(sig => sig.severity !== 'info').map(sig => `- ${sig.title} [${sig.severity}] ${sig.evidence} (seen ${sig.count}x, ${time(sig.firstSeen)} to ${time(sig.lastSeen)})`),
    `Recordings: ${s.media.length} files kept on the event laptop under this session ID.`,
    'These are device signals for a human referee, not proof of cheating.',
  ].join('\n');
}

function MediaItem({ sessionId, item }: { sessionId: string; item: SessionDetail['media'][number] }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }, [url]);
  const open = () => { setError(''); (item.kind === 'video' ? call<{ url: string }>(`/sessions/${sessionId}/media/${item.id}/ticket`, { body: {} }).then(t => t.url) : mediaUrl(sessionId, item.id)).then(setUrl).catch(e => setError(e.message)); };
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
  const load = useCallback(() => call<SessionDetail>(`/sessions/${id}`).then(d => { setDetail(d); setError(''); }).catch(e => setError(e.message)), [id]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (detail) { setNote(n => n || detail.reviewNote); setHold(h => h || detail.hold); } }, [detail?.id]);
  const act = async (work: () => Promise<unknown>, done: string) => { setBusy(true); setError(''); setNotice(''); try { await work(); setNotice(done); await load(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'That action failed.'); } finally { setBusy(false); } };
  const unverified = detail?.signals.filter(s => s.id === 'game-signature-unverified') || [];
  return <Modal open title={detail ? `${detail.playerName} · ${detail.gameLabel}` : 'Monitor session'} description={detail ? `${detail.matchLabel} · ${CONNECTION_LABEL[detail.connection]}` : 'Loading'} busy={busy} onClose={onClose} className="feature-dialog feature-dialog-wide">
    <div className="feature-dialog-body monitor-detail">
      {error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="module-notice" role="status">{notice}</p>}
      {!detail ? <p className="field-hint" role="status">Loading session...</p> : <>
        <div className="monitor-risk-strip"><span className={`monitor-risk ${detail.risk.level}`}>{detail.risk.score}<small>/100</small></span><div><strong>{detail.risk.level === 'clear' ? 'No concerns reported' : `Level: ${detail.risk.level}`}</strong><p className="field-hint">A referee decides. Signals describe the device, not the player's intent.</p></div></div>
        <dl className="monitor-facts">
          <div><dt>Device</dt><dd>{[detail.device?.model, detail.device?.os, detail.device?.agent].filter(Boolean).join(' · ') || 'Not paired yet'}</dd></div>
          <div><dt>Last report</dt><dd>{time(detail.lastSeen)}</dd></div>
          <div><dt>Window closes</dt><dd>{time(detail.expiresAt)}</dd></div>
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
        </li>)}</ul>}
        {unverified.length > 0 && <div className="module-notice"><strong>Game signature not trusted yet.</strong> Only trust a signature reported by a phone you know has the game from the Play Store or App Store.
          {unverified.map(s => { const cert = s.evidence.match(/[0-9a-f]{64}/)?.[0]; return cert && <button key={cert} type="button" className="arena-outline" disabled={busy} onClick={() => void act(() => call(`/sessions/${id}/trust-signature`, { body: { cert } }), 'Signature trusted. Phones with a different signature will now be flagged as critical.')}>Trust {cert.slice(0, 12)}...</button>; })}
        </div>}
        {detail.game === 'dota2' && <form className="module-form monitor-inline" onSubmit={e => { e.preventDefault(); void act(async () => { const r = await call<{ compared: number; outliers: unknown[] }>(`/sessions/${id}/opendota`, { body: dotaMatch ? { matchId: dotaMatch } : {} }); setNotice(`Compared with ${r.compared} past games: ${r.outliers.length} unusual stats.`); }, ''); }}>
          <label>Dota 2 match ID (blank uses the live one)<input inputMode="numeric" value={dotaMatch} onChange={e => setDotaMatch(e.target.value.replace(/\D/g, ''))} placeholder={detail.gsi?.matchId || 'e.g. 7412345678'} /></label>
          <button className="arena-outline" disabled={busy}>Check stats on OpenDota</button>
        </form>}
        <h3>Recordings and screenshots ({detail.media.length}, {megabytes(detail.mediaBytes)})</h3>
        {!detail.media.length ? <p className="field-hint">Nothing uploaded yet.</p> : <ul className="monitor-media">{detail.media.slice(-24).reverse().map(m => <MediaItem key={m.id} sessionId={id} item={m} />)}</ul>}
        {detail.media.length > 24 && <p className="field-hint">Showing the latest 24. Older files are in the session folder on this laptop.</p>}
        <h3>What to look for in {detail.gameLabel}</h3>
        <div className="monitor-catalog">{CHEAT_CATALOG[detail.game].map(cheat => <details key={cheat.id}><summary>{cheat.name}</summary><p>{cheat.what}</p>
          <div className="monitor-layers" aria-label="Layers that can catch it">{cheat.layers.map(layer => <span key={layer}>{LAYER_LABEL[layer]}</span>)}</div>
          <ul>{cheat.tells.map(tell => <li key={tell}>{tell}</li>)}</ul></details>)}</div>
        <form className="module-form" onSubmit={e => { e.preventDefault(); void act(async () => { await call(`/sessions/${id}/observations`, { body: { cheatId, severity: seenLevel, note: seenNote } }); setSeenNote(''); setCheatId(''); }, 'Observation recorded. It now counts in the Behaviour category.'); }}>
          <div className="monitor-inline">
            <label>I saw signs of<select required value={cheatId} onChange={e => setCheatId(e.target.value)}><option value="">Choose a cheat type</option>{CHEAT_CATALOG[detail.game].map(cheat => <option key={cheat.id} value={cheat.id}>{cheat.name}</option>)}</select></label>
            <label>How strong is it?<select value={seenLevel} onChange={e => setSeenLevel(e.target.value as Severity)}><option value="low">Low: worth a note</option><option value="medium">Medium: needs a second look</option><option value="high">High: clear in the evidence</option></select></label>
          </div>
          <label>What you saw and when<input required minLength={10} maxLength={150} value={seenNote} onChange={e => setSeenNote(e.target.value)} placeholder="e.g. Crosshair followed an enemy behind the wall at 12:40" /></label>
          <div className="feature-dialog-actions"><button className="arena-outline" disabled={busy}>Record observation</button></div>
        </form>
        <div className="module-form case-decision">
          <label>Referee note<textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)} placeholder="What you checked and what you concluded." /></label>
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
  const [thresholds, setThresholds] = useState({ watch: 15, review: 35, urgent: 70 }), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const load = () => call<MonitorConfig>('/config').then(c => { setConfig(c); setAndroid(entriesToText(c.android.blockedPackages)); setPc(entriesToText(c.pc.blockedProcesses)); setThresholds(c.thresholds); }).catch(e => setError(e.message));
  return <details className="operations-section" onToggle={e => { if ((e.target as HTMLDetailsElement).open && !config) void load(); }}>
    <summary><strong>Blocklists and thresholds</strong></summary>
    <p className="field-hint">One entry per line: <code>pattern | label | severity</code>. A trailing * matches the start of a name. Review these lists before every event; cheat tools rename themselves often.</p>
    {error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="module-notice" role="status">{notice}</p>}
    {config && <form className="module-form" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); setNotice(''); try {
      const next: MonitorConfig = { ...config, android: { ...config.android, blockedPackages: textToEntries(android) }, pc: { blockedProcesses: textToEntries(pc) }, thresholds };
      void call<MonitorConfig>('/config', { method: 'PUT', body: next }).then(c => { setConfig(c); setNotice('Saved. Devices pick up the new lists on their next report.'); }).catch(err => setError(err.message)).finally(() => setBusy(false));
    } catch (err) { setError(err instanceof Error ? err.message : 'Check the lists.'); setBusy(false); } }}>
      <label>Android apps (package names)<textarea rows={8} value={android} onChange={e => setAndroid(e.target.value)} spellCheck={false} /></label>
      <label>PC programs (process names)<textarea rows={8} value={pc} onChange={e => setPc(e.target.value)} spellCheck={false} /></label>
      <div className="monitor-thresholds">{(['watch', 'review', 'urgent'] as const).map(k => <label key={k}>{k} at score<input type="number" min={1} max={100} value={thresholds[k]} onChange={e => setThresholds(t => ({ ...t, [k]: Number(e.target.value) }))} /></label>)}</div>
      <p className="field-hint">Trusted game signatures: MLBB {config.android.games.mlbb.trustedCertSha256.length}, CODM {config.android.games.codm.trustedCertSha256.length}. Add them from a session with a known-good phone.</p>
      <div className="feature-dialog-actions"><button className="arena-primary" disabled={busy}>Save settings</button></div>
    </form>}
  </details>;
}

export function MatchMonitorView({ matches }: { matches: Match[] }) {
  const [sessions, setSessions] = useState<SessionView[]>([]), [urls, setUrls] = useState<string[]>([]), [error, setError] = useState(''), [downloads, setDownloads] = useState<string[]>([]);
  const [matchId, setMatchId] = useState(''), [customLabel, setCustomLabel] = useState(''), [game, setGame] = useState<MonitorGame>('mlbb');
  const [player, setPlayer] = useState(''), [steamId, setSteamId] = useState(''), [hours, setHours] = useState(4), [server, setServer] = useState('');
  const [platform, setPlatform] = useState<MonitorPlatform>('android'), [team, setTeam] = useState(''), [record, setRecord] = useState(true);
  const [dismissed, setDismissed] = useState<string[]>([]), [desktopAlerts, setDesktopAlerts] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const announced = useRef<Set<string> | null>(null);
  const [pairing, setPairing] = useState<Pairing & { playerName: string } | null>(null), [busy, setBusy] = useState(false), [openId, setOpenId] = useState(''), [filter, setFilter] = useState('');
  const monitorable = useMemo(() => matches.filter(m => gameOf(m) && m.team1 && m.team2 && !m.team1.isBye && !m.team2.isBye && m.status !== 'completed'), [matches]);
  const match = monitorable.find(m => m.id === matchId);
  const matchTeams = match ? [match.team1, match.team2].filter(t => !!t) : [];
  const players = matchTeams.filter(t => !team || t!.name === team).flatMap(t => t!.players.map(p => p.ign));
  useEffect(() => { if (!GAME_PLATFORMS[game].includes(platform)) setPlatform(GAME_PLATFORMS[game][0]); }, [game]);
  useEffect(() => { setTeam(''); }, [matchId]);
  const refresh = useCallback(() => call<SessionView[]>(`/sessions${filter ? `?matchId=${encodeURIComponent(filter)}` : ''}`).then(s => { setSessions(s); setError(''); }).catch(e => setError(e.message)), [filter]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { call<{ urls: string[]; downloads?: string[] }>('/server-info').then(info => { setUrls(info.urls); setDownloads(info.downloads || []); setServer(s => s || info.urls[0] || ''); }).catch(() => {}); }, []);
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
      const label = match ? `${match.matchNumber} · ${match.team1?.name} vs ${match.team2?.name}` : customLabel.trim();
      const result = await call<Pairing>('/pairings', { body: { matchId: match?.id || `scrim-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`, matchLabel: label, game, platform, team: team.trim(), record: platform === 'ios' ? false : record, playerName: player.trim(), expectedSteamId: game === 'dota2' ? steamId.trim() : '', hours, serverUrl: server.trim().replace(/\/$/, '') } });
      setPairing({ ...result, playerName: player.trim() }); setPlayer(''); setSteamId(''); void refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Pairing failed.'); } finally { setBusy(false); }
  };
  const serverBase = server.trim().endsWith('/') ? server.trim().slice(0, -1) : server.trim();
  const counts = { online: sessions.filter(s => ['online', 'paired'].includes(s.connection)).length, lost: sessions.filter(s => s.connection === 'lost').length, declined: sessions.filter(s => s.connection === 'declined').length, flagged: sessions.filter(s => ['review', 'urgent'].includes(s.risk.level)).length };
  const matchOptions = [...new Map(sessions.map(s => [s.matchId, s.matchLabel])).entries()];
  const arenaMatch = filter || sessions[0]?.matchId || '';
  const arenaPlayers = sessions.filter(s => s.matchId === arenaMatch);

  return <div className="module-page monitor-page">
    <header className="dashboard-page-heading"><span className="section-overline">MATCH MONITOR</span><h1>Watch the devices, not just the screen.</h1>
      <p>Pair each player's phone or PC to a match. ArenaHub checks the device around the game and flags anything a referee should look at. It cannot see inside the game and never decides a penalty by itself.</p></header>
    {error && <p className="field-error" role="alert">{error}</p>}
    {alerts.length > 0 && <section className="monitor-alerts" role="alert" aria-label="Needs your attention">
      <div className="operations-row"><strong>Needs your attention ({alerts.length})</strong>{typeof Notification !== 'undefined' && !desktopAlerts && <button type="button" className="arena-outline" onClick={() => void Notification.requestPermission().then(p => setDesktopAlerts(p === 'granted'))}>Turn on desktop alerts</button>}</div>
      <ul>{alerts.map(a => <li key={a.key}><span>{a.text}</span><span className="monitor-alert-actions"><button type="button" className="arena-outline" onClick={() => setOpenId(a.sessionId)}>Open</button><button type="button" className="arena-outline" onClick={() => setDismissed(d => [...d, a.key])}>Done</button></span></li>)}</ul>
    </section>}
    {alerts.length === 0 && typeof Notification !== 'undefined' && !desktopAlerts && <p className="field-hint"><button type="button" className="arena-outline" onClick={() => void Notification.requestPermission().then(p => setDesktopAlerts(p === 'granted'))}>Turn on desktop alerts</button> to be told when a player declines or a device goes quiet, even in another tab.</p>}
    <div className="feature-summary monitor-summary" aria-label="Monitor overview"><div><strong>{counts.online}</strong><span>Checked in</span></div><div><strong>{counts.declined}</strong><span>Declined</span></div><div><strong>{counts.lost}</strong><span>Not reporting</span></div><div><strong>{counts.flagged}</strong><span>Need a referee</span></div></div>

    <section className="operations-section">
      <div className="operations-section-heading"><QrCode size={20} /><div><h2>Pair a device</h2><p>Every player scans the code with their phone camera (PC players can type the address shown). The page that opens installs or opens the app, checks in iPhones, and lets anyone decline. Codes work once and expire in 5 minutes.</p></div></div>
      <form className="module-form monitor-pair-form" onSubmit={e => void pair(e)}>
        <label>Match<select value={matchId} onChange={e => setMatchId(e.target.value)}><option value="">Scrim or unlisted match</option>{monitorable.map(m => <option key={m.id} value={m.id}>{m.matchNumber} · {m.team1?.name} vs {m.team2?.name}</option>)}</select></label>
        {!match && <label>Match name<input required maxLength={200} value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="e.g. Practice scrim CCS vs COE" /></label>}
        <label>Game<select value={game} onChange={e => setGame(e.target.value as MonitorGame)}>{MONITOR_GAMES.map(g => <option key={g} value={g}>{GAME_LABEL[g]}</option>)}</select></label>
        <label>Device<select value={platform} onChange={e => setPlatform(e.target.value as MonitorPlatform)}>{GAME_PLATFORMS[game].map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
        <label>Team{matchTeams.length ? <select value={team} onChange={e => setTeam(e.target.value)}><option value="">Choose team</option>{matchTeams.map(t => <option key={t!.id} value={t!.name}>{t!.name}</option>)}</select> : <input maxLength={80} value={team} onChange={e => setTeam(e.target.value)} placeholder="e.g. CCS Phoenix" />}</label>
        <label>Player (IGN)<input required maxLength={80} list="monitor-players" value={player} onChange={e => setPlayer(e.target.value)} /><datalist id="monitor-players">{players.map(p => <option key={p} value={p} />)}</datalist></label>
        {game === 'dota2' && <label>Steam ID (17 digits, optional)<input inputMode="numeric" maxLength={17} value={steamId} onChange={e => setSteamId(e.target.value.replace(/\D/g, ''))} placeholder="7656119..." /></label>}
        {platform !== 'ios' && <label className="settings-toggle">{platform === 'pc' ? 'Take screenshots during the match' : 'Record the screen during the match'}<input type="checkbox" checked={record} onChange={e => setRecord(e.target.checked)} /></label>}
        {platform !== 'ios' && <p className="field-hint">{record ? 'Uses a little battery and Wi-Fi. Turn it off for casual matches; device checks still run.' : 'Only device checks run. Record from the observer slot if you need video.'}</p>}
        {platform === 'ios' && <p className="field-hint">iPhones only check in. Record this match from an observer slot in the custom room.</p>}
        <label>Monitoring window (hours)<input type="number" min={0.5} max={12} step={0.5} value={hours} onChange={e => setHours(Number(e.target.value))} /></label>
        <label>Laptop address devices will use<input required list="monitor-urls" value={server} onChange={e => setServer(e.target.value)} placeholder="http://192.168.x.x:3210" /><datalist id="monitor-urls">{urls.map(u => <option key={u} value={u} />)}</datalist></label>
        {!urls.length && <p className="field-hint">No Wi-Fi address found. Start the server in LAN mode (see docs/INTEGRITY_SETUP.md) and connect this laptop to the event Wi-Fi or hotspot.</p>}
        <div className="feature-dialog-actions"><button className="arena-primary" disabled={busy}>{busy ? 'Creating...' : 'Create pairing code'}</button></div>
      </form>
      {pairing && <div className="monitor-pairing" role="status">
        <img src={pairing.qr} alt={`Pairing QR code for ${pairing.playerName}`} width={220} height={220} />
        <div><p className="field-hint">For {pairing.playerName} · expires {time(pairing.codeExpiresAt)}</p><p className="monitor-code">{pairing.code}</p>
          {pairing.platform === 'android' ? <><p>The player scans this with the phone camera. The page that opens offers <strong>Download the app</strong> the first time and <strong>Open ArenaHub Companion</strong> after that. They agree or decline inside the app.</p>{!downloads.includes('arenahub-companion.apk') && <p className="field-error">The Android app has not been built on this laptop yet. Run npm run build:companion.</p>}</>
            : pairing.platform === 'ios' ? <p>The player scans this with the iPhone camera and chooses Agree or Decline in Safari. Nothing is installed; record the match from the observer slot.</p>
            : <><p>On the player's PC, open <code className="monitor-command">{pairing.link}</code> to download the agent, or if it is already there, run:</p><code className="monitor-command">{pairing.agentCommand}</code>{!downloads.includes('arenahub-agent.exe') && <p className="field-error">The PC agent has not been built on this laptop yet. Run npm run build:agent.</p>}</>}
        </div>
      </div>}
    </section>

    {arenaPlayers.length > 0 && <section className="operations-section">
      <div className="feature-section-bar"><div><h2>Match arena</h2><p className="field-hint">{arenaPlayers[0].matchLabel} · {arenaPlayers[0].gameLabel}</p></div></div>
      <MatchArena players={arenaPlayers} onOpen={setOpenId} />
    </section>}

    <section className="operations-section">
      <div className="feature-section-bar"><div><h2>Sessions</h2><p className="field-hint">Updates every 5 seconds from this laptop. Nothing here is stored in Firestore.</p></div>
        <div className="module-form monitor-inline"><label>Match<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All recent</option>{matchOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button type="button" className="arena-outline" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button></div></div>
      {!sessions.length ? <p className="field-hint">No sessions yet. Create a pairing code above.</p> : <ul className="monitor-sessions">{sessions.map(s => <li key={s.id} className={`monitor-session ${s.risk.level}`}>
        <div className="operations-row"><strong>{s.playerName}</strong><span className={`monitor-conn ${s.connection}`}>{CONNECTION_LABEL[s.connection]}</span></div>
        <p className="field-hint">{s.gameLabel} · {PLATFORM_LABEL[s.platform]}{s.team ? ` · ${s.team}` : ''}{s.platform !== 'ios' && !s.record ? ' · recording off' : ''} · {s.matchLabel}</p>
        <div className="monitor-session-risk"><span className={`monitor-risk ${s.risk.level}`}>{s.risk.score}</span><span>{s.risk.reasons.slice(0, 2).map(r => r.title).join(', ') || 'No concerns reported'}</span></div>
        <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setOpenId(s.id)}>{['review', 'urgent'].includes(s.risk.level) ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />} Open session</button>
      </li>)}</ul>}
    </section>
    <SettingsPanel />
    {openId && <SessionDialog id={openId} onClose={() => setOpenId('')} onChanged={() => void refresh()} />}
  </div>;
}
