import React, { useEffect, useMemo, useState } from 'react';
import type { BracketDraft } from '../../lib/types';
import { isFirebaseConfigured } from '../../lib/firebase';
import { watchArchivedTournaments } from '../../lib/data/tournamentStore';
import {
  buildPlayerLeaderboards, formatKda, rankLeaderboard, KDA_MIN_GAMES, LEADERBOARD_SORTS,
  type GameLeaderboard, type LeaderboardRow, type LeaderboardSort,
} from '../../lib/playerLeaderboard';
import { RANK_GAMES } from '../../lib/gameRanks';
import { CollegeLogo } from '../common/CollegeLogo';
import { Modal } from '../ui/Modal';
import { Search, ChevronRight } from 'lucide-react';
import { Crown } from '../ui/Icons';
import './leaderboard.css';

/** Past events, loaded only while the leaderboard is open. Local (offline) mode has none. */
function useArchivedBrackets() {
  const [state, setState] = useState<{ brackets: BracketDraft[]; loaded: boolean; failed: boolean }>(
    { brackets: [], loaded: !isFirebaseConfigured, failed: false });
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return watchArchivedTournaments(
      items => setState({ brackets: items.map(item => item.bracket), loaded: true, failed: false }),
      () => setState(prior => ({ ...prior, loaded: true, failed: true })),
    );
  }, []);
  return state;
}

