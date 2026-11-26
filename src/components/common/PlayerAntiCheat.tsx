import React, { useState } from 'react';
import type { Match, Team } from '../../lib/types';
import { apiUrl } from '../../lib/apiBase';
import { FairPlayCenter } from './FairPlayCenter';
import { GameArtworkTiles } from './GameArtworkTiles';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { IOS_INDICATOR_KEYS, IOS_SIDELOAD_INDICATORS, type IosIndicator } from '../../lib/iosAntiCheat';
import { GAME_LABEL, GAME_PLATFORMS, PLATFORM_LABEL, type MonitorGame, type MonitorPlatform } from '../../lib/integrityRisk';

const STEPS = ['Game', 'Device', 'Practice', 'Check in'] as const;
const DEVICE_HINT: Record<MonitorPlatform, string> = {
  android: 'Uses the ArenaHub companion app.',
  ios: 'Uses Safari and a referee check.',
  pc: 'Uses the ArenaHub agent for Windows.',
};

/** Which device this page is open on, so the matching choice can be marked. */
function thisDevice(): MonitorPlatform {
  if (/Android/i.test(navigator.userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios';
  return 'pc';
}

/**
 * The player's anti-cheat page, one step at a time (the same rail as the staff check-in):
 * choose a game, then the device you play on, then an optional practice scan, then match-day check-in.
 */
export function PlayerAntiCheat({ matches, teams, initialCaseId }: { matches: Match[]; teams?: Team[]; initialCaseId?: string | null; onSignIn?: () => void }) {
  const [casesOpen, setCasesOpen] = useState(Boolean(initialCaseId));
  const [game, setGame] = useState<MonitorGame | ''>('');
  const [device, setDevice] = useState<MonitorPlatform | ''>('');
  const [checkIn, setCheckIn] = useState(false);
  const [iosChecked, setIosChecked] = useState<IosIndicator[]>([]);
  const apiOrigin = new URL(apiUrl('/api/integrity'), location.origin).origin;
  const androidDownload = new URL(apiUrl('/api/integrity/downloads/arenahub-companion.apk'), location.origin).href;
  const agentDownload = apiUrl('/api/integrity/downloads/arenahub-agent.exe');
  const here = thisDevice();

  const step = !game ? 1 : !device ? 2 : !checkIn ? 3 : 4;
  const devices = game ? GAME_PLATFORMS[game] : [];
  const pickGame = (id: MonitorGame) => {
    setGame(id);
    // Dota 2 is played on PC only, so there is nothing to choose.
    setDevice(GAME_PLATFORMS[id].length === 1 ? GAME_PLATFORMS[id][0] : '');
    setCheckIn(false);
  };
  const goTo = (target: number) => {
    if (target <= 1) { setGame(''); setDevice(''); setCheckIn(false); }
    else if (target === 2 && devices.length > 1) { setDevice(''); setCheckIn(false); }
    else if (target <= 3) setCheckIn(false);
  };
  const back = () => goTo(step === 3 && devices.length === 1 ? 1 : step - 1);
  // The Android app knows MLBB and CODM; both CODM modes share one scan.
  const practiceGame = game === 'mlbb' ? 'mlbb' : 'codm-mp';
  const showJoinLink = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || apiOrigin !== location.origin;

  return <div className="module-page anticheat-page">
    <header className="dashboard-page-heading"><div><h1>Anti-cheat</h1><p>Get your device cleared before an official match. Follow the steps one at a time.</p></div></header>

    <section className="operations-section anticheat-flow" aria-labelledby="anticheat-step-title">
      <ol className="anticheat-steps" aria-label="Steps">
        {STEPS.map((label, i) => {
          const n = i + 1, done = step > n, skipped = n === 2 && devices.length === 1;
          const text = n === 1 && game ? GAME_LABEL[game] : n === 2 && device ? PLATFORM_LABEL[device] : label;
          return <li key={label} className={step === n ? 'is-current' : done ? 'is-done' : ''} aria-current={step === n ? 'step' : undefined}>
            {done && !skipped
              ? <button type="button" onClick={() => goTo(n)} aria-label={`Change ${label.toLowerCase()}: ${text}`}><span><Check size={13} aria-hidden="true" /></span>{text}</button>
              : <><span>{done ? <Check size={13} aria-hidden="true" /> : n}</span>{text}</>}
          </li>;
        })}
      </ol>

      {step > 1 && <button type="button" className="anticheat-back" onClick={back}><ArrowLeft size={16} aria-hidden="true" />Back</button>}

      {step === 1 && <div className="anticheat-step">
        <h2 id="anticheat-step-title">Which game are you playing?</h2>
        <p className="anticheat-lead">MLBB, CODM and Dota 2 matches need a device check before play.</p>
        <GameArtworkTiles label="Choose your game" onSelect={id => pickGame(id as MonitorGame)} compact
          meta={{ mlbb: 'Android or iPhone', 'codm-mp': 'Android or iPhone', 'codm-br': 'Android or iPhone', dota2: 'Windows PC' }} />
      </div>}

      {step === 2 && game && <div className="anticheat-step">
        <h2 id="anticheat-step-title">Which device do you play {GAME_LABEL[game]} on?</h2>
        <p className="anticheat-lead">Choose the phone you will hold during the match.</p>
        <div className="anticheat-choice-grid">
          {devices.map(id => <button key={id} type="button" className="anticheat-choice" onClick={() => setDevice(id)}>
            <span className="anticheat-device-icon" aria-hidden="true">{id === 'pc' ? <Monitor size={22} /> : <Smartphone size={22} />}</span>
            <strong>{PLATFORM_LABEL[id]}{id === here && <span className="status-pill is-success">This device</span>}</strong>
            <span>{DEVICE_HINT[id]}</span>
            <ArrowRight size={18} aria-hidden="true" className="anticheat-choice-arrow" />
          </button>)}
        </div>
      </div>}

      {step === 3 && game && device && <div className="anticheat-step">
        <h2 id="anticheat-step-title">Practice first (optional)</h2>
        {device === 'pc' && <>
          <p className="anticheat-lead">One click checks this PC and shows the result on screen. Nothing leaves your PC.</p>
          <ol className="anticheat-todo">
            <li>First time only: <a href={agentDownload}><Download size={14} aria-hidden="true" />download the agent</a> and open it once.</li>
            <li>Then press <strong>Scan this PC</strong>.</li>
          </ol>
          <a className="arena-primary" href={`arenahub://practice?s=${encodeURIComponent(apiOrigin)}`}><ShieldCheck size={16} aria-hidden="true" />Scan this PC</a>
          <details className="anticheat-ios-checks">
            <summary>The button does nothing? Type a command instead</summary>
            <code className="anticheat-command">arenahub-agent.exe --practice --server {apiOrigin}</code>
          </details>
        </>}
        {device === 'android' && <>
          <p className="anticheat-lead">Check your phone without a code. The result appears in the companion app.</p>
          <ol className="anticheat-todo">
            <li>First time only: <a href={androidDownload}><Download size={14} aria-hidden="true" />install the companion</a>.</li>
            <li>Then press <strong>Open practice scan</strong>.</li>
          </ol>
          {here === 'android'
            ? <a className="arena-primary" href={`intent://practice?s=${encodeURIComponent(apiOrigin)}&g=${practiceGame}#Intent;scheme=arenahub;package=ph.edu.wmsu.arenahub.companion;S.browser_fallback_url=${encodeURIComponent(androidDownload)};end`}><ShieldCheck size={16} aria-hidden="true" />Open practice scan</a>
            : <p className="module-notice">Open this page on your Android phone to start the practice scan. Server address for the app: <code className="anticheat-command">{apiOrigin}</code></p>}
        </>}
        {device === 'ios' && <>
          <p className="anticheat-lead">iPhones cannot be scanned by an app, so a referee checks six settings. Review them now so nothing holds you up.</p>
          <ol className="anticheat-ios-list">{IOS_INDICATOR_KEYS.map(key => <li key={key}>
            <label><input type="checkbox" checked={iosChecked.includes(key)} onChange={event => {
              const checked = event.currentTarget.checked;
              setIosChecked(previous => checked ? [...previous, key] : previous.filter(item => item !== key));
            }} /> <strong>{IOS_SIDELOAD_INDICATORS[key].where}</strong></label>
            <span>{IOS_SIDELOAD_INDICATORS[key].fix}</span>
          </li>)}</ol>
          <p className="field-hint" role="status">{iosChecked.length} of {IOS_INDICATOR_KEYS.length} reviewed.</p>
        </>}
        <div className="anticheat-next">
          <button type="button" className="arena-outline" onClick={() => setCheckIn(true)}>Next: match-day check-in<ArrowRight size={16} aria-hidden="true" /></button>
        </div>
      </div>}

      {step === 4 && game && device && <div className="anticheat-step">
        <h2 id="anticheat-step-title">On match day: check in</h2>
        <p className="anticheat-lead">Staff show a QR and an 8-digit code before your {GAME_LABEL[game]} match. Do this on the {device === 'pc' ? 'PC' : 'phone'} you play on.</p>
        <ol className="anticheat-todo">
          <li>{device === 'pc' ? 'Open the check-in link on this PC.' : `Scan the ${PLATFORM_LABEL[device]} QR${device === 'ios' ? ' with the Camera, and open it in Safari' : ''}.`}</li>
          <li>Sign in with your verified school account and type the code.</li>
          {device === 'android' && <li>Tap <strong>Agree and start scan</strong>. Keep the companion running until it says Scan passed.</li>}
          {device === 'pc' && <li>Click <strong>Start my scan</strong>. Keep the agent running until it says Scan passed.</li>}
          {device === 'ios' && <li>Confirm your phone settings, then share your screen with the match staff. A referee may still check your phone.</li>}
        </ol>
        {showJoinLink && <a className="arena-primary" href={`${apiOrigin}/join.html`}>Open room check-in<ArrowRight size={16} aria-hidden="true" /></a>}
        <p className="field-hint">Use only the downloads from this page. If you change devices, tell the match staff and check in again.</p>
      </div>}
    </section>

    <details className="operations-section anticheat-cases" open={casesOpen} onToggle={event => setCasesOpen(event.currentTarget.open)}>
      <summary>Disputes and appeals<ChevronDown size={18} aria-hidden="true" /></summary>
      {casesOpen && <FairPlayCenter matches={matches} teams={teams} initialCaseId={initialCaseId} />}
    </details>
  </div>;
}
