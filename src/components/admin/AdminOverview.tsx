import React, { useEffect, useState } from 'react';
import type { AuditLogItem, BracketDraft, Match } from '../../lib/types';
import { bracketScheduleLabel, scheduleDate, timeOrder } from '../../lib/calendar';
import { publicationGameKey } from '../../lib/bracketPublication';
import { FAIR_PLAY_GAMES } from '../../lib/fairPlayGames';
import { firestoreService } from '../../lib/firestore';
import { downloadSchedule, scheduleCSV } from '../../lib/exportUtils';
import { isWatchableLiveMatch } from '../../lib/streamUtils';
import { AlertCircle, CalendarDays, ChevronRight, GitBranch, QrCode, Radio, Users } from '../ui/Icons';
import { GameArtworkTiles } from '../common/GameArtworkTiles';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';

type Entry = { bracket: BracketDraft; match: Match };
type Props = {
  brackets: BracketDraft[];
  auditLogs: AuditLogItem[];
  accountCount: number;
  reportCount: number;
  onOpenBracketStudio: (id?: string) => void;
  onOpenLiveStreamManager: (bracketId: string, matchId?: string) => void;
  onOpenReports: () => void;
  onOpenUsers: () => void;
};

function isBye(match: Match) {
  return [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE');
}

function matchup(match: Match) {
  return `${match.team1?.name || 'Awaiting team'} vs ${match.team2?.name || 'Awaiting team'}`;
}

export function AdminOverview({ brackets, auditLogs, accountCount, reportCount, onOpenBracketStudio,
  onOpenLiveStreamManager, onOpenReports, onOpenUsers }: Props) {
  const { showToast } = useToast();
  const [panel, setPanel] = useState<'schedule' | 'activity' | null>(null);
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
  const scheduleEntries = includePending ? [...scheduled, ...entries.filter(({ match }) => !scheduledIds.has(match.id))] : scheduled;
  const gameBrackets = brackets.filter(bracket => !scheduleGame || publicationGameKey(bracket) === `game-${scheduleGame}`);
  const filtered = scheduleEntries.filter(({ bracket, match }) => gameBrackets.includes(bracket)
    && `${bracket.gameName} ${bracket.title} ${match.matchNumber} ${match.roundName} ${matchup(match)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = entries.find(({ match }) => match.id === matchId);
  const exportMatches = filtered.map(({ match }) => match);
  const exportContext = new Map(filtered.map(({ match, bracket }) => [match.id, bracket]));

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
      showToast(error instanceof Error ? error.message : 'Could not update the score.', 'error');
    } finally {
      setScoring(false);
    }
  }

  function matchRow({ match, bracket }: Entry, showLive = false) {
    return <button type="button" className="organizer-row" key={match.id} onClick={() => { setPanel(null); setMatchId(match.id); }}>
      <GameImage bracket={bracket} />
      <span className="organizer-row-label"><strong>{matchup(match)}</strong><small>{bracket.gameName} · {bracket.title} · {match.roundName}</small></span>
      <span className="organizer-row-meta">
        {showLive && <span className="match-center-live-badge">Live · {match.score.team1Score}–{match.score.team2Score}</span>}
        <small>{showLive ? isWatchableLiveMatch(match) ? 'Broadcast connected' : 'Broadcast pending' : bracketScheduleLabel(match)}</small>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>;
  }

  return <div className="organizer-home">
    <header className="dashboard-page-heading organizer-heading">
      <div><h1>Organizer overview</h1><p>Live matches, schedules, and sharing for your published brackets.</p></div>
      <button type="button" className="arena-outline" onClick={() => setSharing(true)}><QrCode size={17} /> Share viewer QR</button>
    </header>

    <div className="organizer-summary">
      <button type="button" className="organizer-tile arena-panel" onClick={() => setPanel('schedule')}><CalendarDays size={18} /><strong>{scheduled.length}</strong><span>Matches with dates and times</span></button>
      <button type="button" className="organizer-tile arena-panel" onClick={() => onOpenBracketStudio()}><GitBranch size={18} /><strong>{brackets.length}</strong><span>Published brackets</span></button>
      <button type="button" className="organizer-tile arena-panel" onClick={onOpenUsers}><Users size={18} /><strong>{accountCount}</strong><span>Accounts loaded</span></button>
      <button type="button" className="organizer-tile arena-panel" onClick={onOpenReports}><AlertCircle size={18} /><strong>{reportCount}</strong><span>Open moderation reports</span></button>
    </div>

    <section className="arena-panel organizer-panel">
      <header><div><h2><Radio size={18} /> Live matches</h2><p>Every live match from your published brackets appears here.</p></div><span className="match-center-live-badge">{live.length} live</span></header>
      {live.length ? <div className="organizer-live-grid">{live.map(entry => matchRow(entry, true))}</div>
        : <p className="organizer-empty">No published matches are live right now.</p>}
    </section>

    <div className="organizer-columns">
      <section className="arena-panel organizer-panel">
        <header><div><h2><GitBranch size={18} /> Published brackets</h2><p>Open a bracket or manage its broadcast.</p></div></header>
        {brackets.length ? brackets.map(bracket => {
          const playable = bracket.matches.filter(match => !isBye(match));
          return <div className="organizer-bracket" key={bracket.id}>
            <button className="organizer-row" type="button" onClick={() => onOpenBracketStudio(bracket.id)}>
              <GameImage bracket={bracket} />
              <span className="organizer-row-label"><strong>{bracket.title}</strong><small>{bracket.gameName} · {playable.filter(match => match.status === 'completed').length} of {playable.length} played</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button type="button" className="arena-text-button" onClick={() => onOpenLiveStreamManager(bracket.id)}>Stream Manager</button>
          </div>;
        }) : <p className="organizer-empty">Published brackets will appear here.</p>}
      </section>

      <section className="arena-panel organizer-panel">
        <header><div><h2><CalendarDays size={18} /> Scheduled next</h2><p>Published dates and times in Manila time.</p></div>
          <button type="button" className="arena-outline" onClick={() => setPanel('schedule')}>Open schedule</button></header>
        {scheduled.filter(({ match }) => ['upcoming', 'pre-match'].includes(match.status)).slice(0, 4).map(entry => matchRow(entry))}
        {!scheduled.some(({ match }) => ['upcoming', 'pre-match'].includes(match.status)) && <p className="organizer-empty">No upcoming match times have been published.</p>}
      </section>
    </div>

    <section className="arena-panel organizer-panel">
      <header><div><h2>Recent activity</h2><p>Shared tournament activity recorded by staff.</p></div><button type="button" className="arena-outline" onClick={() => setPanel('activity')}>View activity</button></header>
      {auditLogs[0] && <p className="organizer-activity"><strong>{auditLogs[0].actor}</strong> {auditLogs[0].action}</p>}
    </section>

    <Modal open={panel !== null} title={panel === 'activity' ? 'Recent activity' : 'Published match schedule'}
      className="account-dialog" onClose={() => setPanel(null)}>
      {panel === 'activity' ? <ul className="organizer-activity-list">{auditLogs.map(log => <li key={log.id}><strong>{log.actor}</strong> {log.action}<small>{log.timestamp}</small></li>)}</ul>
        : <div className="organizer-panel">
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
        </div>}
    </Modal>

    <Modal open={Boolean(matchId)} title={selected ? matchup(selected.match) : 'Match unavailable'} onClose={() => setMatchId('')}
      description={selected && `${selected.bracket.gameName} · ${selected.bracket.title} · ${selected.match.roundName}`}>
      {selected && <div className="organizer-panel">
        <p>{selected.match.matchNumber} · {selected.match.matchFormat} · {bracketScheduleLabel(selected.match)}</p>
        <p><strong className="capitalize">{selected.match.status.replace('-', ' ')}</strong> · {selected.match.score.team1Score}–{selected.match.score.team2Score}</p>
        {selected.match.winnerId && <p>Winner: {[selected.match.team1, selected.match.team2].find(team => team?.id === selected.match.winnerId)?.name || 'Team name unavailable'}</p>}
        {selected.match.status === 'live' && selected.match.team1 && selected.match.team2 && <div className="organizer-actions">
          <button type="button" className="arena-outline" disabled={scoring} onClick={() => void addWin('team1')}>+1 {selected.match.team1.name}</button>
          <button type="button" className="arena-outline" disabled={scoring} onClick={() => void addWin('team2')}>+1 {selected.match.team2.name}</button>
        </div>}
        <button type="button" className="arena-outline" onClick={() => onOpenLiveStreamManager(selected.bracket.id, selected.match.id)}>Open in Stream Manager</button>
      </div>}
    </Modal>
    <Modal open={sharing} title="Share a viewer QR" description="Choose where the QR should take spectators." onClose={() => setSharing(false)}>
      <ViewerQr brackets={brackets} live={live.filter(({ match }) => isWatchableLiveMatch(match))} />
    </Modal>
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