const SORTS = new Set(LEADERBOARD_SORTS.map(s => s.id));
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : word.endsWith('ch') ? `${word}es` : `${word}s`}`;

export function PlayerLeaderboardView({ brackets, game, sort, onChange }: {
  brackets: BracketDraft[]; game?: string | null; sort?: string | null;
  onChange: (params: { game: string; sort: LeaderboardSort }) => void;
}) {
  const archived = useArchivedBrackets();
  // Recomputed from the live tournament feeds, so a saved result or correction shows here without a refresh.
  const boards = useMemo(() => buildPlayerLeaderboards([
    ...brackets.filter(b => b.status === 'published').map(bracket => ({ bracket, current: true })),
    ...archived.brackets.map(bracket => ({ bracket, current: false })),
  ]), [brackets, archived.brackets]);

  const gameTabs = [...RANK_GAMES.map(g => ({ key: g.gameId, label: g.short })),
    ...boards.filter(b => !RANK_GAMES.some(g => g.gameId === b.gameKey)).map(b => ({ key: b.gameKey, label: b.label }))];
  const firstWithPlayers = boards.find(b => b.rows.length)?.gameKey;
  const activeGame = gameTabs.some(t => t.key === game) ? game! : firstWithPlayers || gameTabs[0].key;
  const activeSort: LeaderboardSort = SORTS.has(sort as LeaderboardSort) ? sort as LeaderboardSort : 'kda';
  const board = boards.find(b => b.gameKey === activeGame);
  const label = board?.label || RANK_GAMES.find(g => g.gameId === activeGame)?.name || activeGame;

  const [search, setSearch] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rows = useMemo(() => board ? rankLeaderboard(board.rows, activeSort) : [], [board, activeSort]);
  const needle = search.trim().toLowerCase();
  const shown = needle ? rows.filter(r => `${r.ign} ${r.teamName} ${r.collegeCode}`.toLowerCase().includes(needle)) : rows;
  const open = rows.find(r => r.key === openKey);

  return <div className="module-page player-leaderboard">
    <header className="dashboard-page-heading">
      <h1>Player leaderboard</h1>
      <p>Individual records across every published and past tournament, one table per game.</p>
    </header>

    <div className="page-toolbar">
      <div className="ah-tabs" role="tablist" aria-label="Game">
        {gameTabs.map(tab => <button key={tab.key} type="button" role="tab" aria-selected={tab.key === activeGame}
          onClick={() => { setSearch(''); onChange({ game: tab.key, sort: activeSort }); }}>{tab.label}</button>)}
      </div>
      <span className="leaderboard-live" title="Totals refresh when organizers save a result, stats or a correction.">
        <i aria-hidden="true" />Updates automatically
      </span>
    </div>

    {archived.failed && <p className="module-error" role="alert">Past tournaments could not be loaded, so totals include current tournaments only. Check your connection and refresh.</p>}

    {board && !board.tracksPlayers ? <section className="arena-panel standings-empty">
      <Crown size={22} aria-hidden="true" />
      <div><h2>Squad results only</h2><p>{label} lobbies record placement and eliminations per squad, not per player. See Standings for squad rankings.</p></div>
    </section> : !rows.length ? <section className="arena-panel standings-empty">
      <Crown size={22} aria-hidden="true" />
      <div>
        <h2>No player records for {label} yet</h2>
        <p>{!archived.loaded ? 'Loading past tournaments…'
          : board?.finishedWithoutStats ? `${plural(board.finishedWithoutStats, 'finished match')} ${board.finishedWithoutStats === 1 ? 'has' : 'have'} no player stats yet. Players appear once organizers enter K/D/A or name an MVP.`
          : 'Players appear after a finished match has player stats or an MVP.'}</p>
        {board && board.liveMatches > 0 && <p className="leaderboard-note">{plural(board.liveMatches, 'match')} in progress will count once the result is final.</p>}
      </div>
    </section> : <section className="arena-panel published-standings leaderboard-panel" aria-labelledby="leaderboard-title">
      <div className="standings-tools">
        <div>
          <h2 id="leaderboard-title">{label}</h2>
          <p>{plural(rows.length, 'player')} · {plural(board!.tournaments.filter(t => t.countedMatches).length, 'tournament')} · {plural(board!.tournaments.reduce((sum, t) => sum + t.countedMatches, 0), 'match')}{!archived.loaded ? ' · loading past tournaments…' : ''}</p>
        </div>
        <label><Search size={15} /><input aria-label="Find a player" type="search" placeholder="Find a player or team" value={search} onChange={e => setSearch(e.target.value)} /></label>
      </div>
      <LeaderboardTable rows={shown} sort={activeSort} onSort={next => onChange({ game: activeGame, sort: next })} onOpen={setOpenKey} title={label} />
      {!shown.length && <p className="broadcast-copy" role="status">No players match “{search}”.</p>}
      <LeaderboardNotes board={board!} />
    </section>}

    <Modal open={!!open} onClose={() => setOpenKey(null)} title={open?.ign || 'Player'} description={open ? `${open.teamName}${open.collegeCode ? ` · ${open.collegeCode}` : ''}${open.role ? ` · ${open.role}` : ''}` : undefined} className="standings-detail-dialog">
      {open && <PlayerHistory row={open} />}
    </Modal>
  </div>;
}

function LeaderboardTable({ rows, sort, onSort, onOpen, title }: { rows: LeaderboardRow[]; sort: LeaderboardSort; onSort: (sort: LeaderboardSort) => void; onOpen: (key: string) => void; title: string }) {
  const header = (id: LeaderboardSort, text: React.ReactNode, hint?: string) =>
    <th scope="col" aria-sort={sort === id ? 'descending' : undefined}>
      <button type="button" className="leaderboard-sort" aria-pressed={sort === id} title={hint} onClick={() => onSort(id)}>{text}</button>
    </th>;
  return <div className="leaderboard-table-wrap" tabIndex={0} role="region" aria-label="Leaderboard table, scrolls sideways on small screens">
    <table>
      <caption className="sr-only">{title} player leaderboard, ranked by {LEADERBOARD_SORTS.find(s => s.id === sort)?.label}</caption>
      <thead><tr>
        <th scope="col">#</th><th scope="col">Player</th>
        <th scope="col"><abbr title="Games with entered stats">Games</abbr></th>
        {header('wins', <abbr title="Series won and lost">W–L</abbr>, 'Sort by series wins')}
        {header('kills', 'K', 'Sort by kills')}
        <th scope="col">D</th>
        {header('assists', 'A', 'Sort by assists')}
        {header('kda', 'KDA', 'Sort by KDA: (kills + assists) ÷ deaths')}
        {header('mvps', 'MVP', 'Sort by MVP awards')}
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.key} className={row.rank === 1 ? 'is-leader' : undefined}>
        <td className="leaderboard-rank">{row.rank ?? <span title={`Ranked by KDA after ${KDA_MIN_GAMES} games`}>–</span>}</td>
        <th scope="row">
          <button type="button" className="standings-team-button" aria-haspopup="dialog" onClick={() => onOpen(row.key)}>
            <CollegeLogo code={row.collegeCode || row.teamName.slice(0, 3)} size="sm" />
            <span>{row.ign}<small>{row.teamName}{row.collegeCode ? ` · ${row.collegeCode}` : ''}</small></span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </th>
        <td>{row.games}</td><td>{row.wins}–{row.losses}</td>
        <td>{row.kills}</td><td>{row.deaths}</td><td>{row.assists}</td>
        <td className={sort === 'kda' ? 'is-sorted' : undefined}>{row.games ? formatKda(row) : '–'}</td>
        <td>{row.mvps}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function LeaderboardNotes({ board }: { board: GameLeaderboard }) {
  const pending = [
    board.liveMatches ? `${plural(board.liveMatches, 'match')} in progress will count once the result is final.` : '',
    board.finishedWithoutStats ? `${plural(board.finishedWithoutStats, 'finished match')} ${board.finishedWithoutStats === 1 ? 'has' : 'have'} no player stats yet.` : '',
  ].filter(Boolean);
  return <div className="leaderboard-notes">
    {pending.length > 0 && <p className="leaderboard-note" role="status">{pending.join(' ')}</p>}
    <p className="studio-muted">Finished series with a valid result only. Every game played in a series is added up. KDA is (kills + assists) ÷ deaths, with no deaths counted as one; a player needs {KDA_MIN_GAMES} games with stats for a KDA rank. Ties share a rank. A player is matched across tournaments by game, college and in-game name.</p>
    <details className="leaderboard-sources">
      <summary>Tournaments counted ({board.tournaments.filter(t => t.countedMatches).length})</summary>
      <ul>{board.tournaments.map(t => <li key={t.id}>
        <span>{t.title}</span>
        <small>{t.current ? 'Current' : 'Past'} · {t.countedMatches ? plural(t.countedMatches, 'match') : 'no player stats yet'}</small>
      </li>)}</ul>
    </details>
  </div>;
}

function PlayerHistory({ row }: { row: LeaderboardRow }) {
  return <>
    <div className="standings-summary leaderboard-summary">
      <div><span>KDA</span><strong>{row.games ? formatKda(row) : '–'}</strong></div>
      <div><span>K / D / A</span><strong>{row.kills}/{row.deaths}/{row.assists}</strong></div>
      <div><span>Series</span><strong>{row.wins}–{row.losses}</strong></div>
      <div><span>MVPs</span><strong>{row.mvps}</strong></div>
    </div>
    <p className="studio-muted">{plural(row.games, 'game')} with stats in {plural(row.matches, 'match')} across {plural(row.tournaments, 'tournament')}.</p>
    <div className="standings-match-history">{[...row.history].reverse().map(line => <article key={`${line.tournamentId}:${line.matchId}`}>
      <span className={line.won ? 'series-result-won' : 'series-result-lost'}>{line.won ? 'Won' : 'Lost'}</span>
      <div>
        <strong>vs {line.opponent}{line.mvp && <span className="leaderboard-mvp">MVP</span>}</strong>
        <small>{line.tournamentTitle} · {line.roundName}{line.date ? ` · ${line.date}` : ''}</small>
        <small>{line.games ? `${plural(line.games, 'game')}: ${line.kills}/${line.deaths}/${line.assists}` : 'No stats entered'}</small>
      </div>
      <b>{line.seriesScore}</b>
    </article>)}</div>
  </>;
}
