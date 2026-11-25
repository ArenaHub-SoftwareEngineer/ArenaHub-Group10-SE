// The live wall: a full-screen call view of every player's screen, grouped by team, sized so everyone fits on one screen.
// Click a screen to spotlight it (big stage plus a strip of the others), or open one screen full screen.
// Full screen works on iPhone too: Safari cannot full-screen a page element, so the wall itself fills the viewport.
// LiveKit's adaptive stream sends each tile only the quality its size needs, and pauses tiles nobody can see.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LiveKitRoom, VideoTrack, useConnectionQualityIndicator, useConnectionState, useParticipants, useRoomInfo, useTracks, type TrackReference } from '@livekit/components-react';
import { ConnectionQuality, ConnectionState, Track, type Participant } from 'livekit-client';
import { antiCheatCall } from '../../lib/antiCheatApi';
import { errorMessage } from '../../lib/errors';
import { firestoreService } from '../../lib/firestore';
import { playWhep } from '../../lib/whep';
import type { Match } from '../../lib/types';
import type { MonitorGame } from '../../lib/integrityRisk';
import { Modal } from '../ui/Modal';
import { Grid, Maximize2, Minimize2, MonitorOff, MonitorUp, Pause, Play, ShieldAlert, Users, Video, X } from '../ui/Icons';

export interface WallSeat { name: string; team: string }
export interface WallMatch {
  key: string; matchId?: string; game: MonitorGame | null; title: string; when: string; live: boolean;
  status?: Match['status']; hasBroadcast?: boolean; seats: WallSeat[]; order: string;
}
interface RoomState { paused: boolean; by?: string; at?: number; note?: string }
/** An iPhone screen arrives from the relay (MediaMTX) instead of LiveKit, because Safari cannot share the screen. */
interface RelayFeed { url: string; auth: React.MutableRefObject<{ user: string; pass: string }> }
interface RelayStream { path: string; sessionId: string; name: string; team: string }
interface Tile { id: string; name: string; team: string; color: string; sessionId?: string; participant?: Participant; track?: TrackReference; relay?: RelayFeed }
interface Team { name: string; color: string; tiles: Tile[] }

const PLATFORM: Record<string, string> = { android: 'Android', pc: 'PC', ios: 'iPhone' };
// Team colours: the first two read apart at a glance (blue side, orange side); more squads take the rest.
const TEAM_COLORS = ['#4f8cff', '#ff8a3d', '#3ccf91', '#c77dff', '#ffd23f', '#ff5d8f', '#2ec4d6', '#a3b18a'];
const GAP = 8, TEAM_LABEL = 28, RATIO = 16 / 9;

// Two letters: the first letters of two words, or the first two letters of a one-word in-game name ("CNGold1" is "CN").
const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
};
const parseState = (metadata?: string): RoomState => { try { const value = JSON.parse(metadata || '{}'); return value?.paused === true ? value : { paused: false }; } catch { return { paused: false }; } };

/** The widest 16:9 tile that lets `count` tiles fit in a width x height box. */
function fitTile(width: number, height: number, count: number) {
  if (count < 1 || width <= 0 || height <= 0) return 0;
  let best = 0;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    best = Math.max(best, Math.min((width - (cols - 1) * GAP) / cols, ((height - (rows - 1) * GAP) / rows) * RATIO));
  }
  return Math.floor(best);
}
/** Teams side by side or stacked, whichever gives bigger screens. Every tile on the wall gets the same size. */
export function wallLayout(width: number, height: number, counts: number[], labelled = true) {
  const teams = counts.filter(count => count > 0);
  if (!teams.length) return { direction: 'row' as const, tile: 0 };
  const label = labelled ? TEAM_LABEL : 0;
  const k = teams.length, total = teams.reduce((sum, n) => sum + n, 0);
  // Side by side: each team's share of the width follows its size, so a 5 v 5 splits evenly.
  const usableW = width - (k - 1) * GAP * 2;
  const side = Math.min(...teams.map(n => fitTile(usableW * n / total, height - label, n)));
  const stackH = (height - (k - 1) * GAP * 2) / k - label;
  const stacked = Math.min(...teams.map(n => fitTile(width, stackH, n)));
  return side >= stacked ? { direction: 'row' as const, tile: side } : { direction: 'column' as const, tile: stacked };
}

