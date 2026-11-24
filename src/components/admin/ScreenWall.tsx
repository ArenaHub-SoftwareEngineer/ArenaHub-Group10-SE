// Live player screens, step by step: choose a game, choose a match, then watch every player's screen at once.
// The video itself is in LiveWall (loaded only when a match opens, because the LiveKit client is large).
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { antiCheatCall } from '../../lib/antiCheatApi';
import { errorMessage } from '../../lib/errors';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from '../../lib/fairPlayGames';
import { scheduleMatches } from '../../lib/formats/placement';
import { GAME_LABEL, type MonitorGame } from '../../lib/integrityRisk';
import { matchName } from '../../lib/matchName';
import { clockLabel, parseClock } from '../../lib/matchTiming';
import type { BracketDraft, Match } from '../../lib/types';
import { GameArtworkTiles } from '../common/GameArtworkTiles';
import { Modal } from '../ui/Modal';
import { ArrowLeft, Pause, Users, Video } from '../ui/Icons';
import type { WallMatch, WallSeat } from './LiveWall';
import './screenWall.css';

const LiveWall = lazy(() => import('./LiveWall'));

export interface ScreenStatus {
  configured: boolean; liveError: string; manage: boolean; email: string;
  staff: Record<string, string[]>;
  live: Record<string, { publishers: number; state: { paused: boolean; by?: string; at?: number; note?: string } }>;
  scrims: { key: string; label: string; game: MonitorGame | null; gameLabel: string; players: { name: string; team: string }[] }[];
}

const gameOf = (match: Match) => FAIR_PLAY_GAMES.find(game => belongsToFairPlayGame(match, game))?.id as MonitorGame | undefined;
const seatsOf = (match: Match): WallSeat[] => (match.lobby ? match.lobby.teams || [] : [match.team1, match.team2])
  .flatMap(team => team && !team.isBye ? (team.players || []).map(player => ({ name: (player.ign || player.name || '').trim(), team: team.name })) : [])
  .filter(seat => seat.name);
const when = (match: Match) => {
  if (match.status === 'live') return 'Live now';
  const minutes = match.scheduledTime ? parseClock(match.scheduledTime) : null;
  const day = match.scheduledDate ? new Date(match.scheduledDate + 'T00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
  return [day, minutes === null ? '' : clockLabel(minutes)].filter(Boolean).join(', ') || 'Time not set';
};

/** Organizers choose up to four staff emails to watch one match. */
function FacilitatorDialog({ match, emails, onClose, onSaved }: { match: WallMatch; emails: string[]; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState(() => [...emails, '', '', '', ''].slice(0, 4));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await antiCheatCall(`/screenwall/${match.key}/staff`, { body: { emails: values.map(value => value.trim()).filter(Boolean) } });
      onSaved(); onClose();
    } catch (err) { setError(errorMessage(err, 'Facilitators could not be saved.')); }
    finally { setBusy(false); }
  };
  return <Modal open title="Match facilitators" description={match.title} busy={busy} onClose={onClose} className="feature-dialog">
    <form className="feature-dialog-body module-form" onSubmit={save}>
      <p className="field-hint">Facilitators sign in with their staff account and open this match from Monitor. Organizers and admins can watch every match.</p>
      {values.map((value, index) => <label key={index}>Facilitator {index + 1}{index > 0 && ' (optional)'}
        <input type="email" maxLength={160} value={value} placeholder="name@wmsu.edu.ph" onChange={event => setValues(list => list.map((item, i) => i === index ? event.target.value : item))} />
      </label>)}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="feature-dialog-actions"><button type="button" className="arena-outline" onClick={onClose} disabled={busy}>Cancel</button><button className="arena-primary" disabled={busy}>Save facilitators</button></div>
    </form>
  </Modal>;
}

