// Live player screens: pick a day and a game, then click a match card to watch every player at once.
// Cards show the two crests, a light per player (lit = sharing) and who is facilitating. The 3D wall above shows
// what is worth watching right now. The video itself is in LiveWall (loaded only when a match opens).
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { antiCheatCall } from '../../lib/antiCheatApi';
import { teamBadgeColor, teamBadgeImage, teamInitials } from '../../lib/bracketAppearance';
import { errorMessage } from '../../lib/errors';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from '../../lib/fairPlayGames';
import { scheduleMatches } from '../../lib/formats/placement';
import { GAME_LABEL, type MonitorGame } from '../../lib/integrityRisk';
import { matchName } from '../../lib/matchName';
import { clockLabel, parseClock } from '../../lib/matchTiming';
import type { BracketDraft, Match } from '../../lib/types';
import { ScreenDeck, type DeckScreen } from '../three/ScreenDeck';
import { Modal } from '../ui/Modal';
import { Check, Pause, Plus, UserPlus, Video } from '../ui/Icons';
import type { WallMatch, WallSeat } from './LiveWall';
import './screenWall.css';
import './watchScreens.css';

const LiveWall = lazy(() => import('./LiveWall'));

export interface ScreenStatus {
  configured: boolean; liveError: string; manage: boolean; email: string;
  staff: Record<string, string[]>;
  live: Record<string, { publishers: number; state: { paused: boolean; by?: string; at?: number; note?: string } }>;
  scrims: { key: string; label: string; game: MonitorGame | null; gameLabel: string; players: { name: string; team: string }[] }[];
}

export interface Crest { name: string; logo?: string; color?: string }
/** A match as a card: the wall's data plus crests and the day/time it is shown under. */
export interface ScreenCard extends WallMatch { crests: Crest[]; squads?: number; day: string; time: string; short: string }

