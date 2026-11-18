import React, { useEffect, useState } from 'react';
import { antiCheatCall } from '../../lib/antiCheatApi';
import type { Match } from '../../lib/types';
import type { MatchScanReadiness } from '../../lib/preMatchScan';

export function PreMatchScanPanel({ matches, onPair }: { matches: Match[]; onPair: (matchId: string, playerKey: string, name: string, team: string) => void }) {
  const [id, setId] = useState(''), [readiness, setReadiness] = useState<MatchScanReadiness | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    setReadiness(null); setNotice(''); setError('');
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
          if (!data.canStart) setNotice('');
        }
      } catch (error) {
        if (active) { setError((error as Error).message); setReadiness(null); setNotice(''); }
      } finally { loading = false; }
    };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);
  return <section className="operations-section scan-admission" aria-label="Required pre-match scans">
    <div className="feature-section-bar"><div><h2>Before players join</h2><p>Every roster player needs a current companion scan or supervised iPhone clearance. Inspect iPhones in their player sessions and keep Android/Windows companions running.</p></div></div>
    <div className="module-form"><label>Match to clear for play<select value={id} disabled={busy} onChange={e => setId(e.target.value)}><option value="">Choose a published match</option>{matches.map(match => <option key={match.id} value={match.id}>{match.lobby ? `${match.roundName} - ${match.lobby.squads} squads` : `${match.matchNumber} - ${match.team1?.name} vs ${match.team2?.name}`}</option>)}</select></label></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {id && !readiness && !error && <p role="status">Checking the published roster…</p>}
    {readiness && <>
      <p className="scan-progress" role="status"><strong>{readiness.ready} of {readiness.total} players ready</strong><span>{readiness.canStart ? 'Scan requirements met' : 'Match admission is locked'}</span></p>
      <ul className="scan-roster">{readiness.players.map(player => <li key={player.playerKey}>
        <div><strong>{player.playerName}</strong><p className="field-hint">{player.team}</p></div>
        <div><span className={`scan-status scan-${player.scan.status}`}>{player.scan.label}</span><p className="field-hint">{player.scan.detail}</p>{player.scan.blockers.length > 0 && <ul>{player.scan.blockers.slice(0, 5).map((reason, index) => <li key={index}>{reason}</li>)}</ul>}{player.scan.blockers.length > 5 && <p className="field-hint">{player.scan.blockers.length - 5} more restricted entries. Open the player scan below for the full findings.</p>}{player.scan.warnings.length > 0 && <p className="field-hint">Other observations: {player.scan.warnings.slice(0, 3).join(' ')}</p>}</div>
        <button type="button" className="arena-outline" onClick={() => onPair(id, player.playerKey, player.playerName, player.team)}>{player.sessionId ? 'New scan code' : 'Scan player'}</button>
      </li>)}</ul>
      <div className="operations-actions"><button type="button" className="arena-primary" disabled={!readiness.canStart || busy} onClick={() => { setBusy(true); setNotice(''); setError(''); void antiCheatCall(`/matches/${encodeURIComponent(id)}/admit`, { body: {} }).then(() => setNotice('All required scans are current. Staff can start the match; companions must stay open.')).catch(error => setError(error.message)).finally(() => setBusy(false)); }}>{busy ? 'Checking scans…' : 'Verify match admission'}</button><a className="arena-outline" href="#/admin/live-stream">Open match controls</a></div>
      {notice && <p className="module-notice" role="status">{notice}</p>}
      <p className="field-hint">Companion scans check configured indicators. iPhone clearance requires a referee inspection, continuous supervision and recording. Read each player's coverage and clearance status before starting.</p>
    </>}
  </section>;
}
