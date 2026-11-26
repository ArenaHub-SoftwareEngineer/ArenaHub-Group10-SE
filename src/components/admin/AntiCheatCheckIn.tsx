// Anti-cheat check-in, step by step: choose a game, then click a match on the published bracket (the same bracket
// players see) that has both teams and has not finished.
// Opening check-in for a match gives one QR/link plus an 8-digit code that changes every 3 minutes.
// Players sign in with their ArenaHub school account; their email finds their roster seat, so nobody types names.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { antiCheatCall as call } from '../../lib/antiCheatApi';
import { errorMessage } from '../../lib/errors';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from '../../lib/fairPlayGames';
import { scheduleMatches } from '../../lib/formats/placement';
import { GAME_LABEL, GAME_PLATFORMS, PLATFORM_LABEL, type MonitorGame, type MonitorPlatform } from '../../lib/integrityRisk';
import { matchName } from '../../lib/matchName';
import { clockLabel, parseClock } from '../../lib/matchTiming';
import type { BracketDraft, Match } from '../../lib/types';
import { GameArtworkTiles } from '../common/GameArtworkTiles';
import { TournamentBracketCanvas } from '../spectator/TournamentBracketCanvas';
import { Modal } from '../ui/Modal';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Copy, Flag, Lock, Maximize2, Monitor, QrCode, RotateCcw, Smartphone, Users, Video } from '../ui/Icons';
import './roomCode.css';
import './screenWall.css';

type Result = 'passed' | 'passed-earlier' | 'flagged' | 'waiting' | 'not-reporting' | 'declined' | 'ended' | 'not-registered' | 'test-unsigned';
interface RoomPlayerView {
  slot: string; name: string; team: string; college: string; onRoster: boolean; result: Result; flags: string[];
  sessionId: string | null; email: string; emailCheck: string; platform: MonitorPlatform | null; device: string;
  joinedAt: number | null; passedAt: number | null;
  /** iPhone: when the relay first received this player's PRISM stream. Set up once, it works for every match. */
  iphoneSetupAt?: number | null;
}
interface RoomView {
  id: string; label: string; matchId: string; open: boolean; expiresAt: number;
  code: string | null; changesAt: number | null; shortUrl: string;
  /** Staff test switch: players may check in without signing in. Those check-ins never count as a pass. */
  noSignIn?: boolean;
  passed: number; total: number; players: RoomPlayerView[];
  /** The server's clock when it answered. Times are shifted to this computer's clock, which may be minutes off. */
  serverNow?: number;
}
/** Countdowns run on this computer's clock; move the server's times onto it so a wrong clock cannot skew them. */
function localTimes(room: RoomView): RoomView {
  if (!room.serverNow) return room;
  const shift = Date.now() - room.serverNow;
  return { ...room, serverNow: undefined, expiresAt: room.expiresAt + shift, changesAt: room.changesAt === null ? null : room.changesAt + shift };
}
interface CheckInMatch { id: string; title: string; when: string; live: boolean; players: number }

const RESULT: Record<Result, { label: string; tone: string }> = {
  passed: { label: 'Passed', tone: 'is-success' },
  'passed-earlier': { label: 'Passed (session ended)', tone: 'is-success' },
  flagged: { label: 'Flagged', tone: 'is-danger' },
  waiting: { label: 'Setting up', tone: 'is-info' },
  'not-reporting': { label: 'Not reporting', tone: 'is-warning' },
  declined: { label: 'Declined', tone: 'is-warning' },
  ended: { label: 'Ended without passing', tone: 'is-warning' },
  'not-registered': { label: 'Not checked in', tone: '' },
  'test-unsigned': { label: 'Test: not signed in', tone: 'is-warning' },
};
const NEEDS_A_LOOK: Result[] = ['flagged', 'not-reporting', 'declined', 'test-unsigned'];

