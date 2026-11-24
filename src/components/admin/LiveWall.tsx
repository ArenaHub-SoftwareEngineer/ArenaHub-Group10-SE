// The live wall: every player's screen in one grid (like a group video call), with a name on each tile.
// Click a tile to spotlight it (big stage plus a strip of the others), or open it full screen.
// LiveKit's adaptive stream sends each tile only the quality its size needs, and pauses tiles nobody can see.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LiveKitRoom, VideoTrack, useConnectionQualityIndicator, useConnectionState, useParticipants, useRoomInfo, useTracks, type TrackReference } from '@livekit/components-react';
import { ConnectionQuality, ConnectionState, Track, type Participant } from 'livekit-client';
import { antiCheatCall } from '../../lib/antiCheatApi';
import { errorMessage } from '../../lib/errors';
import { firestoreService } from '../../lib/firestore';
import type { Match } from '../../lib/types';
import type { MonitorGame } from '../../lib/integrityRisk';
import { Modal } from '../ui/Modal';
import { ArrowLeft, Grid, Maximize2, Pause, Play, ShieldAlert, Users } from '../ui/Icons';

export interface WallSeat { name: string; team: string }
export interface WallMatch {
  key: string; matchId?: string; game: MonitorGame | null; title: string; when: string; live: boolean;
  status?: Match['status']; hasBroadcast?: boolean; seats: WallSeat[]; order: string;
}
interface RoomState { paused: boolean; by?: string; at?: number; note?: string }
interface Tile { id: string; name: string; team: string; sessionId?: string; participant?: Participant; track?: TrackReference }

const PLATFORM: Record<string, string> = { android: 'Android', pc: 'PC', ios: 'iPhone' };
// Two letters: the first letters of two words, or the first two letters of a one-word in-game name ("CNGold1" is "CN").
const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
};
const parseState = (metadata?: string): RoomState => { try { const value = JSON.parse(metadata || '{}'); return value?.paused === true ? value : { paused: false }; } catch { return { paused: false }; } };
const columnsFor = (count: number) => count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : count <= 16 ? 4 : 5;

