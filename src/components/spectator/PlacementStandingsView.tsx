import React, { useMemo, useState } from 'react';
import { computeStandings, placementPoints, tiebreakReason, type PlacementEvent } from '../../lib/formats/placement';
import { CollegeLogo } from '../common/CollegeLogo';
import { ChevronDown } from '../ui/Icons';
import './placement.css';

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const statusLabel = { upcoming: 'Upcoming', live: 'Live', completed: 'Final' } as const;

/** Battle Royale standings: aggregate points across every completed lobby game. */
export const PlacementStandingsView: React.FC<{ event: PlacementEvent }> = ({ event }) => {
  const standings = useMemo(() => computeStandings(event), [event]);
  const completed = event.games.filter(g => g.status === 'completed').length;
  const live = event.games.find(g => g.status === 'live');
  const [openGame, setOpenGame] = useState<string | null>(null);
  const names = new Map(event.teams.map(t => [t.id, t]));
  const notes = standings.slice(1).map((row, i) => {
    const reason = tiebreakReason(standings[i], row);
    return reason ? `${standings[i].name} ranks above ${row.name} on ${reason}.` : null;
  }).filter(Boolean);

  return <div className="placement-view">
    <section className="arena-panel placement-summary" aria-label="Scoring">
      <div><strong>{completed}</strong><span>of {event.games.length} games final</span></div>
      <div><strong>{event.config.killPoints}</strong><span>point{event.config.killPoints === 1 ? '' : 's'} per elimination</span></div>
      <p className="placement-table-points">Placement points: {event.config.pointsTable.map((p, i) => `${ordinal(i + 1)} ${p}`).join(' · ')}{event.config.pointsTable.length < event.teams.length ? ` · ${ordinal(event.config.pointsTable.length + 1)} and below 0` : ''}</p>
      {live && <p className="placement-live" role="status"><i aria-hidden="true" />{live.label} is live</p>}
    </section>

    <section className="arena-panel placement-standings" aria-labelledby="placement-standings-title">
      <h2 id="placement-standings-title">Overall standings</h2>
      {!completed && <p className="studio-muted">No games are final yet. Standings appear after the first game.</p>}
      <div className="placement-table-wrap" tabIndex={0} aria-label="Standings table, scrolls sideways on small screens">
        <table className="placement-table">
          <thead><tr>
            <th scope="col">#</th><th scope="col">Squad</th><th scope="col" className="num">Games</th><th scope="col" className="num">Wins</th>
            <th scope="col" className="num">Place pts</th><th scope="col" className="num">Elims</th><th scope="col" className="num">Elim pts</th><th scope="col" className="num">Total</th>
          </tr></thead>
          <tbody>{standings.map(row => <tr key={row.teamId} className={row.rank === 1 && completed ? 'is-leader' : undefined}>
            <td className="rank">{completed ? row.rank : '–'}</td>
            <th scope="row"><span className="placement-squad"><CollegeLogo code={row.collegeCode || row.name.slice(0, 3)} size="sm" /><span>{row.name}{row.collegeCode && <small>{row.collegeCode}</small>}</span></span></th>
            <td className="num">{row.gamesPlayed}</td><td className="num">{row.wins}</td>
            <td className="num">{row.placementPoints}</td><td className="num">{row.kills}</td><td className="num">{row.killPoints}</td>
            <td className="num total">{row.total}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="field-hint">Ties are broken by placement points, then best single placement, then eliminations, then the latest game.</p>
      {notes.length > 0 && <ul className="placement-notes">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
    </section>

    <section className="arena-panel placement-games" aria-labelledby="placement-games-title">
      <h2 id="placement-games-title">Games</h2>
      <ul>{event.games.map(game => {
        const open = openGame === game.id;
        return <li key={game.id} className={`placement-game status-${game.status}`}>
          <button type="button" aria-expanded={open} disabled={!game.results.length} onClick={() => setOpenGame(open ? null : game.id)}>
            <span>{game.label}</span>
            <small>{[statusLabel[game.status], game.scheduledDate, game.scheduledTime].filter(Boolean).join(' · ')}</small>
            {game.results.length > 0 && <>
              <span className="placement-game-winner">{names.get(game.results[0].teamId)?.name || 'Squad'} won</span>
              <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
            </>}
          </button>
          {open && <ol className="placement-game-results">{game.results.map(result => <li key={result.teamId}>
            <span className="place">{ordinal(result.placement)}</span>
            <span className="name">{names.get(result.teamId)?.name || 'Squad'}</span>
            <span className="num">{result.kills} elim{result.kills === 1 ? '' : 's'}</span>
            <span className="num pts">{placementPoints(event.config, result.placement) + result.kills * event.config.killPoints} pts</span>
          </li>)}</ol>}
        </li>;
      })}</ul>
    </section>
  </div>;
};
