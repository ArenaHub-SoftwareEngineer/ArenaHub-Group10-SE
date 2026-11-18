import React, { useState } from 'react';
import type { College, Team } from '../../lib/types';
import { RANK_GAMES, isRetiredGame, rankGame, type RankGame } from '../../lib/gameRanks';
import { RankGuide } from './RankGuide';
import { ArrowLeft, ChevronRight, Users } from '../ui/Icons';
import { PlayerRoster } from './PlayerRoster';
import { CollegeLogo } from '../common/CollegeLogo';
import { GameArtworkTiles } from '../common/GameArtworkTiles';
import { teamInCollege } from '../../lib/playerProfiles';
import { CAMPUS_SHORT_NAME } from '../../lib/institution';

const games = Object.fromEntries(RANK_GAMES.map(g=>[g.id,g]));

export const TeamsView = ({ colleges, teams }: { colleges: College[]; teams: Team[] }) => {
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [guide, setGuide] = useState<RankGame>('mlbb');
  const [guideOpen,setGuideOpen] = useState(false);
  const visibleTeams = teams.filter(t=>!isRetiredGame(t));
  const college = colleges.find(c => c.id === collegeId);
  const collegeTeams = college ? visibleTeams.filter(t => teamInCollege(t, college) && !t.isBye) : [];
  const teamGame = (t:Team)=>rankGame(t.gameId,t.gameMode) || t.gameId;
  // Every game is listed, so a college with no Dota 2 team sees that plainly instead of a missing tile.
  const gameIds = [...new Set([...RANK_GAMES.map(g => g.id as string), ...collegeTeams.map(teamGame)])];
  const selectedTeams = collegeTeams.filter(t => teamGame(t) === gameId);

  return (
    <div className="team-directory">
      <RankGuide key={guide} open={guideOpen} onClose={()=>setGuideOpen(false)} initialGame={guide}/>
      {college ? (
        <>
          <button
            type="button"
            className="directory-back"
            onClick={() => (gameId ? setGameId(null) : setCollegeId(null))}
          >
            <ArrowLeft size={16} />
            {gameId ? 'Back to games' : 'All colleges'}
          </button>
          <header className="directory-heading flex items-start gap-4">
            <CollegeLogo code={college.code} size="xl" className="mt-1 shadow-lg" />
            <div>
              <span className="section-overline">
                {college.code}
                {gameId ? ` / ${games[gameId]?.name || gameId}` : ''}
              </span>
              <h1>{college.name}</h1>
              <p>
                {gameId
                  ? 'Tap a player to see their profile and career high.'
                  : 'Choose a game to meet the roster.'}
              </p>
            </div>
          </header>
          {gameId ? (
            <>
              {selectedTeams.length ? (
                selectedTeams.map(team => <PlayerRoster key={team.id} team={team} />)
              ) : (
                <p className="roster-empty">No teams registered for {games[gameId]?.name || 'this game'} yet.</p>
              )}
            </>
          ) : (
            <div className="directory-games">
              {gameIds.map(id => {
                const game = games[id];
                const name = game?.name || id.replace('game-', '');
                const gameTeams = collegeTeams.filter(t => teamGame(t) === id);
                const players = gameTeams.reduce((n, t) => n + t.players.length, 0);
                if (!gameTeams.length) return (
                  <div key={id} className="directory-game is-empty">
                    {game && <img src={game.image} alt="" loading="lazy" />}
                    <div><span><strong>{name}</strong><small>No teams registered for {name} yet</small></span></div>
                  </div>
                );
                return (
                  <button
                    key={id}
                    type="button"
                    className="directory-game"
                    onClick={() => setGameId(id)}
                  >
                    {game && <img src={game.image} alt="" loading="lazy" />}
                    <div>
                      <span>
                        <strong>{name}</strong>
                        <small>{gameTeams.length} team{gameTeams.length === 1 ? '' : 's'}{players ? ` · ${players} player${players === 1 ? '' : 's'}` : ''}</small>
                      </span>
                      <ChevronRight size={19} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <header className="directory-heading">
            <span className="section-overline">Campus esports</span>
            <h1>Players & teams</h1>
            <p>Find your college, then open a game to meet its roster.</p>
          </header>
          <div className="directory-colleges">
            {colleges.map(c => {
              const entries = visibleTeams.filter(t => teamInCollege(t, c) && !t.isBye);
              const played = c.stats.wins + c.stats.losses;
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => {
                    setCollegeId(c.id);
                    setGameId(null);
                  }}
                  className="group hover:border-(--brand)/60 transition-all"
                >
                  <div className="flex items-center gap-3 w-full">
                    <CollegeLogo code={c.code} size="lg" className="transition-transform group-hover:scale-105" />
                    <div className="flex flex-col">
                      <span className="tabular-nums text-xs font-bold text-(--brand-ink)">
                        {c.code}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] leading-tight">
                        {CAMPUS_SHORT_NAME} college
                      </span>
                    </div>
                  </div>
                  <strong>{c.name}</strong>
                  <small>
                    <Users size={13} />
                    {entries.length ? `${entries.length} team${entries.length === 1 ? '' : 's'}` : 'No teams registered yet'}
                  </small>
                  {/* Record from completed, published matches only (lib/colleges.ts). */}
                  {played > 0 && <small className="directory-college-record">
                    {c.stats.wins}W {c.stats.losses}L in series · {c.stats.status === 'Eliminated' ? 'Eliminated' : 'Still competing'}
                  </small>}
                  <ChevronRight className="directory-college-arrow" size={17} />
                </button>
              );
            })}
          </div>
        </>
      )}
      {/* Rank explorer sits under the directory: the page is about colleges and players first. */}
      <section className="rank-discovery" aria-labelledby="rank-discovery-title"><header><div><h2 id="rank-discovery-title">Game ranks</h2><p>Choose a game to compare its competitive ranks.</p></div></header><GameArtworkTiles label="Choose a game to explore ranks" opensDialog onSelect={id=>{setGuide(id as RankGame);setGuideOpen(true);}}/></section>
    </div>
  );
};
