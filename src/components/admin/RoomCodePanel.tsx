import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PLATFORM_LABEL, type MonitorPlatform } from '../../lib/integrityRisk';
import { antiCheatCall as call } from '../../lib/antiCheatApi';
import { apiUrl } from '../../lib/apiBase';
import { errorMessage } from '../../lib/errors';
import { Modal } from '../ui/Modal';
import { AlertTriangle, CheckCircle2, Clock, Copy, Lock, Maximize2, QrCode, RotateCcw, Users } from '../ui/Icons';
import './roomCode.css';

type Result = 'passed' | 'passed-earlier' | 'flagged' | 'waiting' | 'not-reporting' | 'declined' | 'ended' | 'not-registered';
interface RoomPlayerView {
  slot: string; name: string; team: string; college: string; onRoster: boolean; result: Result; flags: string[];
  resets: { at: number; by: string }[]; sessionId: string | null; email: string; emailCheck: string; platform: MonitorPlatform | null; device: string;
  joinedAt: number | null; passedAt: number | null; gameLabel: string;
}
interface RoomView {
  id: string; expiresAt: number; open: boolean;
  joinUrl: string; passed: number; total: number; players: RoomPlayerView[];
}

const RESULT: Record<Result, { label: string; tone: string }> = {
  passed: { label: 'Passed', tone: 'is-success' },
  'passed-earlier': { label: 'Passed (session ended)', tone: 'is-success' },
  flagged: { label: 'Flagged', tone: 'is-danger' },
  waiting: { label: 'Waiting', tone: 'is-info' },
  'not-reporting': { label: 'Not reporting', tone: 'is-warning' },
  declined: { label: 'Declined', tone: 'is-warning' },
  ended: { label: 'Ended without passing', tone: 'is-warning' },
  'not-registered': { label: 'Not registered', tone: '' },
};
const time = (at: number | null) => at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
function playerUrl(room: RoomView | null) {
  if (!room?.open) return '';
  const origin = location.origin;
  const scan = new URL(room.joinUrl, origin);
  const url = new URL('/player-check-in', scan.protocol === 'https:' ? scan.origin : origin);
  url.searchParams.set('room', room.id);
  return url.href;
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const left = Math.max(0, (until || 0) - now);
  const minutes = Math.floor(left / 60_000);
  return { text: minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` };
}

export function RoomCodePanel({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [room, setRoom] = useState<RoomView | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<'all' | 'passed' | 'attention'>('all'), [projector, setProjector] = useState(false), [qr, setQr] = useState(''), [copied, setCopied] = useState(false);
  const checkInUrl = playerUrl(room);
  const localOnly = Boolean(checkInUrl && /^(localhost|127\..*|\[::1\])$/i.test(new URL(checkInUrl).hostname));

  const load = useCallback(() => call<RoomView[]>('/rooms?verified=1')
    .then(list => {
      setRoom(list.find(item => item.open) ?? list[0] ?? null);
      setLoaded(true);
    })
    .catch(e => setError(errorMessage(e, 'Player check-in could not be loaded.'))), []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); }, [load]);
  useEffect(() => {
    setQr('');
    if (!checkInUrl) return;
    let live = true;
    void import('qrcode').then(QR => QR.toDataURL(checkInUrl, { margin: 4, width: 320 }))
      .then(url => { if (live) setQr(url); })
      .catch(() => { if (live) setError('The QR image could not be generated. Share the link instead.'); });
    return () => { live = false; };
  }, [checkInUrl]);

  const open = async () => {
    setBusy(true); setError('');
    try {
      const created = await call<RoomView>('/rooms', { body: { label: 'Player check-in', verifiedCheckIn: true, hours: 12 } });
      setRoom(created);
    } catch (err) { setError(errorMessage(err, 'The check-in QR could not be opened.')); } finally { setBusy(false); }
  };
  const act = async (path: string, body: Record<string, unknown>, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true); setError('');
    try { setRoom(await call<RoomView>(path, { body })); } catch (err) { setError(errorMessage(err, 'That did not work.')); } finally { setBusy(false); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setError('Copy failed. Open the link to copy it from your browser.'); }
  };

  const players = useMemo(() => (room?.players || []).filter(p => filter === 'all' ? true : filter === 'passed' ? p.result === 'passed' || p.result === 'passed-earlier' : p.flags.length > 0 || ['flagged', 'not-reporting', 'declined', 'not-registered'].includes(p.result)), [room, filter]);
  const attention = (room?.players || []).filter(p => p.flags.length > 0 || ['flagged', 'not-reporting', 'declined'].includes(p.result)).length;
  const countdown = useCountdown(room?.expiresAt || null);

  return <section className="operations-section room-panel" aria-labelledby="room-heading">
    <div className="operations-section-heading"><QrCode size={20} /><div><h2 id="room-heading">Player check-in</h2>
      <p>Share one link for all games. Players sign in with their school account and start a scan.</p></div></div>
    {!room?.open && <div className="page-actions">
      <button type="button" className="arena-primary" disabled={busy || !loaded} onClick={() => void open()}>
        <QrCode size={16} aria-hidden="true" /> {busy ? 'Generating…' : 'Generate check-in QR'}
      </button>
    </div>}

    {room?.open && <div className="room-live">
      {qr && <img src={qr} alt="Player check-in QR" width={160} height={160} />}
      <div className="room-join-card">
        <span className="room-countdown"><Clock size={14} aria-hidden="true" />Expires in {countdown.text}</span>
        <a className="room-address" href={checkInUrl} target="_blank" rel="noreferrer">Open check-in link</a>
        {localOnly && <p className="field-hint">This localhost link opens on this computer. Use ArenaHub’s HTTPS address for players on other devices.</p>}
        <div className="room-code-actions">
          <button type="button" className="arena-outline" onClick={() => void copy(checkInUrl)}><Copy size={14} aria-hidden="true" />{copied ? 'Copied' : 'Copy link'}</button>
          <button type="button" className="arena-outline" disabled={!qr} onClick={() => setProjector(true)}><Maximize2 size={15} aria-hidden="true" />Show on screen</button>
          <button type="button" className="arena-outline" disabled={busy} onClick={() => void act(`/rooms/${room.id}/close`, {}, 'Close check-in to new players? Scans in progress can continue.')}><Lock size={15} aria-hidden="true" />Close check-in</button>
        </div>
      </div>
    </div>}
    {error && <p className="field-error" role="alert">{error}</p>}

    {room && <div className="room-roster">
      <div className="feature-section-bar"><div><h3><Users size={17} aria-hidden="true" /> Scanned players</h3>
        <p className="field-hint"><strong>{room.passed} of {room.total}</strong> passed{attention ? ` · ${attention} need a look` : ''}. A pass is kept with its time as proof, even after the scan goes stale.</p></div>
        <div className="ah-chips" role="group" aria-label="Show">
          <button type="button" className="ah-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button type="button" className="ah-chip" aria-pressed={filter === 'passed'} onClick={() => setFilter('passed')}>Passed only</button>
          <button type="button" className="ah-chip" aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Needs a look</button>
        </div></div>
      {players.length ? <ul className="room-players">
        {players.map(p => <li key={p.slot} className="room-player">
          <div className="room-player-main">
            <strong>{p.name}</strong>
            <span className="field-hint">{[p.gameLabel, p.team, p.college].filter(Boolean).join(' · ')}</span>
            {p.emailCheck === 'verified' && <span className="room-email is-match"><CheckCircle2 size={14} aria-label="Verified school email" />{p.email}</span>}
          </div>
          <div className="room-player-scan">
            <span className={`status-pill ${RESULT[p.result].tone}`}>{RESULT[p.result].label}</span>
            <span className="field-hint">{p.passedAt ? `Passed ${time(p.passedAt)}` : p.joinedAt ? `Joined ${time(p.joinedAt)}` : ''}{p.platform ? ` · ${PLATFORM_LABEL[p.platform]}${p.device ? ` (${p.device})` : ''}` : ''}</span>
          </div>
          {p.flags.length > 0 && <ul className="room-flags">{p.flags.map(flag => <li key={flag}><AlertTriangle size={13} aria-hidden="true" />{flag}</li>)}</ul>}
          <div className="room-player-actions">
            {p.sessionId && <button type="button" className="arena-outline" onClick={() => onOpenSession(p.sessionId!)}>Open</button>}
            {p.sessionId && room.open && <button type="button" className="arena-outline" disabled={busy} onClick={() => void act(`/rooms/${room.id}/reset`, { slot: p.slot }, `Reset ${p.name}? Their current scan ends and they can join again. The reset stays on record.`)}><RotateCcw size={14} aria-hidden="true" />Reset</button>}
          </div>
        </li>)}
      </ul> : <p className="field-hint">{filter === 'passed' ? 'Nobody has passed yet.' : filter === 'attention' ? 'Nothing needs a look.' : 'No players have checked in yet.'}</p>}
    </div>}
    {projector && room?.open && qr && <Modal open title="Player check-in QR" description="Open this link on the device you play on." icon={<QrCode size={20} />} onClose={() => setProjector(false)} className="room-projector">
      <div className="room-projector-body">
        <img src={qr} alt="Player check-in QR" width={320} height={320} />
        <span className="room-countdown"><Clock size={16} aria-hidden="true" />Expires in {countdown.text}</span>
        <a className="room-address" href={checkInUrl} target="_blank" rel="noreferrer">Open check-in link</a>
      </div>
    </Modal>}
  </section>;
}