async function toggleFullscreen(target: HTMLElement | null) {
  if (!target) return;
  if (document.fullscreenElement === target) await document.exitFullscreen();
  else await target.requestFullscreen();
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

function Signal({ participant }: { participant: Participant }) {
  const { quality } = useConnectionQualityIndicator({ participant });
  if (quality !== ConnectionQuality.Poor && quality !== ConnectionQuality.Lost) return null;
  return <span className="lw-weak">{quality === ConnectionQuality.Lost ? 'Connection lost' : 'Weak connection'}</span>;
}

function ScreenTile({ tile, spotlight, onSpotlight, onOpenSession, fullscreen }: {
  tile: Tile; spotlight: boolean; onSpotlight: () => void; onOpenSession: (id: string) => void; fullscreen: Element | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const platform = PLATFORM[tile.participant?.attributes?.platform || ''];
  const state = tile.track ? 'live' : tile.participant ? 'connected' : 'offline';
  const isFull = !!fullscreen && fullscreen === box.current;
  return <div ref={box} className={`lw-tile is-${state}${spotlight ? ' is-spotlight' : ''}`} data-player={tile.name}>
    {tile.track
      ? <VideoTrack trackRef={tile.track} className="lw-video" aria-label={`${tile.name} game screen`} />
      : <div className="lw-placeholder"><span className="lw-avatar" aria-hidden="true">{initials(tile.name)}</span>
        <span>{state === 'connected' ? 'Connected, not sharing yet' : 'Not sharing'}</span></div>}
    <button type="button" className="lw-hit" onClick={onSpotlight} onDoubleClick={() => void toggleFullscreen(box.current).catch(() => {})}
      aria-label={spotlight ? `Back to grid from ${tile.name}` : `Spotlight ${tile.name}`} aria-pressed={spotlight} />
    <div className="lw-actions">
      {tile.sessionId && <button type="button" onClick={() => onOpenSession(tile.sessionId!)} aria-label={`Review ${tile.name}`} title="Review player"><ShieldAlert size={16} aria-hidden="true" /></button>}
      {document.fullscreenEnabled && <button type="button" onClick={() => void toggleFullscreen(box.current).catch(() => {})} aria-label={`${isFull ? 'Exit full screen' : 'Full screen'}: ${tile.name}`} title={isFull ? 'Exit full screen' : 'Full screen'}><Maximize2 size={16} aria-hidden="true" /></button>}
    </div>
    <div className="lw-name"><strong>{tile.name}</strong>{(tile.team || platform) && <small>{[tile.team, platform].filter(Boolean).join(' · ')}</small>}</div>
    {tile.participant && <Signal participant={tile.participant} />}
  </div>;
}

function Wall({ match, manage, facilitators, onBack, onEditFacilitators, onOpenSession }: WallProps) {
  const participants = useParticipants();
  const screens = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]) as TrackReference[];
  const connection = useConnectionState();
  const { metadata } = useRoomInfo();
  const state = parseState(metadata);
  const [spotlight, setSpotlight] = useState('');
  const [pausing, setPausing] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreenElement();

  const tiles = useMemo<Tile[]>(() => {
    const players = participants.filter(p => !p.isLocal && p.identity.startsWith('p-'));
    const used = new Set<string>();
    const tileFor = (p: Participant): Tile => ({ id: p.identity, name: p.name || 'Player', team: p.attributes?.team || '', sessionId: p.identity.slice(2), participant: p, track: screens.find(ref => ref.participant.identity === p.identity) });
    // Roster seats first, in team order, so each team stays together. A seat shows its player once they connect.
    const seated = match.seats.map((seat, index) => {
      const p = players.find(item => !used.has(item.identity) && (item.name || '').trim().toLowerCase() === seat.name.toLowerCase());
      if (p) { used.add(p.identity); return { ...tileFor(p), team: p.attributes?.team || seat.team }; }
      return { id: `seat-${index}`, name: seat.name, team: seat.team };
    });
    return [...seated, ...players.filter(p => !used.has(p.identity)).map(tileFor)];
  }, [participants, screens, match.seats]);

  const sharing = tiles.filter(tile => tile.track).length;
  const focused = tiles.find(tile => tile.id === spotlight);
  const others = focused ? tiles.filter(tile => tile !== focused) : tiles;
  const tileProps = (tile: Tile) => ({ tile, fullscreen, onOpenSession, spotlight: tile === focused, onSpotlight: () => setSpotlight(current => current === tile.id ? '' : tile.id) });
  const wallFull = !!fullscreen && fullscreen === stage.current;

  return <div ref={stage} className={`lw-stage${state.paused ? ' is-paused' : ''}`}>
    <div className="lw-toolbar">
      <button type="button" className="lw-tool" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Matches</button>
      <div className="lw-title"><strong>{match.title}</strong>
        <span role="status">{connection === ConnectionState.Connected ? `${sharing} of ${Math.max(tiles.length, match.seats.length)} sharing` : connection === ConnectionState.Reconnecting ? 'Reconnecting…' : 'Connecting…'}</span></div>
      <div className="lw-tools">
        <span className="lw-chip"><Users size={14} aria-hidden="true" />{facilitators.length ? facilitators.map(email => email.split('@')[0]).join(', ') : 'No facilitator'}</span>
        {manage && onEditFacilitators && <button type="button" className="lw-tool" onClick={onEditFacilitators}>Facilitators</button>}
        {focused && <button type="button" className="lw-tool" onClick={() => setSpotlight('')}><Grid size={16} aria-hidden="true" />Grid</button>}
        {document.fullscreenEnabled && <button type="button" className="lw-tool" onClick={() => void toggleFullscreen(stage.current).catch(() => {})}><Maximize2 size={16} aria-hidden="true" />{wallFull ? 'Exit full screen' : 'Full screen'}</button>}
        <button type="button" className={`lw-tool ${state.paused ? 'is-resume' : 'is-pause'}`} onClick={() => setPausing(true)}>
          {state.paused ? <><Play size={16} aria-hidden="true" />Resume match</> : <><Pause size={16} aria-hidden="true" />Pause match</>}
        </button>
      </div>
    </div>
    {state.paused && <p className="lw-paused" role="alert"><strong>Match paused</strong>{state.by && ` by ${state.by}`}{state.at && ` at ${new Date(state.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}. Players see a pause notice on their device.{state.note && ` Reason: ${state.note}`}</p>}
    {focused ? <div className="lw-spotlight">
      <ScreenTile key={focused.id} {...tileProps(focused)} />
      {others.length > 0 && <div className="lw-strip" aria-label="Other players">{others.map(tile => <ScreenTile key={tile.id} {...tileProps(tile)} />)}</div>}
    </div> : tiles.length ? <div className="lw-grid" style={{ '--lw-cols': columnsFor(tiles.length) } as React.CSSProperties}>
      {tiles.map(tile => <ScreenTile key={tile.id} {...tileProps(tile)} />)}
    </div> : <p className="lw-empty">Players appear here when they open their sharing link. No roster is published for this match.</p>}
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
  if (error) return <div className="lw-stage"><div className="lw-toolbar"><button type="button" className="lw-tool" onClick={props.onBack}><ArrowLeft size={16} aria-hidden="true" />Matches</button></div>
    <p className="field-error" role="alert">{error}</p><button type="button" className="arena-outline" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>;
  if (!access) return <p role="status" className="field-hint">Opening the live wall…</p>;
  return <LiveKitRoom serverUrl={access.url} token={access.token} connect audio={false} video={false}
    options={{ adaptiveStream: true }} onError={err => setError(err.message || 'The live connection failed.')}
    onDisconnected={() => setError('The live connection closed.')} className="lw-room">
    <Wall {...props} />
  </LiveKitRoom>;
}
