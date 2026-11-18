import React, { useState } from 'react';
import type { Match, Team } from '../../lib/types';
import { apiUrl } from '../../lib/apiBase';
import { FairPlayCenter } from './FairPlayCenter';

export function PlayerAntiCheat({ matches, teams, initialCaseId }: { matches: Match[]; teams?: Team[]; initialCaseId?: string | null; onSignIn?: () => void }) {
  const [code, setCode] = useState(''), [error, setError] = useState(''), [casesOpen, setCasesOpen] = useState(Boolean(initialCaseId));
  return <div className="module-page">
    <header className="dashboard-page-heading"><h1>Anti-cheat</h1><p>Run your required device scan before joining an official MLBB, CODM BR/MP or Dota 2 match.</p></header>
    <section className="operations-section">
      <h2>Scan before you play</h2>
      <ol className="scan-steps"><li><strong>Get your own match code.</strong> Your organizer creates a code linked to your roster slot. Never share a code with another player.</li><li><strong>Open ArenaHub Anti-cheat.</strong> Use the Android companion for MLBB/CODM, Safari on iPhone, or the Windows agent for Dota 2. Agree to monitoring on your device.</li><li><strong>Complete your device requirements.</strong> Android and Windows players wait for Scan passed and keep the companion running. iPhone players bring their playing device to a referee for inspection, recording and supervised clearance.</li></ol>
      <form className="module-form" onSubmit={event => { event.preventDefault(); const value = code.trim().toUpperCase(); if (!/^[A-Z2-9]{8}$/.test(value)) { setError('Enter the 8-character scan code from your organizer.'); return; } const origin = new URL(apiUrl('/api/integrity'), location.origin).origin; location.assign(`${origin}/join.html?c=${value}`); }}>
        <label>My match scan code<input required autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={8} value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setError(''); }} placeholder="ABCD2345" /></label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="operations-actions"><button className="arena-primary">Open my scan</button></div>
      </form>
      <p className="field-hint">No code yet? Ask tournament staff before your match. Staff can admit the match only when every roster player has a current passing scan.</p>
    </section>
    <section className="operations-section"><h2>Choose your device</h2><div className="operations-actions"><a className="arena-outline" href={apiUrl('/api/integrity/downloads/arenahub-companion.apk')}>Android companion</a><a className="arena-outline" href={apiUrl('/api/integrity/downloads/arenahub-agent.exe')}>Windows agent</a></div><p className="field-hint">Use only the verified download supplied by your tournament.</p><h3>iPhone anti-cheat</h3><p>Enter your match code above and agree in Safari. A referee checks your playing device, account, official game listing and device settings, then verifies recording and continuous supervision. Clearance lasts 15 minutes for admission and must be renewed if it expires before the match starts.</p><p className="field-hint">Keep supervision and recording throughout play. Return to staff if you change devices or supervision stops. iPhone installed-app and game-memory inspection are unavailable.</p></section>
    <details className="operations-section" open={casesOpen} onToggle={event => setCasesOpen(event.currentTarget.open)}><summary>Disputes and appeals</summary>{casesOpen && <FairPlayCenter matches={matches} teams={teams} initialCaseId={initialCaseId} />}</details>
  </div>;
}