const gameOf = (match: Match) => FAIR_PLAY_GAMES.find(game => belongsToFairPlayGame(match, game))?.id as MonitorGame | undefined;
const when = (match: Match) => {
  if (match.status === 'live') return 'Live now';
  const minutes = match.scheduledTime ? parseClock(match.scheduledTime) : null;
  const day = match.scheduledDate ? new Date(match.scheduledDate + 'T00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
  return [day, minutes === null ? '' : clockLabel(minutes)].filter(Boolean).join(', ') || 'Time not set';
};
/** Matches that have not finished: scheduled ones and live ones (players may need to reconnect mid-match). */
function openMatches(bracket: BracketDraft, game: MonitorGame): CheckInMatch[] {
  return scheduleMatches(bracket)
    .filter(match => match.status !== 'completed' && !match.inactive && /^[A-Za-z0-9_-]{1,80}$/.test(match.id) && gameOf(match) === game
      && (match.lobby || (match.team1 && match.team2 && !match.team1.isBye && !match.team2.isBye)))
    .sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || `${a.scheduledDate || '9'}${a.scheduledTime || ''}`.localeCompare(`${b.scheduledDate || '9'}${b.scheduledTime || ''}`))
    .map(match => {
      const teams = match.lobby ? match.lobby.teams || [] : [match.team1, match.team2];
      return {
        id: match.id, live: match.status === 'live', when: when(match),
        title: [matchName(match) || match.roundName, match.lobby ? `${match.lobby.squads} squads` : `${match.team1!.name} vs ${match.team2!.name}`].filter(Boolean).join(' · '),
        players: teams.reduce((sum, team) => sum + (team && !team.isBye ? team.players?.length || 0 : 0), 0),
      };
    });
}

const time = (at: number | null) => at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
const spaced = (code: string) => code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
function checkInLink(room: RoomView, device?: MonitorPlatform) {
  const url = new URL('/player-check-in', location.origin);
  url.searchParams.set('room', room.id);
  if (device) url.searchParams.set('device', device);
  return url.href;
}
/** One QR per device, because each device has its own setup: the Android app, the iPhone PRISM steps, the PC agent. */
const DEVICE_QRS: { id: MonitorPlatform; label: string; setup: string; Icon: typeof Smartphone }[] = [
  { id: 'android', label: 'Android', setup: 'Anti-cheat app, then share screen', Icon: Smartphone },
  { id: 'ios', label: 'iPhone', setup: 'Share screen with the PRISM app', Icon: Smartphone },
  { id: 'pc', label: 'Windows PC', setup: 'Share screen, then the PC scan', Icon: Monitor },
];
function DeviceQr({ room, device, game, size }: { room: RoomView; device: typeof DEVICE_QRS[number]; game?: MonitorGame; size: number }) {
  const used = !game || GAME_PLATFORMS[game].includes(device.id);
  const qr = useQr(used ? checkInLink(room, device.id) : '', size * 2);
  return <figure className={`ac-device-qr${used ? '' : ' is-unused'}`}>
    <figcaption><device.Icon size={16} aria-hidden="true" /><strong>{device.label}</strong></figcaption>
    {used ? (qr ? <img src={qr} alt={`${device.label} check-in QR`} width={size} height={size} /> : <span className="ac-qr-placeholder" style={{ width: size, height: size }} />)
      : <span className="ac-qr-unused" style={{ width: size, height: size }}>Not used for {GAME_LABEL[game!]}</span>}
    <small>{used ? device.setup : ''}</small>
  </figure>;
}
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}
const left = (until: number | null, now: number) => {
  const ms = Math.max(0, (until || 0) - now), minutes = Math.floor(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
};

function useQr(text: string, width: number) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    setQr('');
    if (!text) return;
    let live = true;
    void import('qrcode').then(QR => QR.toDataURL(text, { margin: 4, width })).then(url => { if (live) setQr(url); }).catch(() => undefined);
    return () => { live = false; };
  }, [text, width]);
  return qr;
}

/** The big code with a ring that empties until the code changes. */
function RotatingCode({ room, now, large = false, onNewCode, busy = false }: { room: RoomView; now: number; large?: boolean; onNewCode?: () => void; busy?: boolean }) {
  const windowMs = 3 * 60_000, remaining = Math.max(0, (room.changesAt || 0) - now);
  const share = Math.min(1, remaining / windowMs);
  return <div className={`ac-code${large ? ' is-large' : ''}`}>
    <span className="ac-code-label">Check-in code</span>
    <strong className="ac-code-digits" aria-live="polite">{room.code ? spaced(room.code) : '-'}</strong>
    <span className="ac-code-timer">
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" className="ac-ring-track" /><circle cx="18" cy="18" r="15" className="ac-ring" style={{ strokeDasharray: `${share * 94.25} 94.25` }} /></svg>
      New code in {left(room.changesAt, now)}
    </span>
    {onNewCode && <button type="button" className="ac-code-new" disabled={busy} onClick={onNewCode}><RotateCcw size={14} aria-hidden="true" />New code now</button>}
  </div>;
}

