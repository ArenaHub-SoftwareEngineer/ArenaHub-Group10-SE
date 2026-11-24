import React, { useEffect, useState } from 'react';
import { useAuth, type AHUser } from '../../lib/authContext';
import { hasCampusEmail } from '../../lib/institution';
import { apiUrl } from '../../lib/apiBase';
import { antiCheatCall } from '../../lib/antiCheatApi';
import { ACCOUNT_RETURN_MESSAGE, takeAccountReturn } from '../../lib/emailLinks';
import { errorMessage } from '../../lib/errors';
import { GAME_LABEL, GAME_PLATFORMS, MONITOR_GAMES, PLATFORM_LABEL, type MonitorGame, type MonitorPlatform } from '../../lib/integrityRisk';
import { clockLabel, parseClock } from '../../lib/matchTiming';
import { Brand } from '../ui/Brand';
import { AuthScreen } from './AuthScreen';
import './checkInMatch.css';

function playingDevice(): MonitorPlatform | null {
  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(agent) || (/Macintosh/.test(agent) && 'ontouchend' in document)) return 'ios';
  return /Windows/i.test(agent) ? 'pc' : null;
}

interface ScheduledMatch { id: string; label: string; date: string; time: string; live: boolean }
const NO_MATCH = 'none';
const whenLabel = (match: ScheduledMatch) => {
  const minutes = match.time ? parseClock(match.time) : null;
  const day = match.date ? new Date(match.date + 'T00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
  return match.live ? 'Live now' : [day, minutes === null ? '' : clockLabel(minutes)].filter(Boolean).join(', ') || 'Time not set';
};

/** The match decides which facilitators see this player's live screen. */
function MatchChoice({ path, game, value, onChange }: { path: string; game: MonitorGame | ''; value: string; onChange: (id: string) => void }) {
  const [matches, setMatches] = useState<ScheduledMatch[] | null>(null), [error, setError] = useState('');
  useEffect(() => {
    if (!game) return;
    let live = true;
    setMatches(null); setError(''); onChange('');
    antiCheatCall<ScheduledMatch[]>(`${path}/matches?game=${game}`)
      .then(list => { if (live) { setMatches(list); if (!list.length) onChange(NO_MATCH); } })
      .catch(err => { if (live) { setError(errorMessage(err, 'Your matches could not be loaded.')); setMatches([]); onChange(NO_MATCH); } });
    return () => { live = false; };
  }, [game, path]);
  if (!game) return null;
  return <fieldset className="checkin-matches">
    <legend>Your match</legend>
    {!matches && <p className="field-hint" role="status">Loading the schedule…</p>}
    {error && <p className="field-hint" role="status">{error} You can still check in.</p>}
    {matches?.map(match => <label key={match.id} className={value === match.id ? 'is-active' : ''}>
      <input type="radio" name="match" value={match.id} required checked={value === match.id} onChange={() => onChange(match.id)} />
      <span><strong>{match.label}</strong><small className={match.live ? 'is-live' : ''}>{whenLabel(match)}</small></span>
    </label>)}
    {matches && <label className={value === NO_MATCH ? 'is-active' : ''}>
      <input type="radio" name="match" value={NO_MATCH} required checked={value === NO_MATCH} onChange={() => onChange(NO_MATCH)} />
      <span><strong>Not on the schedule</strong><small>Scrim or practice</small></span>
    </label>}
  </fieldset>;
}

function PlayerForm({ profile, path }: { profile: AHUser; path: string }) {
  const { logout } = useAuth();
  const platform = playingDevice();
  const games = platform ? MONITOR_GAMES.filter(game => GAME_PLATFORMS[game].includes(platform)) : [];
  const [game, setGame] = useState<MonitorGame | ''>(() => games.length === 1 ? games[0] : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [matchId, setMatchId] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!game || !platform || !matchId || busy) return;
    const { name, team, college } = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError('');
    try {
      const pairing = await antiCheatCall<{ code: string; screenKey?: string }>(path, { body: { name, team, college, game, platform, ...(matchId !== NO_MATCH ? { matchId } : {}) } });
      const target = new URL('/join.html', new URL(apiUrl('/api/integrity'), location.origin).origin);
      target.searchParams.set('c', pairing.code);
      if (pairing.screenKey) target.hash = new URLSearchParams({ screen: pairing.screenKey }).toString();
      location.replace(target.href);
    } catch (err) {
      setError(errorMessage(err, 'Check-in could not be completed.'));
      setBusy(false);
    }
  };

  if (!hasCampusEmail(profile.email)) return <>
    <p role="alert">Sign in with your verified school account to check in.</p>
    <button type="button" className="arena-outline" onClick={() => void logout()}>Use a different account</button>
  </>;
  if (!platform) return <p>Open this link on the Android phone, iPhone, or Windows PC you play on.</p>;
  return <>
    <p>Verified school account <strong>{profile.email}</strong></p>
    <form className="module-form text-left w-full" aria-busy={busy} onSubmit={submit}>
      <label>In-game name<input name="name" autoComplete="nickname" minLength={2} maxLength={60} required /></label>
      <label>Team<input name="team" minLength={2} maxLength={80} required /></label>
      <label>College<input name="college" defaultValue={profile.collegeName} minLength={2} maxLength={80} required /></label>
      <label>Game<select value={game} onChange={event => setGame(event.target.value as MonitorGame)} required>
        <option value="">Choose your game</option>
        {games.map(item => <option key={item} value={item}>{GAME_LABEL[item]}</option>)}
      </select></label>
      <MatchChoice path={path} game={game} value={matchId} onChange={setMatchId} />
      <p className="field-hint">{PLATFORM_LABEL[platform]} detected.{platform !== 'pc' && ' For Dota 2, open the link on your Windows playing PC.'}</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <button className="arena-primary" disabled={busy || !matchId}>{busy ? 'Checking in…' : 'Continue to device scan'}</button>
    </form>
    <button type="button" className="auth-flow-text" disabled={busy} onClick={() => void logout()}>Use a different account</button>
  </>;
}