export const GAME_ART: Record<MonitorGame, string> = Object.fromEntries(FAIR_PLAY_GAMES.map(game => [game.id, game.image])) as Record<MonitorGame, string>;
/** A match date as YYYY-MM-DD in local time, whatever format it was saved in; '' when there is none. */
export function dayKeyOf(value?: string) {
  if (!value) return '';
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const gameOf = (match: Match) => FAIR_PLAY_GAMES.find(game => belongsToFairPlayGame(match, game))?.id as MonitorGame | undefined;
const seatsOf = (match: Match): WallSeat[] => (match.lobby ? match.lobby.teams || [] : [match.team1, match.team2])
  .flatMap(team => team && !team.isBye ? (team.players || []).map(player => ({ name: (player.ign || player.name || '').trim(), team: team.name })) : [])
  .filter(seat => seat.name);
const when = (match: Match) => {
  if (match.status === 'live') return 'Live now';
  const minutes = match.scheduledTime ? parseClock(match.scheduledTime) : null;
  const key = dayKeyOf(match.scheduledDate);
  const day = key ? new Date(key + 'T00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
  return [day, minutes === null ? '' : clockLabel(minutes)].filter(Boolean).join(', ') || 'Time not set';
};

/** Every upcoming or live scheduled match that has a fair-play game, as cards. Shared with the Facilitators tab. */
export function scheduledCards(brackets: BracketDraft[]): ScreenCard[] {
  return brackets.flatMap(bracket => scheduleMatches(bracket).map(match => ({ bracket, match })))
    .filter(({ match }) => match.status !== 'completed' && !match.inactive && /^[A-Za-z0-9_-]{1,80}$/.test(match.id))
    .flatMap(({ bracket, match }) => {
      const id = gameOf(match);
      if (!id || (!match.lobby && (!match.team1 || !match.team2))) return [];
      const look = bracket.appearance?.teams || {};
      const crests = match.lobby ? [] : [match.team1!, match.team2!].map(team => ({ name: team.name, logo: teamBadgeImage(look[team.id]?.image), color: teamBadgeColor(look[team.id]?.color) }));
      const teams = match.lobby ? `${match.lobby.squads} squads` : `${match.team1!.name} vs ${match.team2!.name}`;
      const minutes = match.scheduledTime ? parseClock(match.scheduledTime) : null;
      const short = matchName(match) || match.roundName || 'Match';
      return [{
        key: 'm-' + match.id, matchId: match.id, game: id, title: [short, teams].filter(Boolean).join(' · '), short,
        when: when(match), live: match.status === 'live', status: match.status, hasBroadcast: !!(match.broadcastLinks?.length || match.streamUrl),
        seats: seatsOf(match), crests, squads: match.lobby?.squads, day: dayKeyOf(match.scheduledDate), time: minutes === null ? '' : clockLabel(minutes),
        order: `${match.status === 'live' ? 0 : 1}${dayKeyOf(match.scheduledDate) || '9'}${minutes === null ? '9999' : String(minutes).padStart(4, '0')}`,
      }];
    });
}

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayParts = (day: string) => {
  const date = new Date(day + 'T00:00');
  return { week: date.toLocaleDateString([], { weekday: 'short' }), num: date.getDate(), month: date.toLocaleDateString([], { month: 'short' }) };
};
/** Two letters for a person from their email: "juan.dela" -> "JD". */
export const emailInitials = (email: string) => {
  const parts = email.split('@')[0].split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase() || '?';
};

export function CrestBadge({ crest, size = 'md' }: { crest: Crest; size?: 'sm' | 'md' }) {
  return <span className={`ws-crest is-${size}`} style={crest.color ? { '--crest': crest.color } as React.CSSProperties : undefined} title={crest.name}>
    {crest.logo ? <img src={crest.logo} alt="" loading="lazy" decoding="async" /> : <b>{teamInitials(crest.name)}</b>}
  </span>;
}

/** Choose who facilitates one match: tap invited people on or off, or invite a new email straight onto it. */
function AssignDialog({ match, assigned, known, onClose, onSaved }: { match: ScreenCard | WallMatch; assigned: string[]; known: string[]; onClose: () => void; onSaved: () => void }) {
  const [picked, setPicked] = useState<string[]>(assigned);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const people = [...new Set([...known, ...assigned])].sort();
  const typed = email.trim().toLowerCase();
  const total = picked.length + (typed && !picked.includes(typed) ? 1 : 0);
  const toggle = (who: string) => setPicked(list => list.includes(who) ? list.filter(item => item !== who) : list.length >= 4 ? list : [...list, who]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (total > 4) { setError('A match has at most 4 facilitators.'); return; }
    setBusy(true); setError('');
    try {
      // A new email is invited first, so they get the facilitator role, then the match keeps exactly this list.
      if (typed && !picked.includes(typed)) await antiCheatCall('/facilitators', { body: { email: typed, matches: [match.key] } });
      await antiCheatCall(`/screenwall/${match.key}/staff`, { body: { emails: typed && !picked.includes(typed) ? [...picked, typed] : picked } });
      onSaved(); onClose();
    } catch (err) { setError(errorMessage(err, 'Facilitators could not be saved.')); }
    finally { setBusy(false); }
  };
  return <Modal open title="Who watches this match?" description={match.title} busy={busy} onClose={onClose} className="feature-dialog">
    <form className="feature-dialog-body ws-assign" onSubmit={save}>
      {people.length > 0 && <div className="ws-people" role="group" aria-label="Facilitators">
        {people.map(who => { const on = picked.includes(who); return <button key={who} type="button" className="ws-person" aria-pressed={on} onClick={() => toggle(who)} disabled={!on && picked.length >= 4}>
          <span className="ws-avatar" aria-hidden="true">{emailInitials(who)}</span><span className="ws-person-mail">{who}</span>
          <span className="ws-tick" aria-hidden="true">{on ? <Check size={14} /> : <Plus size={14} />}</span>
        </button>; })}
      </div>}
      <label className="ws-invite-line"><span className="ws-label"><UserPlus size={15} aria-hidden="true" /> Invite someone new</span>
        <input type="email" maxLength={160} value={email} placeholder="name@wmsu.edu.ph" onChange={event => setEmail(event.target.value)} />
      </label>
      <p className="ws-count" aria-live="polite">{total} of 4</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="feature-dialog-actions"><button type="button" className="arena-outline" onClick={onClose} disabled={busy}>Cancel</button><button className="arena-primary" disabled={busy}>Save</button></div>
    </form>
  </Modal>;
}

export function ScreenWall({ brackets, openKey, onOpenKey, onReport, facilitators = [], onSharingChange }: {
  brackets: BracketDraft[]; openKey: string; onOpenKey: (key: string) => void; onReport: (sessionId: string, snapshot: File | null) => void;
  /** Invited facilitator emails (managers only), offered in the assign dialog. */
  facilitators?: string[];
  onSharingChange?: (sharing: number, matches: number) => void;
}) {
  const [status, setStatus] = useState<ScreenStatus>();
  const [error, setError] = useState('');
  const [game, setGame] = useState<MonitorGame | ''>('');
  const [day, setDay] = useState<string>('');
  const [editing, setEditing] = useState<ScreenCard | WallMatch | null>(null);

  const refresh = useCallback(() => antiCheatCall<ScreenStatus>('/screenwall/status')
    .then(next => { setStatus(next); setError(''); })
    .catch(err => setError(errorMessage(err, 'Live screens could not be loaded.'))), []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);

  const sharingIn = (key: string) => status?.live[key]?.publishers || 0;
  const cards = useMemo<ScreenCard[]>(() => {
    const scrims: ScreenCard[] = (status?.scrims || []).map(room => ({ key: room.key, game: room.game, title: room.label, short: room.label, when: 'Scrim or test check-in', live: false, seats: room.players.map(p => ({ name: p.name, team: p.team })), crests: [], day: 'scrim', time: '', order: '2' }));
    const all = [...scheduledCards(brackets), ...scrims];
    all.sort((a, b) => Number(sharingIn(b.key) > 0) - Number(sharingIn(a.key) > 0) || a.order.localeCompare(b.order));
    // Facilitators see only the matches they are assigned to (the server filters status.staff for them).
    return status && !status.manage ? all.filter(card => card.key in status.staff) : all;
  }, [brackets, status]);

  const isNow = (card: ScreenCard) => card.live || sharingIn(card.key) > 0;
  const days = useMemo(() => {
    const list = [...new Set(cards.filter(card => card.day && card.day !== 'scrim').map(card => card.day))].sort();
    return list.map(key => ({ key, count: cards.filter(card => card.day === key).length }));
  }, [cards]);
  const nowCount = cards.filter(isNow).length;
  const scrimCount = cards.filter(card => card.day === 'scrim').length;
  const undated = cards.filter(card => !card.day).length;
  // Default day: what is happening now, else today, else the next match day.
  const fallbackDay = nowCount ? 'now' : days.find(item => item.key >= todayKey())?.key || days[0]?.key || (undated ? 'none' : scrimCount ? 'scrim' : '');
  const activeDay = day && (day === 'now' ? nowCount : day === 'scrim' ? scrimCount : day === 'none' ? undated : days.some(item => item.key === day)) ? day : fallbackDay;
  const inDay = cards.filter(card => activeDay === 'now' ? isNow(card) : activeDay === 'none' ? !card.day : card.day === activeDay);
  const games = (Object.keys(GAME_LABEL) as MonitorGame[]).filter(id => inDay.some(card => card.game === id));
  const shown = inDay.filter(card => !game || card.game === game || card.game === null);
  const totalSharing = cards.reduce((sum, card) => sum + sharingIn(card.key), 0);
  useEffect(() => { onSharingChange?.(totalSharing, cards.length); }, [totalSharing, cards.length]);

  // The 3D wall shows what is worth watching: every match with someone sharing, else the next few of this day.
  const deckKey = shown.slice(0, 8).map(card => `${card.key}:${sharingIn(card.key)}`).join('|');
  const deck = useMemo<DeckScreen[]>(() => {
    const lit = shown.filter(card => sharingIn(card.key) > 0);
    return (lit.length ? lit : shown).slice(0, 8).map(card => ({ key: card.key, title: card.title, game: card.game ? GAME_LABEL[card.game] : 'Scrim', when: card.when, sharing: sharingIn(card.key), seats: card.seats.length, live: !!card.live }));
  }, [deckKey]);
  const open = cards.find(card => card.key === openKey);
  const known = facilitators;

  // The open wall covers the whole screen like a call. It is rendered on <body>, because page sections animate
  // with transforms, and a transformed ancestor would trap a fixed overlay inside the section.
  if (open && status) return createPortal(<section className="lw-portal" aria-label="Live player screens">
    <Suspense fallback={<div className="lw-stage lw-call is-message"><div className="lw-area lw-message"><p role="status">Opening the live wall…</p></div></div>}>
      <LiveWall match={open} manage={status.manage} facilitators={status.staff[open.key] || []} onBack={() => onOpenKey('')}
        onEditFacilitators={status.manage ? () => setEditing(open) : undefined} onReport={onReport} />
    </Suspense>
    {editing && <AssignDialog match={editing} assigned={status.staff[editing.key] || []} known={known} onClose={() => setEditing(null)} onSaved={() => void refresh()} />}
  </section>, document.body);

  return <section className="ws" aria-label="Watch player screens">
    {error && <p role="alert" className="field-error">{error}</p>}
    {status && !status.configured && <p className="module-notice" role="status"><strong>Live screens are off.</strong> Add the LiveKit keys to the server (docs/LIVE_SCREENS.md).</p>}
    {status?.liveError && <p className="field-error" role="alert">{status.liveError}</p>}

    {(days.length > 0 || nowCount > 0 || scrimCount > 0 || undated > 0) && <nav className="ws-days" aria-label="Day">
      {nowCount > 0 && <button type="button" className="ws-day is-now" aria-pressed={activeDay === 'now'} onClick={() => setDay('now')}>
        <span className="ws-day-week"><i className="ws-pulse" aria-hidden="true" />Now</span><strong>{nowCount}</strong><small>{totalSharing ? `${totalSharing} sharing` : 'live'}</small>
      </button>}
      {days.map(item => { const parts = dayParts(item.key); return <button key={item.key} type="button" className={`ws-day${item.key === todayKey() ? ' is-today' : ''}`} aria-pressed={activeDay === item.key} onClick={() => setDay(item.key)}>
        <span className="ws-day-week">{item.key === todayKey() ? 'Today' : parts.week}</span><strong>{parts.num}</strong><small>{parts.month} · {item.count}</small>
      </button>; })}
      {undated > 0 && <button type="button" className="ws-day" aria-pressed={activeDay === 'none'} onClick={() => setDay('none')}>
        <span className="ws-day-week">No date</span><strong>{undated}</strong><small>not scheduled</small>
      </button>}
      {scrimCount > 0 && <button type="button" className="ws-day" aria-pressed={activeDay === 'scrim'} onClick={() => setDay('scrim')}>
        <span className="ws-day-week">Scrims</span><strong>{scrimCount}</strong><small>test rooms</small>
      </button>}
    </nav>}

    <ScreenDeck screens={deck} onSelect={onOpenKey} />

    {games.length > 1 && <div className="ws-games" role="group" aria-label="Game">
      <button type="button" className="ws-game is-all" aria-pressed={!game} onClick={() => setGame('')}><span>All</span></button>
      {games.map(id => <button key={id} type="button" className="ws-game" aria-pressed={game === id} onClick={() => setGame(game === id ? '' : id)}>
        <img src={GAME_ART[id]} alt="" loading="lazy" /><span>{GAME_LABEL[id]}</span><b>{inDay.filter(card => card.game === id).length}</b>
      </button>)}
    </div>}

    {!status ? <div className="ws-grid" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="ws-card is-skeleton" />)}</div>
      : !shown.length ? <p className="adp-empty">{status.manage ? 'No upcoming or live matches. Publish a schedule first.' : 'No matches for you yet. The organizer assigns them.'}</p>
      : <ul className="ws-grid" aria-label="Matches">{shown.map(card => {
        const live = status.live[card.key], staff = status.staff[card.key] || [], count = live?.publishers || 0;
        const seats = card.seats.length || (card.squads ? card.squads * 4 : 0);
        return <li key={card.key} className={`ws-card${count ? ' is-sharing' : ''}${card.live ? ' is-live' : ''}`}>
          {card.game && <img className="ws-card-art" src={GAME_ART[card.game]} alt="" loading="lazy" aria-hidden="true" />}
          <button type="button" className="ws-card-hit" onClick={() => onOpenKey(card.key)} aria-label={`Watch ${card.title}. ${count} of ${seats || 'all'} sharing.`}>
            <span className="ws-card-top">
              <span className="ws-time">{card.live ? <span className="ws-live-tag">Live</span> : card.time ? <>{card.time.replace(/\s?(AM|PM)$/i, '')}<small>{card.time.match(/(AM|PM)$/i)?.[0]}</small></> : <small>{card.when}</small>}</span>
              <span className="ws-card-name">{card.short}<small>{card.game ? GAME_LABEL[card.game] : 'Scrim'}</small></span>
            </span>
            {card.crests.length === 2 ? <span className="ws-vs">
              <span className="ws-side"><CrestBadge crest={card.crests[0]} /><span>{card.crests[0].name}</span></span>
              <i aria-hidden="true">vs</i>
              <span className="ws-side"><CrestBadge crest={card.crests[1]} /><span>{card.crests[1].name}</span></span>
            </span> : <span className="ws-lobby"><strong>{card.squads ? `${card.squads} squads` : card.title}</strong></span>}
            <span className="ws-seats" aria-hidden="true">
              {Array.from({ length: Math.min(seats || 10, 20) }, (_, i) => <i key={i} className={i < count ? 'is-on' : ''} />)}
            </span>
            <span className="ws-card-foot">
              <span className={`ws-share${count ? ' is-on' : ''}`}><Video size={14} aria-hidden="true" />{count ? `${count} sharing` : 'Waiting'}</span>
              {live?.state.paused && <span className="ws-share is-paused"><Pause size={13} aria-hidden="true" />Paused</span>}
              <span className="ws-watch">Watch</span>
            </span>
          </button>
          {(status.manage || staff.length > 0) && <div className="ws-staff">
            <span className="ws-stack" title={staff.length ? `Facilitators: ${staff.join(', ')}` : 'No facilitator yet'}>
              {staff.map(who => <span key={who} className="ws-avatar">{emailInitials(who)}</span>)}
            </span>
            {status.manage && <button type="button" className="ws-assign-btn" onClick={() => setEditing(card)} aria-label={`Facilitators for ${card.title}`}>
              {staff.length ? <Plus size={14} aria-hidden="true" /> : <><UserPlus size={14} aria-hidden="true" />Assign</>}
            </button>}
          </div>}
        </li>;
      })}</ul>}
    {editing && status && <AssignDialog match={editing} assigned={status.staff[editing.key] || []} known={known} onClose={() => setEditing(null)} onSaved={() => void refresh()} />}
  </section>;
}
