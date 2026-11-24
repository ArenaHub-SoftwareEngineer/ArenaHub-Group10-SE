import React, { lazy, Suspense, useMemo, useState } from 'react';
import { PLATFORM_LABEL } from '../../lib/integrityRisk';
import { groupScanSessions, latestScanSessions, scanCountKey, scanCounts, scanTeam, SCAN_SERIES, type ScanChartSession, type ScanGroup } from '../../lib/monitorScanCounts';
import { Modal } from '../ui/Modal';
import { StageBoundary, reducedMotion, saveData, webglAvailable } from '../three/ArenaHero';

const ScanChartStage = lazy(() => import('../three/ScanChartStage'));
type MonitorConnection = 'waiting' | 'online' | 'paired' | 'lost' | 'ended' | 'declined';

export const CONNECTION_LABEL: Record<MonitorConnection, string> = {
  waiting: 'Waiting for device', online: 'Online', paired: 'Checked in', lost: 'Not reporting', ended: 'Ended', declined: 'Declined',
};

export interface ScanOverviewSession extends ScanChartSession {
  connection: MonitorConnection;
  anyDevice?: boolean;
}

const columns = (length: number) => ({ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` });

function ScanChart({ groups, byTeam, onOpen }: { groups: ScanGroup[]; byTeam: boolean; onOpen: (id: string) => void }) {
  const [use3d] = useState(() => !saveData() && webglAvailable());
  const highest = Math.max(...groups.map(group => group.sessions.length), 1);
  const step = Math.ceil(highest / 4);
  const maximum = Math.ceil(highest / step) * step;
  const ticks = Array.from({ length: maximum / step + 1 }, (_, i) => maximum - i * step);
  const flat = <div className="scan-flat-plot" style={columns(groups.length)}>
    {groups.map(group => <div className="scan-flat-column" key={group.id}>
      {SCAN_SERIES.map(series => group.counts[series.key] > 0 && <i key={series.key}
        style={{ height: `${group.counts[series.key] / maximum * 100}%`, background: series.color }} />)}
    </div>)}
  </div>;

  return <div className="scan-chart-scroll" role="group" aria-label={byTeam ? 'Scan chart by team' : 'Scan chart by game'}>
    <div className="scan-chart" style={{ minWidth: Math.max(250, groups.length * 105 + 36) }}>
      <div className="scan-axis" aria-hidden="true">{ticks.map(value => <span key={value} style={{ top: `${(1 - value / maximum) * 100}%` }}>{value}</span>)}</div>
      <div className="scan-chart-body">
        <div className="scan-plot">
          <div className="scan-gridlines" aria-hidden="true">{ticks.map(value => <i key={value} style={{ top: `${(1 - value / maximum) * 100}%` }} />)}</div>
          <div className="scan-scene" aria-hidden="true">
            {use3d ? <StageBoundary fallback={flat}><Suspense fallback={flat}>
              <ScanChartStage values={groups.map(group => group.counts)} maximum={maximum} still={reducedMotion()} />
            </Suspense></StageBoundary> : flat}
          </div>
          <div className="scan-chart-buttons" style={columns(groups.length)}>
            {groups.map(group => <button type="button" key={group.id} aria-haspopup="dialog"
              aria-label={`${group.label}, ${byTeam ? group.game + ', ' : ''}${group.counts.scanned} scanned, ${group.counts.inspected} iPhone inspected, ${group.counts.awaiting} awaiting a check`}
              title={`View ${group.label} player scans`} onClick={() => onOpen(group.id)}>
              <b aria-hidden="true" style={{ bottom: `calc(${group.sessions.length / maximum * 100}% + 5px)` }}>{group.sessions.length}</b>
              <span aria-hidden="true">{group.label}{byTeam && <small>{group.game}</small>}</span>
            </button>)}
          </div>
        </div>
      </div>
    </div>
  </div>;
}

function ScanBreakdown({ sessions, gameDetails, onOpenSession }: {
  sessions: ScanOverviewSession[]; gameDetails: boolean; onOpenSession: (id: string) => void;
}) {
  const [team, setTeam] = useState('');
  const [state, setState] = useState('');
  const teams = useMemo(() => groupScanSessions(sessions, true), [sessions]);
  const teamSessions = teams.find(group => group.id === team)?.sessions ?? sessions;
  const shown = state ? teamSessions.filter(session => scanCountKey(session) === state) : teamSessions;
  return <div className="scan-breakdown">
    <div className="scan-breakdown-filters module-form">
      {gameDetails && teams.length > 1 && <label>Team<select value={team} onChange={event => setTeam(event.target.value)}>
        <option value="">All teams</option>
        {teams.map(group => <option key={group.id} value={group.id}>{group.label} · {group.sessions.length}</option>)}
      </select></label>}
      <label>Check status<select value={state} onChange={event => setState(event.target.value)}>
        <option value="">All statuses</option>
        {SCAN_SERIES.map(series => <option key={series.key} value={series.key}>{series.label}</option>)}
      </select></label>
    </div>
    {shown.length === 0 ? <p className="field-hint">No player sessions match this selection.</p> : <ul className="scan-breakdown-list">
      {shown.map(session => <li className="monitor-session" key={session.id}>
        <div><strong>{session.playerName}</strong><small>{[scanTeam(session), session.gameLabel, session.matchLabel].join(' · ')}</small></div>
        <div><strong>{session.scan?.label || CONNECTION_LABEL[session.connection]}</strong><small>{session.anyDevice ? 'Any phone' : PLATFORM_LABEL[session.platform]}</small></div>
        <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => onOpenSession(session.id)}>Open session</button>
      </li>)}
    </ul>}
  </div>;
}

export function ScanOverview({ sessions, loading, onOpenSession, onRefresh, actions }: {
  sessions: ScanOverviewSession[];
  loading: boolean;
  onOpenSession: (id: string) => void;
  onRefresh: () => void;
  actions?: React.ReactNode;
}) {
  const [game, setGame] = useState('');
  const [match, setMatch] = useState('');
  const [details, setDetails] = useState<string | null>(null);
  const players = useMemo(() => latestScanSessions(sessions), [sessions]);
  const games = [...new Map(players.map(session => [session.game, session.gameLabel]))].sort((a, b) => a[1].localeCompare(b[1]));
  const gameSessions = game ? players.filter(session => session.game === game) : players;
  const matches = [...new Map(gameSessions.map(session => [session.matchId, session.matchLabel]))];
  const scoped = match ? gameSessions.filter(session => session.matchId === match) : gameSessions;
  const byTeam = Boolean(game || match);
  const groups = groupScanSessions(scoped, byTeam);
  const breakdown = groups.find(group => group.id === details);
  const totals = scanCounts(scoped);

  return <section className="operations-section scan-overview" aria-labelledby="scan-overview-title">
    <header className="scan-overview-header">
      <div><h2 id="scan-overview-title">Player scan overview</h2><p>Recent sessions · Latest entry per player per match</p></div>
      <div className="scan-overview-actions">
        {actions}
        <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setDetails('all')}>Player scans</button>
        <button type="button" className="arena-text-button" disabled={loading} onClick={onRefresh}>Refresh</button>
      </div>
    </header>
    <div className="scan-overview-filters module-form">
      <label>Scan game<select value={game} onChange={event => { setGame(event.target.value); setMatch(''); }}>
        <option value="">All games</option>{games.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>Scan match<select value={match} onChange={event => setMatch(event.target.value)}>
        <option value="">All recent matches</option>{matches.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
    </div>
    {loading ? <p className="field-hint" role="status">Loading player scans…</p> : !groups.length ? <p className="scan-chart-empty">No player sessions in this view yet.</p> : <>
      <div className="scan-chart-heading">
        <div><strong>{byTeam ? 'Players by team' : 'Players by game'}</strong><span>{scoped.length} {scoped.length === 1 ? 'player entry' : 'player entries'}</span></div>
        <ul aria-label="Scan totals">{SCAN_SERIES.map(series => <li key={series.key}>
          <i style={{ background: series.color }} aria-hidden="true" /><b>{totals[series.key]}</b> {series.label}
        </li>)}</ul>
      </div>
      <ScanChart groups={groups} byTeam={byTeam} onOpen={setDetails} />
    </>}
    <Modal open={details !== null} title={breakdown ? `${breakdown.label} · Player scans` : 'Player scans'}
      description={breakdown ? `${breakdown.sessions.length} player entries` : 'Sessions in the selected game and match'}
      onClose={() => setDetails(null)} className="feature-dialog feature-dialog-wide">
      {details !== null && <ScanBreakdown key={details} sessions={breakdown?.sessions ?? scoped} gameDetails={!byTeam || details === 'all'} onOpenSession={onOpenSession} />}
    </Modal>
  </section>;
}
