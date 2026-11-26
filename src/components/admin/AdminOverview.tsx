import React, { useEffect, useMemo, useState } from 'react';
import type { AuditLogItem, BracketDraft, ContentReport, Match, User } from '../../lib/types';
import { bracketScheduleLabel, scheduleDate, timeOrder } from '../../lib/calendar';
import { publicationGameKey } from '../../lib/bracketPublication';
import { FAIR_PLAY_GAMES } from '../../lib/fairPlayGames';
import { firestoreService } from '../../lib/firestore';
import { downloadSchedule, scheduleCSV } from '../../lib/exportUtils';
import { isWatchableLiveMatch } from '../../lib/streamUtils';
import { ROLE_LABEL, buildSystemLog, isBye, mapTotals, matchMap, matchup, summarizeUsers, type Tone } from '../../lib/adminInsights';
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Clock, Flag, GitBranch, History, QrCode, Radio, Users } from '../ui/Icons';
import { GameArtworkTiles } from '../common/GameArtworkTiles';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { errorMessage } from '../../lib/errors';
import { MatchMap, TILE_WORD } from '../three/MatchMap';
import { LogList, useNow } from './SystemLog';
import { useMutedCategories } from '../../lib/logFeed';
import './adminOverview.css';
import { matchName } from '../../lib/matchName';

type Entry = { bracket: BracketDraft; match: Match };
type Props = {
  brackets: BracketDraft[];
  auditLogs: AuditLogItem[];
  users: User[];
  reports: ContentReport[];
  onOpenBracketStudio: (id?: string) => void;
  onOpenLiveStreamManager: (bracketId: string, matchId?: string) => void;
  /** An admin tab ID. */
  onNavigate: (tab: string) => void;
};

type Attention = { id: string; tone: Tone; title: string; detail: string; action: string; run: () => void };

const todayLabel = () => new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' });

