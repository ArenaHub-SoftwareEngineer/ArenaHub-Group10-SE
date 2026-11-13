import React, { useState } from 'react';
import type { College, Team } from '../../lib/types';
import { RANK_GAMES, isRetiredGame, rankGame, type RankGame } from '../../lib/gameRanks';
import { RankGuide } from './RankGuide';
import { ArrowLeft, ChevronRight, Users } from '../ui/Icons';
import { PlayerRoster } from './PlayerRoster';
import { CollegeLogo } from '../common/CollegeLogo';
import { GameArtworkTiles } from '../common/GameArtworkTiles';

const games = Object.fromEntries(RANK_GAMES.map(g=>[g.id,g]));

export const TeamsView = ({ colleges, teams }: { colleges: College[]; teams: Team[] }) => {
  const [collegeId, setCollegeId] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [guide, setGuide] = useState<RankGame>('mlbb');
  const [guideOpen,setGuideOpen] = useState(false);
  const visibleTeams = teams.filter(t=>!isRetiredGame(t));
  const college = colleges.find(c => c.id === collegeId);
  const collegeTeams = visibleTeams.filter(t => t.collegeId === collegeId && !t.isBye);
  const teamGame = (t:Team)=>rankGame(t.gameId,t.gameMode) || t.gameId;
  const gameIds = [...new Set(collegeTeams.map(teamGame))];
  const selectedTeams = collegeTeams.filter(t => teamGame(t) === gameId);

  return (
    <div className="team-directory">
      <section className="rank-discovery"><header><div><span className="section-overline">The competitive ladder</span><h2>Explore the ranks</h2><p>Pick a game. Find your medal and see what comes next.</p></div></header><GameArtworkTiles label="Choose a game to explore ranks" opensDialog onSelect={id=>{setGuide(id as RankGame);setGuideOpen(true);}}/></section>
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
                <p className="roster-empty">No roster has been added for this game.</p>
              )}
            </>
          ) : (
            <div className="directory-games">
              {gameIds.map(id => {
                const game = games[id];
                const count = collegeTeams
                  .filter(t => teamGame(t) === id)
                  .reduce((n, t) => n + t.players.length, 0);
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
                        <strong>{game?.name || id.replace('game-', '')}</strong>
                        <small>{count} players</small>
                      </span>
                      <ChevronRight size={19} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {!gameId && !gameIds.length && (
            <p className="roster-empty">No game rosters have been added yet.</p>
          )}
        </>
      ) : (
        <>
          <header className="directory-heading">
            <span className="section-overline">Campus esports</span>
            <h1>Players & teams</h1>
            <p>Find your college. Meet your players.</p>
          </header>
          <div className="directory-colleges">
            {colleges.map(c => {
              const entries = visibleTeams.filter(t => t.collegeId === c.id && !t.isBye);
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
                        WMSU Unit
                      </span>
                    </div>
                  </div>
                  <strong>{c.name}</strong>
                  <small>
                    <Users size={13} />
                    {entries.length} game roster{entries.length === 1 ? '' : 's'}
                  </small>
                  <ChevronRight className="directory-college-arrow" size={17} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