export default function PlayerCheckIn({ profile }: { profile?: AHUser }) {
  const [notice] = useState(takeAccountReturn);
  const id = new URLSearchParams(location.search).get('room') || '';
  const path = `/device/checkin/${encodeURIComponent(id)}`;
  const secure = window.isSecureContext;
  const [state, setState] = useState<'loading' | 'open' | 'closed' | 'unreachable'>('loading');
  useEffect(() => {
    if (!secure) return;
    if (!/^[A-Za-z0-9_-]{12}$/.test(id)) { setState('closed'); return; }
    const controller = new AbortController();
    fetch(apiUrl(`/api/integrity${path}`), { signal: controller.signal })
      .then(response => setState(response.ok ? 'open' : response.status === 404 ? 'closed' : 'unreachable'))
      .catch(() => { if (!controller.signal.aborted) setState('unreachable'); });
    return () => controller.abort();
  }, [id, path, secure]);
  return <main className="auth-status-screen">
    <section className="auth-status-card">
      <Brand />
      <h1>Player check-in</h1>
      {!secure && <p role="alert">Open the HTTPS check-in link from your organizer.</p>}
      {secure && state === 'loading' && <p role="status">Checking your link…</p>}
      {state === 'closed' && <p role="alert">This link has expired or closed. Ask your organizer for the current QR.</p>}
      {state === 'unreachable' && <><p role="alert">The check-in service could not be reached.</p><button type="button" className="arena-outline" onClick={() => location.reload()}>Try again</button></>}
      {state === 'open' && (profile ? <PlayerForm profile={profile} path={path} /> : <>
        <p>Sign in with your school account to verify your identity and start the device scan.</p>
        <AuthScreen initialNotice={notice ? ACCOUNT_RETURN_MESSAGE[notice] : ''} playerCheckIn />
      </>)}
    </section>
  </main>;
}