export function AdminOverview({ brackets, auditLogs, users, reports, onOpenBracketStudio, onOpenLiveStreamManager, onNavigate }: Props) {
  const { showToast } = useToast();
  const now = useNow();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [matchId, setMatchId] = useState('');
  const [sharing, setSharing] = useState(false);
  const [query, setQuery] = useState('');
  const [scheduleGame, setScheduleGame] = useState('');
  const [includePending, setIncludePending] = useState(false);
  const [scoring, setScoring] = useState(false);

  const entries = brackets.flatMap(bracket => bracket.matches.filter(match => !isBye(match)).map(match => ({ bracket, match })));
  const live = entries.filter(({ match }) => match.status === 'live');
  const scheduled = entries.filter(({ match }) => scheduleDate(match.scheduledDate || '') && timeOrder(match.scheduledTime || '') !== 9999)
    .sort((a, b) => (scheduleDate(a.match.scheduledDate) || '').localeCompare(scheduleDate(b.match.scheduledDate) || '')
      || timeOrder(a.match.scheduledTime) - timeOrder(b.match.scheduledTime));
  const scheduledIds = new Set(scheduled.map(({ match }) => match.id));
  const upcoming = scheduled.filter(({ match }) => ['upcoming', 'pre-match'].includes(match.status))
    // Decided matchups first; "Awaiting team vs Awaiting team" slots only fill the list when nothing else is scheduled.
    .sort((a, b) => Number(!(a.match.team1 && a.match.team2)) - Number(!(b.match.team1 && b.match.team2)));
  const scheduleEntries = includePending ? [...scheduled, ...entries.filter(({ match }) => !scheduledIds.has(match.id))] : scheduled;
  const gameBrackets = brackets.filter(bracket => !scheduleGame || publicationGameKey(bracket) === `game-${scheduleGame}`);
  const filtered = scheduleEntries.filter(({ bracket, match }) => gameBrackets.includes(bracket)
    && `${bracket.gameName} ${bracket.title} ${match.matchNumber} ${matchName(match)} ${match.roundName} ${matchup(match)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = entries.find(({ match }) => match.id === matchId);
  const exportMatches = filtered.map(({ match }) => match);
  const exportContext = new Map(filtered.map(({ match, bracket }) => [match.id, bracket]));

  const lanes = useMemo(() => matchMap(brackets), [brackets]);
  const totals = mapTotals(lanes);
  const people = useMemo(() => summarizeUsers(users, now), [users, now]);
  const [mutedLog] = useMutedCategories();
  const log = useMemo(() => buildSystemLog({ auditLogs, users, reports, brackets }).filter(entry => !mutedLog.includes(entry.category)), [auditLogs, users, reports, brackets, mutedLog]);
  const openReports = reports.filter(report => report.status === 'open').length;
  const noBroadcast = live.filter(({ match }) => !isWatchableLiveMatch(match));

  const attention: Attention[] = [
    openReports && { id: 'reports', tone: 'danger', title: `${openReports} open report${openReports === 1 ? '' : 's'}`, detail: 'Viewers flagged chat messages for review.', action: 'Review', run: () => onNavigate('reports') },
    totals.alert && { id: 'alert', tone: 'warning', title: `${totals.alert} match${totals.alert === 1 ? '' : 'es'} need attention`, detail: 'A match was put on hold. Check its result or dispute.', action: 'Open brackets', run: () => onOpenBracketStudio() },
    noBroadcast.length && { id: 'broadcast', tone: 'warning', title: `${noBroadcast.length} live match${noBroadcast.length === 1 ? '' : 'es'} without a broadcast`, detail: 'Viewers can follow the score but cannot watch.', action: 'Connect', run: () => onOpenLiveStreamManager(noBroadcast[0].bracket.id, noBroadcast[0].match.id) },
    people.suspended && { id: 'suspended', tone: 'warning', title: `${people.suspended} suspended account${people.suspended === 1 ? '' : 's'}`, detail: 'Suspensions wait for an organizer decision.', action: 'Review', run: () => onNavigate('users') },
    totals.pending && { id: 'times', tone: 'info', title: `${totals.pending} match${totals.pending === 1 ? '' : 'es'} without a time`, detail: 'Viewers see "Time to be announced" until you set one.', action: 'Schedule', run: () => { setIncludePending(true); setScheduleOpen(true); } },
  ].filter(Boolean) as Attention[];

  async function addWin(side: 'team1' | 'team2') {
    const match = selected && firestoreService.getMatchById(selected.match.id);
    if (scoring || !match || match.status !== 'live' || !match.team1 || !match.team2) return;
    setScoring(true);
    try {
      firestoreService.updateMatchScore(match.id, match.score.team1Score + Number(side === 'team1'), match.score.team2Score + Number(side === 'team2'));
      try {
        await firestoreService.syncBracketsToCloud();
        showToast('Score published.', 'success');
      } catch {
        showToast('Score updated on this device. Viewer sync failed.', 'error');
      }
    } catch (error) {
      showToast(errorMessage(error, 'Could not update the score.'), 'error');
    } finally {
      setScoring(false);
    }
  }

  function matchRow({ match, bracket }: Entry, showLive = false) {
    return <button type="button" className="organizer-row" key={match.id} onClick={() => { setScheduleOpen(false); setMatchId(match.id); }}>
      <GameImage bracket={bracket} />
      <span className="organizer-row-label"><strong>{matchup(match)}</strong><small>{bracket.gameName} · {bracket.title} · {match.roundName}</small></span>
      <span className="organizer-row-meta">
        {showLive && <span className="match-center-live-badge">Live · {match.score.team1Score}–{match.score.team2Score}</span>}
        {showLive ? <small className={`ov-tone-text is-${isWatchableLiveMatch(match) ? 'success' : 'warning'}`}>{isWatchableLiveMatch(match) ? 'Broadcast connected' : 'No broadcast yet'}</small>
          : <small>{bracketScheduleLabel(match)}</small>}
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>;
  }

  const kpis: { id: string; label: string; value: number; note: string; tone: Tone; icon: typeof Radio; run: () => void }[] = [
    { id: 'live', label: 'Live now', value: live.length, note: live.length ? `${live.length - noBroadcast.length} broadcasting` : 'No match is live', tone: live.length ? 'live' : 'neutral', icon: Radio, run: () => document.getElementById('ov-live')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { id: 'upcoming', label: 'Coming up', value: upcoming.length, note: upcoming[0] ? `Next: ${bracketScheduleLabel(upcoming[0].match)}` : 'Nothing scheduled', tone: 'info', icon: CalendarDays, run: () => setScheduleOpen(true) },
    { id: 'brackets', label: 'Brackets', value: brackets.length, note: `${totals.done} of ${entries.length} matches played`, tone: 'brand', icon: GitBranch, run: () => onOpenBracketStudio() },
    { id: 'users', label: 'Users', value: people.total, note: people.newThisWeek ? `${people.newThisWeek} joined this week` : `${people.active} active`, tone: 'success', icon: Users, run: () => onNavigate('users') },
    { id: 'reports', label: 'Open reports', value: openReports, note: openReports ? 'Waiting for review' : 'Queue is clear', tone: openReports ? 'danger' : 'success', icon: Flag, run: () => onNavigate('reports') },
  ];

  return <div className="organizer-home ov-page">
    <header className="dashboard-page-heading organizer-heading">
      <div><h1>Overview</h1><p>{todayLabel()} · everything happening across your published events.</p></div>
      <div className="organizer-actions">
        <button type="button" className="arena-outline" onClick={() => setScheduleOpen(true)}><CalendarDays size={17} /> Schedule</button>
        <button type="button" className="arena-outline" onClick={() => setSharing(true)}><QrCode size={17} /> Share viewer QR</button>
      </div>
    </header>

    <nav className="ov-kpis" aria-label="At a glance">
      {kpis.map(kpi => <button key={kpi.id} type="button" className={`ov-kpi is-link ov-tone is-${kpi.tone}`} onClick={kpi.run}>
        <span><kpi.icon size={16} aria-hidden="true" /> {kpi.label}</span>
        <strong>{kpi.value}</strong>
        <small>{kpi.note}</small>
      </button>)}
    </nav>

    <div className="ov-hero">
      <section className="page-panel ov-panel ov-map-panel" aria-labelledby="ov-map-title">
        <header>
          <div><h2 id="ov-map-title">Match map</h2><p>Every published match. One row per bracket, ordered by round.</p></div>
        </header>
        <MatchMap lanes={lanes} onSelect={setMatchId} />
        <ul className="ov-legend" aria-label="Match states">
          {(['live', 'done', 'alert', 'scheduled', 'pending'] as const).map(state => <li key={state} className={`ov-key is-${state}`}>{TILE_WORD[state]} <strong>{totals[state]}</strong></li>)}
        </ul>
      </section>

      <section className="page-panel ov-panel" aria-labelledby="ov-attention-title">
        <header><div><h2 id="ov-attention-title">Needs you</h2><p>Highest priority first.</p></div></header>
        {attention.length ? <ul className="ov-attention">
          {attention.map(item => <li key={item.id} className={`ov-tone is-${item.tone}`}>
            <span className="ov-attention-icon" aria-hidden="true">{item.tone === 'danger' ? <Flag size={16} /> : item.tone === 'warning' ? <AlertTriangle size={16} /> : <Clock size={16} />}</span>
            <span className="ov-attention-text"><strong>{item.title}</strong><small>{item.detail}</small></span>
            <button type="button" className="arena-outline arena-sm" onClick={item.run}>{item.action}</button>
          </li>)}
        </ul> : <p className="ov-all-clear ov-tone is-success"><CheckCircle2 size={18} aria-hidden="true" /> All clear. Nothing is waiting for you.</p>}
      </section>
    </div>

    <section className="page-panel ov-panel" id="ov-live" aria-labelledby="ov-live-title">
      <header><div><h2 id="ov-live-title"><Radio size={18} /> Live matches</h2><p>Select a match to add a game win or open its broadcast.</p></div><span className="match-center-live-badge">{live.length} live</span></header>
      {live.length ? <div className="organizer-live-grid">{live.map(entry => matchRow(entry, true))}</div>
        : <p className="organizer-empty">No published matches are live right now.</p>}
    </section>

    <div className="organizer-columns">
      <section className="page-panel ov-panel" aria-labelledby="ov-users-title">
        <header><div><h2 id="ov-users-title"><Users size={18} /> Users</h2><p>{people.total} accounts · {people.staff} staff</p></div>
          <button type="button" className="arena-outline" onClick={() => onNavigate('users')}>Manage users</button></header>
        <SegmentBar label="Accounts by status" parts={[
          { tone: 'success', value: people.active, label: 'Active' },
          { tone: 'warning', value: people.suspended, label: 'Suspended' },
          { tone: 'danger', value: people.banned, label: 'Banned' },
        ]} />
        <div className="ov-role-row" aria-label="Accounts by role">
          {people.roles.map(item => <span key={item.role} className="ov-role-chip">{ROLE_LABEL[item.role] || item.role}<strong>{item.count}</strong></span>)}
        </div>
        {people.newest.length > 0 && <>
          <h3 className="ov-subhead">Newest members</h3>
          <ul className="ov-people">
            {people.newest.map(user => <li key={user.id}>
              <span className="ov-avatar" aria-hidden="true">{user.avatarInitials}</span>
              <span><strong>{user.name}</strong><small>{user.collegeName || ROLE_LABEL[user.role]}</small></span>
              <small>{user.joinedAt ? new Date(user.joinedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }) : ''}</small>
            </li>)}
          </ul>
        </>}
      </section>

      <section className="page-panel ov-panel" aria-labelledby="ov-log-title">
        <header><div><h2 id="ov-log-title"><History size={18} /> System log</h2><p>Latest staff actions, sign-ups and reports.</p></div>
          <button type="button" className="arena-outline" onClick={() => onNavigate('logs')}>Open full log</button></header>
        {log.length ? <LogList entries={log.slice(0, 7)} now={now} onNavigate={onNavigate} compact />
          : <p className="organizer-empty">No activity yet. Staff changes, sign-ups and reports will show here.</p>}
      </section>
    </div>

    <div className="organizer-columns">
      <section className="page-panel ov-panel" aria-labelledby="ov-brackets-title">
        <header><div><h2 id="ov-brackets-title"><GitBranch size={18} /> Published brackets</h2><p>Progress of each event. Open one to edit it.</p></div></header>
        {brackets.length ? brackets.map(bracket => {
          const playable = bracket.matches.filter(match => !isBye(match));
          const count = (status: Match['status']) => playable.filter(match => match.status === status).length;
          return <div className="ov-bracket" key={bracket.id}>
            <button className="organizer-row" type="button" onClick={() => onOpenBracketStudio(bracket.id)}>
              <GameImage bracket={bracket} />
              <span className="organizer-row-label"><strong>{bracket.title}</strong><small>{bracket.gameName} · {count('completed')} of {playable.length} played{count('live') ? ` · ${count('live')} live` : ''}</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <SegmentBar label={`${bracket.title} progress`} compact parts={[
              { tone: 'brand', value: count('completed'), label: 'Played' },
              { tone: 'live', value: count('live'), label: 'Live' },
              { tone: 'neutral', value: playable.length - count('completed') - count('live'), label: 'Left' },
            ]} />
            <button type="button" className="arena-text-button" onClick={() => onOpenLiveStreamManager(bracket.id)}>Broadcast desk</button>
          </div>;
        }) : <p className="organizer-empty">Published brackets will appear here.</p>}
      </section>

      <section className="page-panel ov-panel" aria-labelledby="ov-next-title">
        <header><div><h2 id="ov-next-title"><CalendarDays size={18} /> Scheduled next</h2><p>Published dates and times in Manila time.</p></div>
          <button type="button" className="arena-outline" onClick={() => setScheduleOpen(true)}>Open schedule</button></header>
        {upcoming.slice(0, 4).map(entry => matchRow(entry))}
        {!upcoming.length && <p className="organizer-empty">No upcoming match times have been published.</p>}
      </section>
    </div>

    <Modal open={scheduleOpen} title="Published match schedule" className="account-dialog" onClose={() => setScheduleOpen(false)}>
      <div className="organizer-panel">
        <GameArtworkTiles label="Filter published schedule by game" selected={scheduleGame} onSelect={setScheduleGame} />
        <div className="organizer-schedule-controls">
          <button type="button" className="arena-outline" aria-pressed={!scheduleGame} onClick={() => setScheduleGame('')}>All games</button>
          <label className="module-form">Search schedule<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        </div>
        <label className="organizer-pending-toggle"><input type="checkbox" checked={includePending} onChange={event => setIncludePending(event.target.checked)} /> Include matches with pending times</label>
        {filtered.length ? <div className="organizer-schedule-list">{filtered.map(entry => matchRow(entry))}</div> : <p className="organizer-empty">{gameBrackets.length ? 'No published times match this selection.' : 'No bracket has been published for this selection yet.'}</p>}
        <footer className="dialog-actions">
          <button type="button" className="arena-outline" disabled={!filtered.length} onClick={async () => {
            try { await navigator.clipboard.writeText(scheduleCSV(exportMatches, exportContext)); showToast('Schedule copied.', 'success'); }
            catch { showToast('Clipboard unavailable. Use Export CSV.', 'error'); }
          }}>Copy schedule</button>
          <button type="button" className="arena-outline" disabled={!filtered.length} onClick={() => downloadSchedule(exportMatches, exportContext)}>Export CSV</button>
        </footer>
      </div>
    </Modal>

    <Modal open={Boolean(matchId)} title={selected ? matchup(selected.match) : 'Match unavailable'} onClose={() => setMatchId('')}
      description={selected && `${selected.bracket.gameName} · ${selected.bracket.title} · ${selected.match.roundName}`}>
      {selected && <div className="organizer-panel">
        <p>{matchName(selected.match)} · {selected.match.matchFormat} · {bracketScheduleLabel(selected.match)}</p>
        <p><span className={`status-pill ${({ live: 'is-danger', completed: 'is-success', alert: 'is-warning' } as Record<string, string>)[selected.match.status] || 'is-info'}`}>{selected.match.status.replace('-', ' ')}</span> · {selected.match.score.team1Score}–{selected.match.score.team2Score}</p>
        {selected.match.winnerId && <p>Winner: {[selected.match.team1, selected.match.team2].find(team => team?.id === selected.match.winnerId)?.name || 'Team name unavailable'}</p>}
        {selected.match.status === 'live' && selected.match.team1 && selected.match.team2 && <div className="organizer-actions">
          <button type="button" className="arena-outline" disabled={scoring} onClick={() => void addWin('team1')}>+1 {selected.match.team1.name}</button>
          <button type="button" className="arena-outline" disabled={scoring} onClick={() => void addWin('team2')}>+1 {selected.match.team2.name}</button>
        </div>}
        <div className="organizer-actions">
          <button type="button" className="arena-outline" onClick={() => onOpenLiveStreamManager(selected.bracket.id, selected.match.id)}>Open in Broadcast desk</button>
          <button type="button" className="arena-outline" onClick={() => onOpenBracketStudio(selected.bracket.id)}>Open bracket</button>
        </div>
      </div>}
    </Modal>
    <Modal open={sharing} title="Share a viewer QR" description="Choose where the QR should take spectators." onClose={() => setSharing(false)}>
      <ViewerQr brackets={brackets} live={live.filter(({ match }) => isWatchableLiveMatch(match))} />
    </Modal>
  </div>;
}

/** A thin stacked bar with a labelled key: status mix for accounts, progress for a bracket. */
export function SegmentBar({ parts, label, compact = false }: { parts: { tone: Tone; value: number; label: string }[]; label: string; compact?: boolean }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return <div className={`ov-segments${compact ? ' is-compact' : ''}`}>
    <div className="ov-segment-bar" role="img" aria-label={`${label}: ${parts.map(part => `${part.value} ${part.label.toLowerCase()}`).join(', ')}`}>
      {total ? parts.filter(part => part.value).map(part => <span key={part.label} className={`ov-tone is-${part.tone}`} style={{ flexGrow: part.value }} />) : <span className="ov-tone is-neutral" style={{ flexGrow: 1 }} />}
    </div>
    {!compact && <ul className="ov-legend">{parts.map(part => <li key={part.label} className={`ov-key is-${part.tone}`}>{part.label} <strong>{part.value}</strong></li>)}</ul>}
  </div>;
}

function GameImage({ bracket }: { bracket: BracketDraft }) {
  const artwork = FAIR_PLAY_GAMES.find(game => `game-${game.id}` === publicationGameKey(bracket));
  return artwork ? <img className="organizer-game-art" src={artwork.image} alt="" /> : <span className="match-center-row-icon"><GitBranch size={16} /></span>;
}

function ViewerQr({ brackets, live }: { brackets: BracketDraft[]; live: Entry[] }) {
  const { showToast } = useToast();
  const [site, setSite] = useState(window.location.origin);
  const [destination, setDestination] = useState('#/arena/current-live');
  const [image, setImage] = useState('');
  const [failed, setFailed] = useState(false);
  const destinations = [
    { value: '#/arena/current-live', label: 'Match center · all games' },
    ...brackets.map(bracket => ({ value: `#/arena/brackets?${new URLSearchParams({ bracket: bracket.id })}`, label: `${bracket.gameName} · ${bracket.title}` })),
    ...live.map(({ bracket, match }) => ({ value: `#/arena/live?${new URLSearchParams({ match: match.id })}`, label: `Live · ${bracket.gameName} · ${matchup(match)}` })),
  ];
  const selected = destinations.find(item => item.value === destination) ?? destinations[0];
  let link = '';
  try {
    const url = new URL(site.trim());
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      url.hash = selected.value;
      link = url.href;
    }
  } catch {}
  useEffect(() => {
    let active = true;
    setImage('');
    setFailed(false);
    if (link) void import('qrcode').then(({ toDataURL }) => toDataURL(link, { width: 224, margin: 4 }))
      .then(value => { if (active) setImage(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [link]);

  return <div className="module-form">
    <label>Viewer destination<select value={selected.value} onChange={event => setDestination(event.target.value)}>
      {destinations.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <label>ArenaHub site address<input type="url" value={site} onChange={event => setSite(event.target.value)} /></label>
    <p className="studio-muted">Use an ArenaHub address viewers can reach. A localhost link only opens on this computer. Normal sign-in and spectator access apply.</p>
    {image && <img className="organizer-qr" width="224" height="224" src={image} alt="Scan to open the selected ArenaHub viewer page" />}
    {failed && <p className="module-error">The QR could not be generated. You can still copy the link.</p>}
    <div className="organizer-actions">
      <button type="button" disabled={!link} className="arena-outline" onClick={async () => {
        try { await navigator.clipboard.writeText(link); showToast('Viewer link copied.', 'success'); }
        catch { showToast('Could not copy the viewer link.', 'error'); }
      }}>Copy viewer link</button>
      {image && <a className="arena-outline" href={image} download="arenahub-viewer-qr.png">Download QR</a>}
    </div>
  </div>;
}
