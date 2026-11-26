import React, { useEffect, useState } from 'react';
import { useAuth, type AHUser } from '../../lib/authContext';
import { hasCampusEmail } from '../../lib/institution';
import { apiUrl } from '../../lib/apiBase';
import { antiCheatCall } from '../../lib/antiCheatApi';
import { takeAccountReturn } from '../../lib/emailLinks';
import { errorMessage } from '../../lib/errors';
import { GAME_LABEL, GAME_PLATFORMS, MONITOR_GAMES, PLATFORM_LABEL, type MonitorGame, type MonitorPlatform } from '../../lib/integrityRisk';
import { clockLabel, parseClock } from '../../lib/matchTiming';
import { Brand } from '../ui/Brand';
import { Req } from '../ui/Req';
import { AuthEntry } from './AuthEntry';
import './checkInMatch.css';

function playingDevice(): MonitorPlatform | null {
  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(agent) || (/Macintosh/.test(agent) && 'ontouchend' in document)) return 'ios';
  return /Windows/i.test(agent) ? 'pc' : null;
}
/** The staff screen shows one QR per device; the QR says which one it was. Empty for the plain link. */
function qrDevice(): MonitorPlatform | '' {
  const value = new URLSearchParams(location.search).get('device');
  return value === 'android' || value === 'ios' || value === 'pc' ? value : '';
}
const QR_NAME: Record<MonitorPlatform, string> = { android: 'Android', ios: 'iPhone', pc: 'Windows PC' };
/** A QR scanned with the wrong device: say which QR to scan instead. */
function WrongQr({ platform, wanted }: { platform: MonitorPlatform | null; wanted: MonitorPlatform }) {
  return <p role="alert">This QR is for <strong>{QR_NAME[wanted]}</strong>.{' '}
    {platform ? `You opened it on ${platform === 'ios' ? 'an iPhone' : platform === 'android' ? 'an Android phone' : 'a Windows PC'}. Scan the ${QR_NAME[platform]} QR on the organizer's screen instead.`
      : `Open it on the ${QR_NAME[wanted]} you play on.`}</p>;
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
    <legend><Req>Your match</Req></legend>
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

/** After check-in the device page takes over: Android app, PC agent, or the iPhone PRISM steps. */
function openDeviceSetup(pairing: { code: string; screenKey?: string }) {
  const target = new URL('/join.html', new URL(apiUrl('/api/integrity'), location.origin).origin);
  target.searchParams.set('c', pairing.code);
  if (pairing.screenKey) target.hash = new URLSearchParams({ screen: pairing.screenKey }).toString();
  location.replace(target.href);
}

interface MatchInfo { label: string; game: MonitorGame | null; gameLabel: string; codeLength: number; noSignIn?: boolean }
interface Seat { slot: string; name: string; team: string; college: string; taken: boolean; rejoin: boolean }
interface Identity { label: string; game: MonitorGame; gameLabel: string; platforms: MonitorPlatform[]; you: Seat | null; players: Seat[] }
const digitsOnly = (value: string, length: number) => value.replace(/[^0-9]/g, '').slice(0, length);

/** Match check-in: type the code on the organizer screen; the school email finds the player's roster seat.
 *  Without a profile this is a staff test check-in (sign-in switched off for this room): the player picks a
 *  roster name that has no school email, and the server marks the scan as a test that never passes. */
function MatchCheckInForm({ profile, path, match, onSignIn }: { profile?: AHUser; path: string; match: MatchInfo; onSignIn?: () => void }) {
  const { logout } = useAuth();
  const guest = !profile;
  const platform = playingDevice(), wanted = qrDevice();
  const [code, setCode] = useState(() => digitsOnly(new URLSearchParams(location.search).get('code') || '', match.codeLength));
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [slot, setSlot] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const wrongDevice = platform && match.game && !GAME_PLATFORMS[match.game].includes(platform);

  const identify = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (code.length !== match.codeLength || busy) { setError(`Type all ${match.codeLength} digits.`); return; }
    setBusy(true); setError('');
    try { setIdentity(await antiCheatCall<Identity>(`${path}/identify`, { body: { code }, guest })); }
    catch (err) { setError(errorMessage(err, 'That code did not work.')); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!identity || !platform || busy) return;
    setBusy(true); setError('');
    try { openDeviceSetup(await antiCheatCall<{ code: string; screenKey?: string }>(path, { body: { code, platform, ...(identity.you ? {} : { slot }) }, guest })); }
    catch (err) {
      const text = errorMessage(err, 'Check-in could not be completed.');
      setError(text); setBusy(false);
      // The code changed while they were confirming: ask for the new one.
      if (/code is wrong or has changed/i.test(text)) { setIdentity(null); setCode(''); }
    }
  };

  if (profile && !hasCampusEmail(profile.email)) return <>
    <p role="alert">Sign in with your verified school account to check in.</p>
    <button type="button" className="arena-outline" onClick={() => void logout()}>Use a different account</button>
  </>;
  if (wanted && wanted !== platform) return <WrongQr platform={platform} wanted={wanted} />;
  if (!platform) return <p>Open this link on the Android phone, iPhone, or Windows PC you play on.</p>;
  if (wrongDevice) return <p role="alert">{match.game === 'dota2' ? 'Dota 2 is checked on the Windows PC you play on. Open this link on that PC.' : `${match.gameLabel} is checked on the phone you play on. Open this link on that phone.`}</p>;

  const seat = identity?.you || identity?.players.find(item => item.slot === slot) || null;
  return <>
    {guest && <p className="module-error checkin-test-note" role="status"><strong>Test check-in.</strong> You are not signed in, so this scan is only a test and does not count as a pass.</p>}
    <div className="checkin-match-card"><small>{match.gameLabel} · {QR_NAME[platform]} setup</small><strong>{match.label}</strong></div>
    {!identity ? <form className="module-form text-left w-full" aria-busy={busy} onSubmit={identify}>
      <label>Check-in code
        <input className="checkin-code" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={match.codeLength} autoFocus
          placeholder={'0'.repeat(match.codeLength)} aria-describedby="checkin-code-hint"
          onChange={event => setCode(digitsOnly(event.target.value, match.codeLength))} />
      </label>
      <p id="checkin-code-hint" className="field-hint">The {match.codeLength}-digit code on the organizer’s screen. It changes every 3 minutes.</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <button className="arena-primary" disabled={busy || code.length !== match.codeLength}>{busy ? 'Checking…' : 'Continue'}</button>
    </form> : <div className="checkin-identity text-left w-full">
      {identity.you && profile ? <>
        <p className="field-hint">Found you on the roster from <strong>{profile.email}</strong>.</p>
        <div className="checkin-seat"><strong>{identity.you.name}</strong><span>{[identity.you.team, identity.you.college].filter(Boolean).join(' · ')}</span></div>
        {identity.you.taken && <p role="alert" className="field-error">You are already checked in on another device. Ask the referee to reset you.</p>}
        {identity.you.rejoin && <p className="field-hint">You already checked in. Continuing restarts your device setup on this device.</p>}
      </> : identity.players.length ? <label className="module-form"><Req>Your name</Req>
        <select value={slot} onChange={event => setSlot(event.target.value)} required>
          <option value="">Choose your name</option>
          {identity.players.map(item => <option key={item.slot} value={item.slot} disabled={item.taken}>{item.name}{item.team ? ` (${item.team})` : ''}{item.taken ? ' - checked in' : ''}</option>)}
        </select>
        <span className="field-hint">{guest ? 'Names linked to a school email need that account, so they are not listed. Your organizer will see that you chose your name.' : 'Your school email is not on this roster yet, so choose your name. Your organizer will see that you chose it.'}</span>
      </label> : <p role="alert" className="field-error">{guest ? 'Every player on this roster has a school email, so sign in to check in.' : `${profile?.email} is not on this match roster. Ask your organizer to add your school email to the team roster.`}</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
      <p className="field-hint">{PLATFORM_LABEL[platform]} detected.</p>
      <button type="button" className="arena-primary" disabled={busy || !seat || seat.taken} onClick={() => void confirm()}>{busy ? 'Checking in…' : seat ? `I am ${seat.name}, set up my device` : 'Set up my device'}</button>
      <button type="button" className="auth-flow-text" disabled={busy} onClick={() => { setIdentity(null); setSlot(''); setError(''); }}>Type a different code</button>
    </div>}
    {guest ? <button type="button" className="auth-flow-text" disabled={busy} onClick={onSignIn}>Sign in instead</button>
      : <button type="button" className="auth-flow-text" disabled={busy} onClick={() => void logout()}>Not you? Use a different account</button>}
  </>;
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
      openDeviceSetup(await antiCheatCall<{ code: string; screenKey?: string }>(path, { body: { name, team, college, game, platform, ...(matchId !== NO_MATCH ? { matchId } : {}) } }));
    } catch (err) {
      setError(errorMessage(err, 'Check-in could not be completed.'));
      setBusy(false);
    }
  };

  if (!hasCampusEmail(profile.email)) return <>
    <p role="alert">Sign in with your verified school account to check in.</p>
    <button type="button" className="arena-outline" onClick={() => void logout()}>Use a different account</button>
  </>;
  const wanted = qrDevice();
  if (wanted && wanted !== platform) return <WrongQr platform={platform} wanted={wanted} />;
  if (!platform) return <p>Open this link on the Android phone, iPhone, or Windows PC you play on.</p>;
  return <>
    <p>Verified school account <strong>{profile.email}</strong></p>
    <form className="module-form text-left w-full" aria-busy={busy} onSubmit={submit}>
      <label><Req>In-game name</Req><input name="name" autoComplete="nickname" minLength={2} maxLength={60} required /></label>
      <label><Req>Team</Req><input name="team" minLength={2} maxLength={80} required /></label>
      <label><Req>College</Req><input name="college" defaultValue={profile.collegeName} minLength={2} maxLength={80} required /></label>
      <label><Req>Game</Req><select value={game} onChange={event => setGame(event.target.value as MonitorGame)} required>
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
  const [match, setMatch] = useState<MatchInfo | null>(null);
  // A test check-in without sign-in still lets a player choose to sign in (their scan then counts).
  const [signIn, setSignIn] = useState(false);
  useEffect(() => {
    if (!secure) return;
    if (!/^[A-Za-z0-9_-]{12}$/.test(id)) { setState('closed'); return; }
    const controller = new AbortController();
    fetch(apiUrl(`/api/integrity${path}`), { signal: controller.signal })
      .then(async response => {
        if (response.ok) setMatch(((await response.json().catch(() => ({}))) as { match?: MatchInfo }).match || null);
        setState(response.ok ? 'open' : response.status === 404 ? 'closed' : 'unreachable');
      })
      .catch(() => { if (!controller.signal.aborted) setState('unreachable'); });
    return () => controller.abort();
  }, [id, path, secure]);
  // Signed out on an open check-in: the landing page with sign-in open. The address keeps ?room and ?code,
  // so once the player signs in this same page shows the check-in. Staff can switch sign-in off per room for tests.
  if (!profile && state === 'open' && (signIn || !match?.noSignIn)) return <AuthEntry checkIn={{ match: match?.label || '', accountReturn: notice }} />;
  return <main className="auth-status-screen">
    <section className="auth-status-card">
      <Brand />
      <h1>Player check-in</h1>
      {!secure && <p role="alert">Open the HTTPS check-in link from your organizer.</p>}
      {secure && state === 'loading' && <p role="status">Checking your link…</p>}
      {state === 'closed' && <p role="alert">This link has expired or closed. Ask your organizer for the current QR.</p>}
      {state === 'unreachable' && <><p role="alert">The check-in service could not be reached.</p><button type="button" className="arena-outline" onClick={() => location.reload()}>Try again</button></>}
      {state === 'open' && (profile ? (match ? <MatchCheckInForm profile={profile} path={path} match={match} /> : <PlayerForm profile={profile} path={path} />)
        : match?.noSignIn && <MatchCheckInForm path={path} match={match} onSignIn={() => setSignIn(true)} />)}
    </section>
  </main>;
}
