import React, { useState } from 'react';
import type { Match, Team } from '../../lib/types';
import { apiUrl } from '../../lib/apiBase';
import { FairPlayCenter } from './FairPlayCenter';
import { ArrowRight, ChevronDown, Download, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { IOS_INDICATOR_KEYS, IOS_SIDELOAD_INDICATORS, type IosIndicator } from '../../lib/iosAntiCheat';

/** The player's anti-cheat page: join the shared room or practice on this device. */
export function PlayerAntiCheat({ matches, teams, initialCaseId }: { matches: Match[]; teams?: Team[]; initialCaseId?: string | null; onSignIn?: () => void }) {
  const [casesOpen, setCasesOpen] = useState(Boolean(initialCaseId));
  const [iosChecked, setIosChecked] = useState<IosIndicator[]>([]);
  const apiOrigin = new URL(apiUrl('/api/integrity'), location.origin).origin;
  const androidDownload = new URL(apiUrl('/api/integrity/downloads/arenahub-companion.apk'), location.origin).href;
  const isAndroid = /Android/i.test(navigator.userAgent);
  return <div className="module-page anticheat-page">
    <header className="dashboard-page-heading"><div><h1>Anti-cheat</h1><p>Run your required device scan before joining an official MLBB, CODM BR/MP or Dota 2 match.</p></div></header>

    <div className="anticheat-grid">
      <section className="operations-section anticheat-code" aria-labelledby="scan-title">
        <span className="anticheat-badge" aria-hidden="true"><ShieldCheck size={22} /></span>
        <h2 id="scan-title">Scan before you play</h2>
        <p>Open the organizer’s check-in QR or link on the device you play on. Sign in with your verified school account and enter your player details.</p>
        {/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || apiOrigin !== location.origin
          ? <a className="arena-primary" href={`${apiOrigin}/join.html`}>Open room check-in <ArrowRight size={16} aria-hidden="true" /></a> : null}
        <p className="field-hint">For a Dota 2 match, open the organizer’s check-in link on the Windows PC you play on.</p>
      </section>

      <section className="operations-section" aria-labelledby="steps-title">
        <h2 id="steps-title">How it works</h2>
        <ol className="ah-steps">
          <li><strong>Check in</strong><span>Use the shared link and choose your game.</span></li>
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
          <strong>Android</strong><span>MLBB and CODM. Join the room and follow the steps to open the companion.</span>
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
      <p className="anticheat-lead">Check your device without a code. A practice result shows which checks ran and any findings to review. Match clearance is completed with your referee or match code.</p>
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
            ? <a className="arena-outline" href={`intent://practice?s=${encodeURIComponent(apiOrigin)}#Intent;scheme=arenahub;package=ph.edu.wmsu.arenahub.companion;S.browser_fallback_url=${encodeURIComponent(androidDownload)};end`}><ShieldCheck size={16} aria-hidden="true" />Open practice scan</a>
            : <span className="anticheat-command-label">Server address for the app: <code className="anticheat-command">{apiOrigin}</code></span>}
        </article>
        <article className="anticheat-device">
          <span className="anticheat-device-icon" aria-hidden="true"><Smartphone size={22} /></span>
          <strong>iPhone</strong><span>Use the checklist to review your settings. A referee checks your device for match clearance.</span>
          <details className="anticheat-ios-checks">
            <summary>The six referee checks</summary>
            <ol>{IOS_INDICATOR_KEYS.map(key => <li key={key}>
              <label><input type="checkbox" checked={iosChecked.includes(key)} onChange={event => {
                const checked = event.currentTarget.checked;
                setIosChecked(previous => checked ? [...previous, key] : previous.filter(item => item !== key));
              }} /> {IOS_SIDELOAD_INDICATORS[key].where}</label>
              <span>{IOS_SIDELOAD_INDICATORS[key].fix}</span>
            </li>)}</ol>
            <p className="field-hint" role="status">{iosChecked.length} of {IOS_INDICATOR_KEYS.length} reviewed. A referee grants match clearance.</p>
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
