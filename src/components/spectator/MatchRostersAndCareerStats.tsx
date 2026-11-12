import React from 'react';
import type { Match } from '../../lib/types';
import { PlayerRoster } from './PlayerRoster';
export function MatchRostersAndCareerStats({ match }: { match: Match }) {
  return <div className="match-player-lineups"><header className="lineups-heading"><div><h2>Players</h2><p>Tap a player to see their profile and career high.</p></div></header>
    {[match.team1,match.team2].map((team,index) => team ? <PlayerRoster key={`${match.id}:${team.id}:${index}`} team={team} /> : <p className="roster-empty" key={index}>Lineup to be confirmed.</p>)}
  </div>;
}
