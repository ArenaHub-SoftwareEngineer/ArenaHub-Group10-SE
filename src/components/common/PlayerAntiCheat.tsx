import React, { useState } from 'react';
import type { Match, Team } from '../../lib/types';
import { apiUrl } from '../../lib/apiBase';
import { FairPlayCenter } from './FairPlayCenter';
import { ArrowRight, ChevronDown, Download, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { IOS_INDICATOR_KEYS, IOS_SIDELOAD_INDICATORS } from '../../lib/iosAntiCheat';

/** The player's anti-cheat page: enter the scan code, follow three steps, pick the device app. */
export function PlayerAntiCheat({ matches, teams, initialCaseId }: { matches: Match[]; teams?: Team[]; initialCaseId?: string | null; onSignIn?: () => void }) {
  const [code, setCode] = useState(''), [error, setError] = useState(''), [casesOpen, setCasesOpen] = useState(Boolean(initialCaseId));
  const apiOrigin = new URL(apiUrl('/api/integrity'), location.origin).origin;
  const isAndroid = /Android/i.test(navigator.userAgent);
  return <div className="module-page anticheat-page">
    <header className="dashboard-page-heading"><div><h1>Anti-cheat</h1><p>Run your required device scan before joining an official MLBB, CODM BR/MP or Dota 2 match.</p></div></header>

    <div className="anticheat-grid">
      <section className="operations-section anticheat-code" aria-labelledby="scan-title">
        <span className="anticheat-badge" aria-hidden="true"><ShieldCheck size={22} /></span>
        <h2 id="scan-title">Scan before you play</h2>
        <p>Enter the 8-character code your organizer gave you. It is linked to your roster slot, so never share it.</p>
        <form className="module-form anticheat-form" onSubmit={event => { event.preventDefault(); const value = code.trim().toUpperCase(); if (!/^[A-Z2-9]{8}$/.test(value)) { setError('Enter the 8-character scan code from your organizer.'); return; } const origin = new URL(apiUrl('/api/integrity'), location.origin).origin; location.assign(`${origin}/join.html?c=${value}`); }}>
          <label>My match scan code<input className="anticheat-code-input" required autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={8} value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setError(''); }} placeholder="ABCD2345" /></label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="arena-primary">Open my scan <ArrowRight size={16} aria-hidden="true" /></button>
        </form>
        <p className="field-hint">No code yet? Ask tournament staff before your match. Staff can admit the match only when every roster player has a current passing scan.</p>
      </section>

      <section className="operations-section" aria-labelledby="steps-title">
        <h2 id="steps-title">How it works</h2>
        <ol className="ah-steps">
          <li><strong>Get your own match code</strong><span>Your organizer creates one code per roster slot.</span></li>
          <li><strong>Open ArenaHub Anti-cheat</strong><span>Android companion for MLBB and CODM, Safari on iPhone, or the Windows agent for Dota 2. Agree to monitoring on your device.</span></li>
          <li><strong>Finish your device check</strong><span>Android and Windows: wait for Scan passed and keep the app running. iPhone: bring your playing device to a referee for inspection and supervised clearance.</span></li>
        </ol>
      </section>
    </div>

    <section className="anticheat-devices" aria-labelledby="devices-title">
      <h2 id="devices-title">Choose your device</h2>
      <div className="anticheat-device-grid">
        <article className="anticheat-device">
          <span className="anticheat-device-icon" aria-hidden="true"><Smartphone size={22} /></span>
          <strong>Android</strong><span>MLBB and CODM. Install the companion, then open your code.</span>
          <a className="arena-outline" href={apiUrl('/api/integrity/downloads/arenahub-companion.apk')}><Download size={16} aria-hidden="true" />Android companion</a>
        </article>
        <article className="anticheat-device">
          <span className="anticheat-device-icon" aria-hidden="true"><Monitor size={22} /></span>
          <strong>Windows</strong><span>Dota 2. Run the agent on the PC you play on.</span>
          <a className="arena-outline" href={apiUrl('/api/integrity/downloads/arenahub-agent.exe')}><Download size={16} aria-hidden="true" />Windows agent</a>
        </article>
        <article className="anticheat-device">
          <span className="anticheat-device-icon" aria-hidden="true"><Smartphone size={22} /></span>
          <strong>iPhone</strong><span>Enter your code in Safari and agree. A referee checks your device, account and settings, then supervises play. Clearance lasts 15 minutes and is renewed if it expires before the start.</span>
        </article>
      </div>
      <p className="field-hint">Use only the verified downloads supplied by your tournament. Keep supervision and recording on throughout play, and return to staff if you change devices. Installed-app and game-memory inspection are not available on iPhone.</p>
    </section>

    <section className="anticheat-devices" aria-labelledby="practice-title">
      <h2 id="practice-title">Practice before match day</h2>
      <p className="anticheat-lead">Check your own device any time, with no code. The practice scan uses the same rules as the official scan, saves nothing and does not count for a match. Fix anything it finds before you arrive.</p>
      <div className="anticheat-device-grid anticheat-practice-grid">
        <article className="anticheat-device">
          <span className="anticheat-device-icon" aria-hidden="true"><Monitor size={22} /></span>
          <strong>Windows</strong><span>One click checks this PC and shows the result on screen. Nothing leaves your PC. First time? Download the agent and open it once, then this button works.</span>
          <a className="arena-primary" href={`arenahub://practice?s=${encodeURIComponent(apiOrigin)}`}><ShieldCheck size={16} aria-hidden="true" />Scan this PC</a>
          <a className="arena-outline" href={apiUrl('/api/integrity/downloads/arenahub-agent.exe')}><Download size={16} aria-hidden="true" />First time: download the agent</a>
          <details className="anticheat-ios-checks">
            <summary>Start it by typing a command instead</summary>
            <code className="anticheat-command">arenahub-agent.exe --practice --server {apiOrigin}</code>
          </details>
        </article>
        <article className="anticheat-device">
          <span className="anticheat-device-icon" aria-hidden="true"><Smartphone size={22} /></span>
          <strong>Android</strong><span>Install the companion, then tap Practice scan and choose your game. The result appears in the app.</span>
          {isAndroid
            ? <a className="arena-outline" href={`intent://practice?s=${encodeURIComponent(apiOrigin)}#Intent;scheme=arenahub;package=ph.edu.wmsu.arenahub.companion;end`}><ShieldCheck size={16} aria-hidden="true" />Open practice scan</a>
            : <span className="anticheat-command-label">Server address for the app: <code className="anticheat-command">{apiOrigin}</code></span>}
        </article>
        <article className="anticheat-device">
          <span className="anticheat-device-icon" aria-hidden="true"><Smartphone size={22} /></span>
          <strong>iPhone</strong><span>Apple does not let any app check other apps, so a referee checks your iPhone by hand. Check these six things yourself first.</span>
          <details className="anticheat-ios-checks">
            <summary>The six referee checks</summary>
            <ol>{IOS_INDICATOR_KEYS.map(key => <li key={key}><strong>{IOS_SIDELOAD_INDICATORS[key].where}</strong><span>{IOS_SIDELOAD_INDICATORS[key].fix}</span></li>)}</ol>
          </details>
        </article>
      </div>
    </section>

    <details className="operations-section anticheat-cases" open={casesOpen} onToggle={event => setCasesOpen(event.currentTarget.open)}>
      <summary>Disputes and appeals<ChevronDown size={18} aria-hidden="true" /></summary>
      {casesOpen && <FairPlayCenter matches={matches} teams={teams} initialCaseId={initialCaseId} />}
    </details>
  </div>;
}
