import React, { useEffect, useState } from 'react';
import { antiCheatCall } from '../../lib/antiCheatApi';
import type { MatchScanReadiness } from '../../lib/preMatchScan';

export function PreMatchScanPanel({ matchId: id }: { matchId: string }) {
  const [readiness, setReadiness] = useState<MatchScanReadiness | null>(null), [error, setError] = useState('');
  useEffect(() => {
    setReadiness(null); setError('');
    if (!id) return;
    let active = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await antiCheatCall<MatchScanReadiness>(`/matches/${encodeURIComponent(id)}/readiness`);
        if (active) {
          setReadiness(data); setError('');
        }
      } catch (error) {
        if (active) { setError((error as Error).message); setReadiness(null); }
      } finally { loading = false; }
    };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);
  return <section className="operations-section scan-admission" aria-label="Required pre-match scans">
    <div className="feature-section-bar"><h3>Match readiness</h3></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {id && !readiness && !error && <p role="status">Checking the published roster…</p>}
    {readiness && <>
      <p className="scan-progress" role="status"><strong>{readiness.ready} of {readiness.total} players ready</strong><span>{readiness.canStart ? 'Everyone has passed' : 'Waiting on scans'}</span></p>
      <ul className="scan-roster">{readiness.players.map(player => <li key={player.playerKey}>
        <div><strong>{player.playerName}</strong><p className="field-hint">{player.team}</p></div>
        <div><span className={`scan-status scan-${player.scan.status}`}>{player.scan.label}</span><p className="field-hint">{player.scan.detail}</p>{player.scan.blockers.length > 0 && <ul>{player.scan.blockers.slice(0, 5).map((reason, index) => <li key={index}>{reason}</li>)}</ul>}{player.scan.blockers.length > 5 && <p className="field-hint">{player.scan.blockers.length - 5} more restricted entries. Open the player scan below for the full findings.</p>}{player.scan.warnings.length > 0 && <p className="field-hint">Other observations: {player.scan.warnings.slice(0, 3).join(' ')}</p>}</div>
      </li>)}</ul>
      <p className="field-hint">Companion scans check configured indicators. iPhone clearance requires a referee inspection, continuous supervision and recording. Read each player's coverage and clearance status before starting.</p>
    </>}
  </section>;
}
