import React, { useState } from 'react';
import type { BracketDraft, Match } from '../../lib/types';
import { publicationGameKey } from '../../lib/bracketPublication';
import { belongsToFairPlayGame, FAIR_PLAY_GAMES } from '../../lib/fairPlayGames';
import { bracketScheduleLabel, scheduleDate, timeOrder } from '../../lib/calendar';
import { isWatchableLiveMatch, matchBroadcasts } from '../../lib/streamUtils';
import { PlatformLogo } from '../ui/PlatformLogo';
import { MultiMatchViewer } from './MultiMatchViewer';
import { LayoutGrid } from 'lucide-react';
import { CalendarDays, ChevronRight, Gamepad2, Play, Radio } from '../ui/Icons';
import { GAME_ARTWORK } from '../common/GameArtworkTiles';
import { Modal } from '../ui/Modal';

type GameEntry = { match: Match; bracket: BracketDraft; mode?: string };
type MatchGame = { id: string; label: string; image?: string; entries: GameEntry[] };

function groupMatches(brackets: BracketDraft[]): MatchGame[] {
  const games = new Map<string, MatchGame>(GAME_ARTWORK.map(game => [game.id, { ...game, label: game.name, entries: [] }]));
  for (const bracket of brackets) {
    const key = publicationGameKey(bracket);
    const publishedGame = FAIR_PLAY_GAMES.find(game => `game-${game.id}` === key);
    for (const match of bracket.matches) {
      if ([match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE')) continue;
      const candidates = bracket.gameId === 'game-custom' ? [] : FAIR_PLAY_GAMES.filter(game => belongsToFairPlayGame(match, game));
      const game = publishedGame ?? (candidates.length === 1 ? candidates[0] : undefined);
      const codm = game?.id.startsWith('codm') || candidates.some(candidate => candidate.id.startsWith('codm'));
      const id = game?.id ?? (codm ? 'codm' : key);
      const group = games.get(id) ?? { id, label: bracket.gameName, entries: [] };
      group.entries.push({ match, bracket, mode: codm ? game?.mode : undefined });
      games.set(id, group);
    }
  }
  return [...games.values()];
}

const upcomingOrder = (a: GameEntry, b: GameEntry) =>
  (scheduleDate(a.match.scheduledDate || '') ?? '9999').localeCompare(scheduleDate(b.match.scheduledDate || '') ?? '9999')
  || timeOrder(a.match.scheduledTime || '') - timeOrder(b.match.scheduledTime || '');

export function CurrentLiveView({ brackets, initialGame, onSelectMatch }: {
  brackets: BracketDraft[];
  initialGame?: string | null;
  onSelectMatch: (match: Match, game: string) => void;
}) {
  const [selection, setSelection] = useState(initialGame ?? '');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [multiOpen,setMultiOpen]=useState(false);
  const games = groupMatches(brackets);
  const selected = games.find(game => game.id === selection)
    ?? games.find(game => game.entries.some(({ match }) => isWatchableLiveMatch(match)))
    ?? games.find(game => game.entries.length)
    ?? games[0];
  const live = selected.entries.filter(({ match }) => isWatchableLiveMatch(match));
  const upcoming = selected.entries.filter(({ match }) =>
    (match.status === 'upcoming' || match.status === 'pre-match') && match.team1 && match.team2
  ).sort(upcomingOrder);
  const waitingForBroadcast = selected.entries.filter(({ match }) => match.status === 'live' && !isWatchableLiveMatch(match));
  const pending = selected.entries.find(({ match }) => match.id === pendingId);
  const pendingIsWatchable = pending && isWatchableLiveMatch(pending.match);
  const pendingTitle = pendingIsWatchable ? 'Broadcast is live'
    : pending?.match.status === 'live' ? 'Broadcast not available yet'
    : pending?.match.status === 'completed' ? 'Match has ended' : 'Match is not live yet';
  const totalLive = games.reduce((count, game) => count + game.entries.filter(({ match }) => isWatchableLiveMatch(match)).length, 0);

  const matchRow = ({ match, bracket, mode }: GameEntry, watchable = false) => (
    <button className="match-center-row" type="button" key={match.id} onClick={() => {
      if (watchable) onSelectMatch(match, selected.id);
      else setPendingId(match.id);
    }}>
      <span className="match-center-row-icon">{watchable ? <Play size={17} /> : <CalendarDays size={17} />}</span>
      <span className="match-center-row-copy">
        <strong>{match.team1?.name || 'Awaiting team'} <span>vs</span> {match.team2?.name || 'Awaiting team'}</strong>
        <small>{[mode, bracket.title, match.roundName, match.matchFormat].filter(Boolean).join(' · ')}</small>
      </span>
      <span className="match-center-row-end">
        {watchable && <span className="stream-platform-strip">{matchBroadcasts(match).map(link=><PlatformLogo key={link.platform} platform={link.platform} size={15}/>)}</span>}
        {watchable ? <><span className="match-center-live-badge">Live</span><small>Watch broadcast</small></>
          : <><small>{match.status === 'live' ? 'Broadcast pending' : 'Not live yet'}</small><small>{bracketScheduleLabel(match)}</small></>}
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );

  return <div className="match-center">
    <header className="dashboard-page-heading">
      <h1>Match center</h1>
      <p>Find live broadcasts and upcoming matches from published brackets.</p>
    </header>

    <section className="live-overview-strip"><div><h2><span className={`live-indicator ${totalLive?'':'live-indicator-idle'}`}/>{totalLive?`${totalLive} ${totalLive===1?'match':'matches'} live`:'Your live match hub'}</h2><p>Switch between games, or follow several matches side by side.</p></div><button type="button" className="arena-outline" aria-haspopup="dialog" onClick={()=>setMultiOpen(true)}><LayoutGrid size={16}/>Multi-view</button></section>
    <MultiMatchViewer open={multiOpen} onClose={()=>setMultiOpen(false)} entries={games.flatMap(game=>game.entries.map(entry=>({match:entry.match,gameName:game.label,bracketTitle:entry.bracket.title,gameId:game.id})))} onSelectMatch={onSelectMatch}/>

    <div className="arena-panel match-center-workspace">
      <nav className="match-center-games" aria-label="Filter matches by game">
        <div className="match-center-nav-heading"><strong>Games</strong><small>{totalLive} live across all games</small></div>
        {games.map(game => {
          const liveCount = game.entries.filter(({ match }) => isWatchableLiveMatch(match)).length;
          return <button type="button" key={game.id} aria-pressed={selected.id === game.id} onClick={() => setSelection(game.id)}>
            {game.image ? <img src={game.image} alt="" /> : <span className="match-center-row-icon"><Gamepad2 size={18} /></span>}
            <span><strong>{game.label}</strong><small>{liveCount ? `${liveCount} live` : 'No live broadcasts'}</small></span>
          </button>;
        })}
      </nav>

      <section className="match-center-content" aria-label={`${selected.label} matches`}>
        <header className="match-center-game-heading">
          {selected.image && <img src={selected.image} alt="" />}
          <div><p>Selected game</p><h2>{selected.label}</h2></div>
        </header>
        <section>
          <h3><Radio size={16} /> Live now</h3>
          {live.length ? <div className="match-center-list">{live.map(entry => matchRow(entry, true))}</div>
            : <div className="match-center-empty">
              <span className="match-center-row-icon"><Radio size={19} /></span>
              <div><strong>No live broadcast yet</strong>
                <p>{selected.entries.length ? 'Check the upcoming matches below or choose another game.' : 'Published matches for this game will appear here.'}</p>
              </div>
            </div>}
        </section>

        {waitingForBroadcast.length > 0 && <section>
          <h3><Radio size={16} /> Waiting for broadcast</h3>
          <div className="match-center-list">{waitingForBroadcast.map(entry => matchRow(entry))}</div>
        </section>}
        {upcoming.length > 0 && <section>
          <h3><CalendarDays size={16} /> Upcoming</h3>
          <div className="match-center-list">{upcoming.map(entry => matchRow(entry))}</div>
        </section>}
      </section>
    </div>

    <Modal open={pendingId !== null} onClose={() => setPendingId(null)}
      title={pendingTitle}
      description={pending ? [selected.label, pending.mode, pending.bracket.title].filter(Boolean).join(' · ') : undefined}>
      {pending && <div className="match-center-notice">
        <strong>{pending.match.team1?.name || 'Awaiting team'} vs {pending.match.team2?.name || 'Awaiting team'}</strong>
        <p>{bracketScheduleLabel(pending.match)} · {pending.match.roundName}</p>
        {pendingIsWatchable && <button type="button" className="arena-primary" onClick={() => onSelectMatch(pending.match, selected.id)}>Watch broadcast</button>}
      </div>}
    </Modal>
  </div>;
}