export function ScreenWall({ brackets, onOpenSession }: { brackets: BracketDraft[]; onOpenSession: (sessionId: string) => void }) {
  const [status, setStatus] = useState<ScreenStatus>();
  const [error, setError] = useState('');
  const [game, setGame] = useState<MonitorGame | ''>('');
  const [openKey, setOpenKey] = useState('');
  const [editing, setEditing] = useState<WallMatch | null>(null);

  const refresh = useCallback(() => antiCheatCall<ScreenStatus>('/screenwall/status')
    .then(next => { setStatus(next); setError(''); })
    .catch(err => setError(errorMessage(err, 'Live screens could not be loaded.'))), []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);

  const matches = useMemo<WallMatch[]>(() => {
    const scheduled = brackets.flatMap(bracket => scheduleMatches(bracket))
      .filter(match => match.status !== 'completed' && !match.inactive && /^[A-Za-z0-9_-]{1,80}$/.test(match.id))
      .flatMap(match => {
        const id = gameOf(match);
        if (!id || (!match.lobby && (!match.team1 || !match.team2))) return [];
        const teams = match.lobby ? `${match.lobby.squads} squads` : `${match.team1!.name} vs ${match.team2!.name}`;
        return [{ key: 'm-' + match.id, matchId: match.id, game: id, title: [matchName(match) || match.roundName, teams].filter(Boolean).join(' · '), when: when(match), live: match.status === 'live', status: match.status, hasBroadcast: !!(match.broadcastLinks?.length || match.streamUrl), seats: seatsOf(match), order: `${match.status === 'live' ? 0 : 1}${match.scheduledDate || '9'}${match.scheduledTime || ''}` }];
      })
      .sort((a, b) => a.order.localeCompare(b.order));
    const scrims = (status?.scrims || []).map(room => ({ key: room.key, game: room.game, title: room.label, when: 'Scrim or test check-in', live: false, seats: room.players.map(p => ({ name: p.name, team: p.team })), order: '2' }));
    const all = [...scheduled, ...scrims];
    // Facilitators see only the matches they are assigned to.
    return status && !status.manage ? all.filter(match => match.key in status.staff) : all;
  }, [brackets, status]);

  const forGame = matches.filter(match => !game || match.game === game || match.game === null);
  const open = matches.find(match => match.key === openKey);
  const gameMeta = Object.fromEntries((Object.keys(GAME_LABEL) as MonitorGame[]).map(id => {
    const list = matches.filter(match => match.game === id);
    const sharing = list.reduce((sum, match) => sum + (status?.live[match.key]?.publishers || 0), 0);
    return [id, sharing ? `${sharing} sharing now` : list.length ? `${list.length} match${list.length === 1 ? '' : 'es'}` : 'No matches'];
  }));

  if (open && status) return <section className="operations-section lw-section" aria-labelledby="pov-heading">
    <h2 id="pov-heading" className="lw-sr">Live player screens</h2>
    <Suspense fallback={<p role="status" className="field-hint">Opening the live wall…</p>}>
      <LiveWall match={open} manage={status.manage} facilitators={status.staff[open.key] || []} onBack={() => setOpenKey('')}
        onEditFacilitators={status.manage ? () => setEditing(open) : undefined} onOpenSession={onOpenSession} />
    </Suspense>
    {editing && <FacilitatorDialog match={editing} emails={status.staff[editing.key] || []} onClose={() => setEditing(null)} onSaved={() => void refresh()} />}
  </section>;

  return <section className="operations-section lw-section" aria-labelledby="pov-heading">
    <div className="operations-section-heading"><div><h2 id="pov-heading">Live player screens</h2>
      <p>Choose a game, then a match, to watch every player’s screen at once.</p></div></div>
    {error && <p role="alert" className="field-error">{error}</p>}
    {status && !status.configured && <p className="module-notice" role="status"><strong>Live screens are not switched on.</strong> Add the LiveKit address and keys to the server settings. The steps are in docs/LIVE_SCREENS.md.</p>}
    {status?.liveError && <p className="field-error" role="alert">{status.liveError}</p>}
    <ol className="lw-steps" aria-label="Steps">
      <li className={game ? 'is-done' : 'is-current'}><span>1</span>Game</li>
      <li className={game ? 'is-current' : ''}><span>2</span>Match</li>
      <li><span>3</span>Watch</li>
    </ol>
    {!game ? <GameArtworkTiles label="Choose a game" onSelect={id => setGame(id as MonitorGame)} meta={gameMeta} compact /> : <>
      <div className="lw-picked">
        <button type="button" className="arena-outline" onClick={() => setGame('')}><ArrowLeft size={16} aria-hidden="true" />All games</button>
        <strong>{GAME_LABEL[game]}</strong>
      </div>
      {!status ? <p role="status" className="field-hint">Loading matches…</p> : !forGame.length
        ? <p className="lw-empty">{status.manage ? 'No upcoming or live matches for this game. Publish a schedule first, or open a scrim check-in.' : 'You are not assigned to a match in this game. Ask the organizer.'}</p>
        : <ul className="lw-matches" aria-label={`${GAME_LABEL[game]} matches`}>{forGame.map(match => {
          const live = status.live[match.key], staff = status.staff[match.key] || [];
          return <li key={match.key}>
            <button type="button" className="lw-match" onClick={() => setOpenKey(match.key)} aria-label={`Watch ${match.title}`}>
              <span className="lw-match-main"><strong>{match.title}</strong>
                <small className={match.live ? 'is-live' : ''}>{match.when}</small></span>
              <span className="lw-match-meta">
                {live?.state.paused && <span className="status-pill is-danger"><Pause size={13} aria-hidden="true" />Paused</span>}
                <span className={`status-pill ${live?.publishers ? 'is-success' : ''}`}><Video size={13} aria-hidden="true" />{match.seats.length ? `${live?.publishers || 0} of ${match.seats.length} sharing` : `${live?.publishers || 0} sharing`}</span>
                <span className="lw-staff"><Users size={13} aria-hidden="true" />{staff.length ? staff.map(email => email.split('@')[0]).join(', ') : 'No facilitator'}</span>
              </span>
            </button>
            {status.manage && <button type="button" className="arena-outline lw-assign" onClick={() => setEditing(match)}>Facilitators</button>}
          </li>;
        })}</ul>}
    </>}
    {editing && status && <FacilitatorDialog match={editing} emails={status.staff[editing.key] || []} onClose={() => setEditing(null)} onSaved={() => void refresh()} />}
  </section>;
}