function MatchCheckIn({ match, game, room, onReport, onWatch, onChanged }: { match: CheckInMatch; game?: MonitorGame; room: RoomView | undefined; onReport: (id: string) => void; onWatch: (matchId: string) => void; onChanged: (room?: RoomView) => unknown }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false), [projector, setProjector] = useState(false);
  const [filter, setFilter] = useState<'all' | 'passed' | 'attention'>('all');
  const [noSignIn, setNoSignIn] = useState(false);
  const now = useNow();
  const link = room?.open ? checkInLink(room) : '';
  const localOnly = Boolean(link && /^(localhost|127\..*|\[::1\])$/i.test(location.hostname));

  // Fetch the new code as soon as the old one runs out, instead of waiting for the next poll.
  useEffect(() => {
    if (!room?.open || !room.changesAt) return;
    const timer = setTimeout(() => onChanged(), Math.max(500, room.changesAt - Date.now() + 400));
    return () => clearTimeout(timer);
  }, [room?.open, room?.changesAt, onChanged]);

  const open = async () => {
    if (noSignIn && !window.confirm('Open a TEST check-in without sign-in? Anyone in the room with the code can check in as a roster player who has no school email on file. Their scans show as "Test: not signed in" and never count as a pass. Use this only for practice.')) return;
    setBusy(true); setError('');
    try { onChanged(await call<RoomView>('/rooms', { body: { matchId: match.id, verifiedCheckIn: true, hours: 12, ...(noSignIn ? { noSignIn: true } : {}) } })); setNoSignIn(false); }
    catch (err) { setError(errorMessage(err, 'Check-in could not be opened for this match.')); }
    finally { setBusy(false); }
  };
  const act = async (path: string, body: Record<string, unknown>, confirmText = '') => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError('');
    try { onChanged(await call<RoomView>(path, { body })); } catch (err) { setError(errorMessage(err, 'That did not work.')); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setError('Copy failed. Open the link and copy it from the address bar.'); }
  };

  const players = useMemo(() => (room?.players || []).filter(p => filter === 'all' ? true : filter === 'passed' ? p.result === 'passed' || p.result === 'passed-earlier' : p.flags.length > 0 || NEEDS_A_LOOK.includes(p.result)), [room, filter]);
  const attention = (room?.players || []).filter(p => p.flags.length > 0 || NEEDS_A_LOOK.includes(p.result)).length;

  return <div className="ac-checkin">
    {match.live && <p className="module-notice" role="status"><strong>This match is live.</strong> Check-in stays open so a player who dropped can set up again.</p>}
    {!room?.open ? <div className="ac-start">
      <div>
        <h3>Open check-in for this match</h3>
        <ol className="ac-how">
          <li>Players scan the QR for their device (Android, iPhone or PC) or open the link, then sign in with their ArenaHub account.</li>
          <li>They type the 8-digit code you show. It changes every 3 minutes, so only people in the room can use it.</li>
          <li>Their school email picks their name from the roster. Then they set up their device (iPhone players use PRISM).</li>
        </ol>
        <label className="settings-toggle ac-test-toggle"><span><strong>Test check-in: no sign-in</strong>
          <small>For practice only. Players skip signing in and pick a roster name that has no school email. Their scans never count as a pass.</small></span>
          <input type="checkbox" checked={noSignIn} disabled={busy} onChange={event => setNoSignIn(event.target.checked)} /></label>
      </div>
      <button type="button" className="arena-primary" disabled={busy} onClick={() => void open()}>
        <QrCode size={16} aria-hidden="true" /> {busy ? 'Opening…' : room ? 'Open check-in again' : 'Open check-in'}
      </button>
    </div> : <>{room.noSignIn && <p className="module-error ac-test-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /> <strong>Test check-in: sign-in is off.</strong> Anyone with the code can check in as a roster player who has no school email. These scans never count as a pass. Close check-in when you finish testing.</p>}<div className="ac-live">
      <div className="ac-device-qrs">{DEVICE_QRS.map(device => <DeviceQr key={device.id} room={room} device={device} game={game} size={132} />)}</div>
      <RotatingCode room={room} now={now} busy={busy} onNewCode={() => void act(`/rooms/${room.id}/new-code`, {})} />
      <div className="ac-live-side">
        <button type="button" className="arena-primary ac-watch" onClick={() => onWatch(match.id)}><Video size={16} aria-hidden="true" />Watch player screens</button>
        <a className="room-address" href={link} target="_blank" rel="noreferrer">Open check-in link</a>
        {room.shortUrl && <p className="field-hint">Or players go to <strong>{room.shortUrl}</strong> and type the code.</p>}
        {localOnly && <p className="field-hint">This is a localhost link. Players on other devices need ArenaHub's HTTPS address.</p>}
        <span className="room-countdown"><Clock size={14} aria-hidden="true" />Check-in closes in {left(room.expiresAt, now)}</span>
        <div className="room-code-actions">
          <button type="button" className="arena-outline" onClick={() => setProjector(true)}><Maximize2 size={15} aria-hidden="true" />Show on screen</button>
          <button type="button" className="arena-outline" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />{copied ? 'Copied' : 'Copy link'}</button>
          <button type="button" className="arena-outline" disabled={busy} onClick={() => void act(`/rooms/${room.id}/close`, {}, 'Close check-in for this match? Players already checked in keep their scans.')}><Lock size={15} aria-hidden="true" />Close check-in</button>
        </div>
      </div>
    </div></>}
    {error && <p className="field-error" role="alert">{error}</p>}

    {room && <div className="room-roster">
      <div className="feature-section-bar"><div><h3><Users size={17} aria-hidden="true" /> Players</h3>
        <p className="field-hint"><strong>{room.passed} of {room.total}</strong> passed{attention ? ` · ${attention} need a look` : ''}. A pass is kept with its time as proof.</p></div>
        <div className="ah-chips" role="group" aria-label="Show">
          <button type="button" className="ah-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button type="button" className="ah-chip" aria-pressed={filter === 'passed'} onClick={() => setFilter('passed')}>Passed</button>
          <button type="button" className="ah-chip" aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Needs a look</button>
        </div></div>
      {players.length ? <ul className="room-players">
        {players.map(p => <li key={p.slot} className="room-player">
          <div className="room-player-main">
            <strong>{p.name}</strong>
            <span className="field-hint">{[p.team, p.college].filter(Boolean).join(' · ')}</span>
            {p.email && <span className={`room-email${p.emailCheck === 'match' ? ' is-match' : ''}`}>{p.emailCheck === 'match' && <CheckCircle2 size={14} aria-label="Roster email matched" />}{p.email}</span>}
          </div>
          <div className="room-player-scan">
            <span className={`status-pill ${RESULT[p.result].tone}`}>{RESULT[p.result].label}</span>
            {p.platform === 'ios' && <span className={`status-pill ${p.iphoneSetupAt ? 'is-success' : ''}`}
              title={p.iphoneSetupAt ? `PRISM stream first received ${new Date(p.iphoneSetupAt).toLocaleString()}` : 'The relay has not received this player’s PRISM stream yet'}>
              {p.iphoneSetupAt ? <><CheckCircle2 size={13} aria-hidden="true" />iPhone set up</> : 'iPhone not set up yet'}</span>}
            <span className="field-hint">{p.passedAt ? `Passed ${time(p.passedAt)}` : p.joinedAt ? `Checked in ${time(p.joinedAt)}` : ''}{p.platform ? ` · ${PLATFORM_LABEL[p.platform]}${p.device ? ` (${p.device})` : ''}` : ''}</span>
          </div>
          {p.flags.length > 0 && <ul className="room-flags">{p.flags.map(flag => <li key={flag}><AlertTriangle size={13} aria-hidden="true" />{flag}</li>)}</ul>}
          {p.sessionId && <div className="room-player-actions">
            <button type="button" className="arena-outline" onClick={() => onReport(p.sessionId!)}><Flag size={14} aria-hidden="true" />Report</button>
          </div>}
        </li>)}
      </ul> : <p className="field-hint">{filter === 'passed' ? 'Nobody has passed yet.' : filter === 'attention' ? 'Nothing needs a look.' : 'No players yet.'}</p>}
    </div>}

    {projector && room?.open && <Modal open title={match.title} description={room.noSignIn ? 'Test check-in: scan the QR for your device, then type the code.' : 'Scan the QR for your device, sign in, then type the code.'} icon={<QrCode size={20} />} onClose={() => setProjector(false)} className="room-projector ac-projector">
      <div className="room-projector-body">
        <div className="ac-device-qrs is-large">{DEVICE_QRS.map(device => <DeviceQr key={device.id} room={room} device={device} game={game} size={240} />)}</div>
        <RotatingCode room={room} now={now} large />
        {room.shortUrl && <p className="ac-projector-address">No camera? Go to <strong>{room.shortUrl}</strong></p>}
      </div>
    </Modal>}
  </div>;
}

export function AntiCheatCheckIn({ brackets, onReport, onWatch }: { brackets: BracketDraft[]; onReport: (id: string) => void; onWatch: (matchId: string) => void }) {
  const [game, setGame] = useState<MonitorGame | ''>('');
  const [bracketId, setBracketId] = useState('');
  const [matchId, setMatchId] = useState('');
  const [rooms, setRooms] = useState<RoomView[] | null>(null), [error, setError] = useState('');

  const load = useCallback((fresh?: RoomView) => {
    if (fresh) setRooms(list => [localTimes(fresh), ...(list || []).filter(room => room.id !== fresh.id)]);
    return call<RoomView[]>('/rooms?verified=1').then(list => { setRooms(list.map(localTimes)); setError(''); })
      .catch(err => setError(errorMessage(err, 'Check-ins could not be loaded.')));
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); }, [load]);

  // The open check-in for each match (or the latest closed one, so its results stay visible).
  const roomFor = useMemo(() => {
    const map = new Map<string, RoomView>();
    for (const room of rooms || []) if (room.matchId && (!map.has(room.matchId) || (room.open && !map.get(room.matchId)!.open))) map.set(room.matchId, room);
    return map;
  }, [rooms]);

  const byGame = useMemo(() => Object.fromEntries((Object.keys(GAME_LABEL) as MonitorGame[]).map(id => [id,
    brackets.map(bracket => ({ bracket, matches: openMatches(bracket, id) })).filter(entry => entry.matches.length)])) as Record<MonitorGame, { bracket: BracketDraft; matches: CheckInMatch[] }[]>, [brackets]);
  const gameMeta = Object.fromEntries((Object.keys(GAME_LABEL) as MonitorGame[]).map(id => {
    const openCount = byGame[id].reduce((sum, entry) => sum + entry.matches.filter(match => roomFor.get(match.id)?.open).length, 0);
    return [id, openCount ? `${openCount} check-in${openCount === 1 ? '' : 's'} open` : byGame[id].length ? `${byGame[id].length} bracket${byGame[id].length === 1 ? '' : 's'}` : 'No matches to play'];
  }));

  const entries = game ? byGame[game] : [];
  // A game normally has one published bracket, so it opens straight away; with several, staff pick one first.
  const entry = entries.find(item => item.bracket.id === bracketId) || (entries.length === 1 ? entries[0] : undefined);
  const match = entry?.matches.find(item => item.id === matchId);
  const step = !game ? 1 : !match ? 2 : 3;
  const back = () => step === 3 ? setMatchId('') : entry && entries.length > 1 && bracketId ? setBracketId('') : setGame('');
  const rounds = useMemo(() => {
    if (!entry || entry.bracket.placement) return [];
    const list: Match[][] = [];
    const last = Math.max(1, ...entry.bracket.matches.map(item => item.round));
    for (let round = 1; round <= last; round++) list.push(entry.bracket.matches.filter(item => item.round === round));
    return list;
  }, [entry]);
  const pickable = useMemo(() => new Set(entry?.matches.map(item => item.id)), [entry]);

  return <section className="operations-section ac-section" aria-labelledby="ac-checkin-heading">
    <div className="operations-section-heading"><QrCode size={20} /><div><h2 id="ac-checkin-heading">Player check-in</h2>
      <p>Choose a game, then click a match on its bracket. Show the QR and code so players can set up anti-cheat.</p></div></div>
    <ol className="lw-steps" aria-label="Steps">
      {['Game', 'Bracket', 'Check-in'].map((label, i) =>
        <li key={label} className={step === i + 1 ? 'is-current' : step > i + 1 ? 'is-done' : ''} aria-current={step === i + 1 ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}
    </ol>
    {error && <p className="field-error" role="alert">{error}</p>}

    {step === 1 && <GameArtworkTiles label="Choose a game" onSelect={id => { setGame(id as MonitorGame); setBracketId(''); setMatchId(''); }} meta={gameMeta} compact />}

    {step > 1 && <div className="lw-picked">
      <button type="button" className="arena-outline" onClick={back}><ArrowLeft size={16} aria-hidden="true" />Back</button>
      <nav className="ac-crumbs" aria-label="Selected">
        <button type="button" onClick={() => { setBracketId(''); setMatchId(''); }}>{GAME_LABEL[game as MonitorGame]}</button>
        {entry && <><span aria-hidden="true">/</span><button type="button" onClick={() => setMatchId('')}>{entry.bracket.title}</button></>}
        {match && <><span aria-hidden="true">/</span><strong>{match.title}</strong></>}
      </nav>
    </div>}

    {step === 2 && !entry && (entries.length ? <ul className="lw-matches" aria-label="Brackets">{entries.map(({ bracket, matches }) => {
      const live = matches.filter(item => item.live).length, openCount = matches.filter(item => roomFor.get(item.id)?.open).length;
      return <li key={bracket.id}><button type="button" className="lw-match" onClick={() => setBracketId(bracket.id)}>
        <span className="lw-match-main"><strong>{bracket.title}</strong><small>{bracket.format}</small></span>
        <span className="lw-match-meta">
          <span className="status-pill">{matches.length} match{matches.length === 1 ? '' : 'es'} to play</span>
          {live > 0 && <span className="status-pill is-danger">{live} live</span>}
          {openCount > 0 && <span className="status-pill is-success">{openCount} check-in{openCount === 1 ? '' : 's'} open</span>}
        </span>
      </button></li>;
    })}</ul> : <p className="lw-empty">No {GAME_LABEL[game as MonitorGame]} bracket has matches left to play. Publish a bracket first.</p>)}

    {step === 2 && entry && <>
      {rounds.length > 0 && <div className="viewer-bracket-board ac-bracket-board">
        <TournamentBracketCanvas key={entry.bracket.id} rounds={rounds} appearance={entry.bracket.appearance}
          pick={{ canPick: item => pickable.has(item.id), badge: item => roomFor.get(item.id)?.open ? 'Check-in open' : undefined }}
          onSelectMatch={item => setMatchId(item.id)} />
      </div>}
      <h3 className="ac-list-heading">{entry.bracket.placement ? 'Lobby games' : 'Matches ready for check-in'}</h3>
      <ul className="lw-matches" aria-label={`${entry.bracket.title} matches`}>{entry.matches.map(item => {
        const room = roomFor.get(item.id);
        return <li key={item.id}><button type="button" className="lw-match" onClick={() => setMatchId(item.id)}>
          <span className="lw-match-main"><strong>{item.title}</strong><small className={item.live ? 'is-live' : ''}>{item.when}</small></span>
          <span className="lw-match-meta">
            {room?.open ? <span className="status-pill is-success">Check-in open · {room.passed} of {room.total} passed</span> : <span className="status-pill">{item.players} players</span>}
          </span>
        </button></li>;
      })}</ul>
    </>}

    {step === 3 && match && (rooms === null ? <p role="status" className="field-hint">Loading…</p>
      : <MatchCheckIn key={match.id} match={match} game={game || undefined} room={roomFor.get(match.id)} onReport={onReport} onWatch={onWatch} onChanged={load} />)}
  </section>;
}