function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize(current => {
      const width = Math.floor(element.clientWidth), height = Math.floor(element.clientHeight);
      return current.width === width && current.height === height ? current : { width, height };
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });
  return [ref, size] as const;
}
function useFullscreenElement() {
  const [element, setElement] = useState<Element | null>(null);
  useEffect(() => {
    const sync = () => setElement(document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return element;
}
// The wall covers the page while it is open, so the page underneath must not scroll on phones.
function useScrollLock() {
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);
}

function Signal({ participant }: { participant: Participant }) {
  const { quality } = useConnectionQualityIndicator({ participant });
  if (quality !== ConnectionQuality.Poor && quality !== ConnectionQuality.Lost) return null;
  return <span className="lw-weak">{quality === ConnectionQuality.Lost ? 'Connection lost' : 'Weak connection'}</span>;
}

type RelayState = 'connecting' | 'live' | 'retrying';
/**
 * One relay connection per iPhone, shared by every tile that shows it. Spotlight and full screen remount the tile;
 * without sharing, each remount would start a new connection and show black until the next key frame.
 */
interface SharedRelay { users: number; state: RelayState; stream?: MediaStream; close?: () => void; busy: boolean; retry?: number; idle?: number; listeners: Set<() => void> }
const relayConnections = new WeakMap<RelayFeed, SharedRelay>();
function relayConnection(feed: RelayFeed) {
  let entry = relayConnections.get(feed);
  if (entry) return entry;
  const shared: SharedRelay = { users: 0, state: 'connecting', busy: false, listeners: new Set() };
  relayConnections.set(feed, shared);
  const set = (state: RelayState) => { shared.state = state; shared.listeners.forEach(listener => listener()); };
  const fail = () => {
    shared.stream = undefined; shared.close = undefined;
    if (!shared.users) return;
    set('retrying');
    shared.retry = window.setTimeout(() => { shared.retry = undefined; start(); }, 3000);
  };
  function start() {
    if (shared.busy || shared.stream || shared.retry !== undefined) return;
    shared.busy = true;
    const { user, pass } = feed.auth.current;
    playWhep(feed.url, user, pass, fail)
      .then(session => {
        shared.busy = false;
        if (!shared.users) { session.close(); return; }
        shared.stream = session.stream; shared.close = session.close;
        set('live');
      })
      .catch(() => { shared.busy = false; fail(); });
  }
  entry = Object.assign(shared, {
    acquire(listener: () => void) {
      shared.users++; shared.listeners.add(listener);
      window.clearTimeout(shared.idle);
      start();
      return () => {
        shared.users--; shared.listeners.delete(listener);
        // Wait a moment: a remounting tile picks the same connection up again.
        if (!shared.users) shared.idle = window.setTimeout(() => {
          if (shared.users) return;
          window.clearTimeout(shared.retry); shared.retry = undefined;
          shared.close?.(); shared.stream = undefined; shared.close = undefined; shared.state = 'connecting';
        }, 3000);
      };
    },
  });
  return entry;
}

/** One iPhone screen from the relay. It reconnects by itself if the phone's connection drops for a moment. */
function RelayVideo({ feed, label }: { feed: RelayFeed; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<RelayState>('connecting');
  useEffect(() => {
    const connection = relayConnection(feed) as SharedRelay & { acquire: (listener: () => void) => () => void };
    const sync = () => {
      setState(connection.state);
      if (video.current && video.current.srcObject !== (connection.stream || null)) video.current.srcObject = connection.stream || null;
    };
    const release = connection.acquire(sync);
    sync();
    return release;
  }, [feed]);
  return <>
    <video ref={video} className="lw-video" autoPlay muted playsInline aria-label={label} />
    {state !== 'live' && <span className="lw-weak">{state === 'connecting' ? 'Connecting to iPhone…' : 'Reconnecting to iPhone…'}</span>}
  </>;
}

/** iPhone screens that are live in this match. Polled, because the relay has no push channel to the wall. */
function useRelayStreams(key: string) {
  const [streams, setStreams] = useState<RelayStream[]>([]);
  const [web, setWeb] = useState('');
  // Passes are renewed on every poll, but a playing stream keeps its connection, so they live in a ref.
  const auth = useRef({ user: '', pass: '' });
  useEffect(() => {
    let live = true, timer: number | undefined;
    const poll = () => {
      antiCheatCall<{ configured: boolean; web?: string; user?: string; pass?: string; streams: RelayStream[] }>(`/screenwall/${key}/relay`)
        .then(body => {
          if (!live || !body.configured) return;
          auth.current = { user: body.user || '', pass: body.pass || '' };
          setWeb(body.web || '');
          setStreams(current => {
            const next = body.streams || [];
            return current.length === next.length && current.every((item, index) => item.path === next[index].path && item.name === next[index].name) ? current : next;
          });
          timer = window.setTimeout(poll, 5000);
        })
        .catch(() => { if (live) timer = window.setTimeout(poll, 8000); });
    };
    poll();
    return () => { live = false; window.clearTimeout(timer); };
  }, [key]);
  // One feed object per stream, so a tile reconnects only when its stream really changes.
  const feeds = useRef(new Map<string, RelayFeed>());
  return useMemo(() => streams.map(stream => {
    const url = `${web}/${stream.path}/whep`;
    let feed = feeds.current.get(url);
    if (!feed) { feed = { url, auth }; feeds.current.set(url, feed); }
    return { ...stream, feed };
  }), [streams, web]);
}

interface TileProps {
  tile: Tile; spotlight: boolean; maximized: boolean; compact?: boolean; size?: number;
  onSpotlight: () => void; onMaximize: () => void; onOpenSession: (id: string) => void;
}
function ScreenTile({ tile, spotlight, maximized, compact, size, onSpotlight, onMaximize, onOpenSession }: TileProps) {
  const platform = tile.relay ? PLATFORM.ios : PLATFORM[tile.participant?.attributes?.platform || ''];
  const sharing = !!tile.track || !!tile.relay;
  const state = sharing ? 'live' : tile.participant ? 'connected' : 'offline';
  const style = { '--team': tile.color, ...(size ? { width: size, height: Math.round(size / RATIO) } : {}) } as React.CSSProperties;
  // One tap spotlights, two quick taps open full screen. The spotlight waits a moment for a second tap, because it
  // rebuilds the wall and a second tap would land on a tile that no longer exists. iPhone Safari does not fire
  // dblclick reliably, so taps are counted here. Keyboard presses (detail 0) act at once.
  const pending = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pending.current), []);
  const tap = (event: React.MouseEvent) => {
    if (maximized) { onMaximize(); return; }
    if (event.detail === 0) { onSpotlight(); return; }
    if (pending.current) { window.clearTimeout(pending.current); pending.current = undefined; onMaximize(); return; }
    pending.current = window.setTimeout(() => { pending.current = undefined; onSpotlight(); }, 260);
  };
  return <div className={`lw-tile is-${state}${spotlight ? ' is-spotlight' : ''}${compact ? ' is-compact' : ''}`} data-player={tile.name} style={style}>
    {tile.track
      ? <VideoTrack trackRef={tile.track} className="lw-video" aria-label={`${tile.name} game screen`} />
      : tile.relay ? <RelayVideo feed={tile.relay} label={`${tile.name} game screen (iPhone)`} />
      : <div className="lw-placeholder"><span className="lw-avatar" aria-hidden="true">{initials(tile.name)}</span>
        {!compact && <span className="lw-placeholder-note">{state === 'connected' ? 'Connected, not sharing yet' : 'Not sharing'}</span>}</div>}
    <button type="button" className="lw-hit" onClick={tap}
      aria-label={maximized ? `Exit full screen: ${tile.name}` : spotlight ? `Back to grid from ${tile.name}` : `Spotlight ${tile.name}`} aria-pressed={maximized ? undefined : spotlight} />
    {!compact && <div className="lw-actions">
      {tile.sessionId && <button type="button" onClick={() => onOpenSession(tile.sessionId!)} aria-label={`Review ${tile.name}`} title="Review player"><ShieldAlert size={16} aria-hidden="true" /></button>}
      {!maximized && <button type="button" onClick={onMaximize} aria-label={`Full screen: ${tile.name}`} title="Full screen"><Maximize2 size={16} aria-hidden="true" /></button>}
    </div>}
    <div className="lw-name">
      {sharing ? <MonitorUp size={14} aria-hidden="true" /> : <MonitorOff size={14} aria-hidden="true" className="is-off" />}
      <strong>{tile.name}</strong>
      {(tile.team || platform) && <small>{[tile.team, platform].filter(Boolean).join(' · ')}</small>}
    </div>
    {tile.participant && <Signal participant={tile.participant} />}
  </div>;
}

function Wall({ match, manage, facilitators, onBack, onEditFacilitators, onOpenSession }: WallProps) {
  const participants = useParticipants();
  const screens = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]) as TrackReference[];
  const connection = useConnectionState();
  const { metadata } = useRoomInfo();
  const state = parseState(metadata);
  const iphones = useRelayStreams(match.key);
  const [spotlight, setSpotlight] = useState('');
  const [maximized, setMaximized] = useState('');
  const [pausing, setPausing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [area, size] = useBoxSize<HTMLDivElement>();
  const fullscreen = useFullscreenElement();
  const nativeFull = !!fullscreen && fullscreen === root.current;
  useScrollLock();

  const teams = useMemo<Team[]>(() => {
    const players = participants.filter(p => !p.isLocal && p.identity.startsWith('p-'));
    const used = new Set<string>();
    const order: string[] = [];
    const teamOf = (name: string) => { const key = name.trim() || 'Players'; if (!order.includes(key)) order.push(key); return key; };
    match.seats.forEach(seat => teamOf(seat.team));
    const tileFor = (p: Participant, team: string): Omit<Tile, 'color'> => ({ id: p.identity, name: p.name || 'Player', team, sessionId: p.identity.slice(2), participant: p, track: screens.find(ref => ref.participant.identity === p.identity) });
    // iPhones share through the relay. A player already sharing through LiveKit is not shown twice.
    const phones = iphones.filter(phone => !players.some(p => p.identity === 'p-' + phone.sessionId));
    const phoneTile = (phone: typeof phones[number], team: string): Omit<Tile, 'color'> => ({ id: 'i-' + phone.sessionId, name: phone.name || 'Player', team, sessionId: phone.sessionId, relay: phone.feed });
    // Roster seats first, in team order, so each team stays together. A seat shows its player once they connect.
    const tiles = match.seats.map((seat, index) => {
      const same = (name?: string) => (name || '').trim().toLowerCase() === seat.name.toLowerCase();
      const p = players.find(item => !used.has(item.identity) && same(item.name));
      if (p) { used.add(p.identity); return tileFor(p, teamOf(p.attributes?.team || seat.team)); }
      const phone = phones.find(item => !used.has('i-' + item.sessionId) && same(item.name));
      if (phone) { used.add('i-' + phone.sessionId); return phoneTile(phone, teamOf(phone.team || seat.team)); }
      return { id: `seat-${index}`, name: seat.name, team: teamOf(seat.team) };
    });
    tiles.push(...players.filter(p => !used.has(p.identity)).map(p => tileFor(p, teamOf(p.attributes?.team || ''))));
    tiles.push(...phones.filter(phone => !used.has('i-' + phone.sessionId)).map(phone => phoneTile(phone, teamOf(phone.team || ''))));
    return order.map((name, index) => {
      const color = TEAM_COLORS[index % TEAM_COLORS.length];
      return { name, color, tiles: tiles.filter(tile => tile.team === name).map(tile => ({ ...tile, team: tile.team === 'Players' ? '' : tile.team, color })) };
    }).filter(team => team.tiles.length);
  }, [participants, screens, iphones, match.seats]);

  const tiles = teams.flatMap(team => team.tiles);
  const sharing = tiles.filter(tile => tile.track || tile.relay).length;
  const focused = tiles.find(tile => tile.id === spotlight);
  const big = tiles.find(tile => tile.id === maximized);
  const others = focused ? tiles.filter(tile => tile !== focused) : [];
  const labelled = teams.length > 1 || teams.some(team => team.name !== 'Players');
  const layout = wallLayout(size.width, size.height, teams.map(team => team.tiles.length), labelled);

  // Native full screen where the browser has it (PC, Android). iPhone Safari has none, and the wall already fills its screen.
  const enterNative = useCallback(() => {
    if (document.fullscreenEnabled && root.current && document.fullscreenElement !== root.current) void root.current.requestFullscreen().catch(() => {});
  }, []);
  const exitNative = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }, []);
  const toggleMaximize = (tile: Tile) => {
    if (maximized === tile.id) { setMaximized(''); exitNative(); }
    else { setMaximized(tile.id); enterNative(); }
  };
  // Leaving native full screen (Esc, or the phone's back gesture) also leaves the one-player view.
  const wasFull = useRef(false);
  useEffect(() => { if (wasFull.current && !nativeFull) setMaximized(''); wasFull.current = nativeFull; }, [nativeFull]);
  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMaximized(''); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized]);
  // A player who leaves the room cannot stay spotlighted.
  useEffect(() => { if (maximized && !big) setMaximized(''); }, [maximized, big]);

  const tileProps = (tile: Tile, extra: Partial<TileProps> = {}): TileProps => ({
    tile, onOpenSession, spotlight: tile === focused, maximized: tile.id === maximized,
    onSpotlight: () => setSpotlight(current => current === tile.id ? '' : tile.id), onMaximize: () => toggleMaximize(tile), ...extra,
  });
  const status = connection === ConnectionState.Connected ? `${sharing} of ${Math.max(tiles.length, match.seats.length)} sharing`
    : connection === ConnectionState.Reconnecting ? 'Reconnecting…' : 'Connecting…';

  return <div ref={root} className={`lw-stage lw-call${state.paused ? ' is-paused' : ''}${big ? ' is-maximized' : ''}`} role="group" aria-label={`Live screens: ${match.title}`}>
    <header className="lw-top">
      <div className="lw-title"><Video size={18} aria-hidden="true" /><span><strong>{match.title}</strong><small>{match.when}</small></span></div>
      <button type="button" className="lw-close" onClick={() => { exitNative(); onBack(); }} aria-label="Matches" title="Back to matches"><X size={20} aria-hidden="true" /></button>
      <div className="lw-top-right">
        <span className={`lw-live-count${sharing ? ' is-on' : ''}`} role="status">{status}</span>
        <span className="lw-chip" title="Facilitators"><Users size={14} aria-hidden="true" />{facilitators.length ? facilitators.map(email => email.split('@')[0]).join(', ') : 'No facilitator'}</span>
      </div>
    </header>
    {state.paused && <p className="lw-paused" role="alert"><strong>Match paused</strong>{state.by && ` by ${state.by}`}{state.at && ` at ${new Date(state.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}. Players see a pause notice on their device.{state.note && ` Reason: ${state.note}`}</p>}

    <div ref={area} className="lw-area">
      {big ? <div className="lw-full"><ScreenTile key={big.id} {...tileProps(big)} />
        <button type="button" className="lw-full-exit" onClick={() => toggleMaximize(big)}><Minimize2 size={16} aria-hidden="true" />Exit full screen</button></div>
      : focused ? <div className="lw-spotlight">
        <div className="lw-spotlight-main"><ScreenTile key={focused.id} {...tileProps(focused)} /></div>
        {others.length > 0 && <div className="lw-strip" aria-label="Other players">{others.map(tile => <ScreenTile key={tile.id} {...tileProps(tile, { compact: true })} />)}</div>}
      </div>
      : tiles.length ? <div className={`lw-grid is-${layout.direction}`}>
        {teams.map(team => <section key={team.name} className="lw-team" style={{ '--team': team.color, ...(layout.direction === 'row' ? { flex: `${team.tiles.length} 1 0` } : {}) } as React.CSSProperties} aria-label={team.name}>
          {labelled && <h3 className="lw-team-label"><span className="lw-dot" aria-hidden="true" />{team.name}
            <small>{team.tiles.filter(tile => tile.track || tile.relay).length}/{team.tiles.length} live</small></h3>}
          <div className="lw-team-tiles">{team.tiles.map(tile => <ScreenTile key={tile.id} {...tileProps(tile, { size: layout.tile })} />)}</div>
        </section>)}
      </div>
      : <p className="lw-empty">Players appear here when they open their sharing link. No roster is published for this match.</p>}
    </div>

    <footer className="lw-controls" aria-label="Wall controls">
      <div className="lw-control-group">
        <button type="button" className={`lw-ctl${focused ? '' : ' is-active'}`} onClick={() => setSpotlight('')} disabled={!focused} aria-label="Grid" title="Grid: everyone at once"><Grid size={20} aria-hidden="true" /></button>
        {document.fullscreenEnabled && <button type="button" className="lw-ctl" onClick={() => nativeFull ? (setMaximized(''), exitNative()) : enterNative()}
          aria-label={nativeFull ? 'Exit full screen' : 'Full screen'} title={nativeFull ? 'Exit full screen' : 'Full screen'}>{nativeFull ? <Minimize2 size={20} aria-hidden="true" /> : <Maximize2 size={20} aria-hidden="true" />}</button>}
        {manage && onEditFacilitators && <button type="button" className="lw-ctl" onClick={onEditFacilitators} aria-label="Facilitators" title="Facilitators"><Users size={20} aria-hidden="true" /></button>}
        {focused?.sessionId && <button type="button" className="lw-ctl" onClick={() => onOpenSession(focused.sessionId!)} aria-label={`Review ${focused.name}`} title="Review player"><ShieldAlert size={20} aria-hidden="true" /></button>}
      </div>
      <button type="button" className={`lw-ctl lw-ctl-main ${state.paused ? 'is-resume' : 'is-pause'}`} onClick={() => setPausing(true)}>
        {state.paused ? <><Play size={20} aria-hidden="true" /><span>Resume match</span></> : <><Pause size={20} aria-hidden="true" /><span>Pause match</span></>}
      </button>
    </footer>
    {pausing && <PauseDialog match={match} state={state} onClose={() => setPausing(false)} />}
  </div>;
}

function PauseDialog({ match, state, onClose }: { match: WallMatch; state: RoomState; onClose: () => void }) {
  const resume = state.paused;
  const broadcastChoice = !!match.matchId && !!match.hasBroadcast && (resume ? match.status === 'pre-match' : match.status === 'live');
  const [note, setNote] = useState(''), [broadcast, setBroadcast] = useState(broadcastChoice);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await antiCheatCall(`/screenwall/${match.key}/pause`, { body: { paused: !resume, note } });
      if (broadcastChoice && broadcast) await firestoreService.setMatchStatus(match.matchId!, resume ? 'live' : 'pre-match');
      onClose();
    } catch (err) { setError(errorMessage(err, resume ? 'The match could not be resumed.' : 'The match could not be paused.')); setBusy(false); }
  };
  return <Modal open title={resume ? 'Resume this match?' : 'Pause this match?'} description={match.title} busy={busy} onClose={onClose} className="feature-dialog">
    <form className="feature-dialog-body module-form" onSubmit={confirm}>
      <p>{resume ? 'Players’ pause notice goes away.' : 'Every player in this match sees a full pause notice on their sharing screen. Tell the lobby host to pause the game too: ArenaHub cannot pause Mobile Legends, CODM or Dota 2 itself.'}</p>
      {!resume && <label>Reason players see (optional)<input maxLength={200} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. Checking a player's screen" /></label>}
      {broadcastChoice && <label className="settings-toggle">{resume ? 'Put the spectator broadcast back live' : 'Also pause the spectator broadcast'}<input type="checkbox" checked={broadcast} onChange={event => setBroadcast(event.target.checked)} /></label>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="feature-dialog-actions"><button type="button" className="arena-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={resume ? 'arena-primary' : 'arena-primary arena-danger'} disabled={busy}>{resume ? 'Resume match' : 'Pause match'}</button></div>
    </form>
  </Modal>;
}

interface WallProps {
  match: WallMatch; manage: boolean; facilitators: string[];
  onBack: () => void; onEditFacilitators?: () => void; onOpenSession: (sessionId: string) => void;
}
export default function LiveWall(props: WallProps) {
  const [access, setAccess] = useState<{ url: string; token: string }>();
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setAccess(undefined); setError('');
    antiCheatCall<{ url: string; token: string }>(`/screenwall/${props.match.key}/watch`, { body: {} })
      .then(next => { if (live) setAccess(next); })
      .catch(err => { if (live) setError(errorMessage(err, 'The live wall could not open.')); });
    return () => { live = false; };
  }, [props.match.key, attempt]);
  if (error) return <div className="lw-stage lw-call is-message"><header className="lw-top">
      <div className="lw-title"><Video size={18} aria-hidden="true" /><span><strong>{props.match.title}</strong></span></div>
      <button type="button" className="lw-close" onClick={props.onBack} aria-label="Matches" title="Back to matches"><X size={20} aria-hidden="true" /></button></header>
    <div className="lw-area lw-message"><p className="field-error" role="alert">{error}</p><button type="button" className="lw-ctl lw-ctl-main" onClick={() => setAttempt(n => n + 1)}>Try again</button></div></div>;
  if (!access) return <div className="lw-stage lw-call is-message"><div className="lw-area lw-message"><p role="status">Opening the live wall…</p></div></div>;
  return <LiveKitRoom serverUrl={access.url} token={access.token} connect audio={false} video={false}
    options={{ adaptiveStream: true }} onError={err => setError(err.message || 'The live connection failed.')}
    onDisconnected={() => setError('The live connection closed.')} className="lw-room">
    <Wall {...props} />
  </LiveKitRoom>;
}
