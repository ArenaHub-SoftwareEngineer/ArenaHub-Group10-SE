import React, { useState } from 'react';
import type { BracketDraft } from '../../lib/types';
import { getTournamentStandings, completedSeries } from '../../lib/standings';
import { bracketScheduleLabel } from '../../lib/calendar';
import { Modal } from '../ui/Modal';
import { CollegeLogo } from '../common/CollegeLogo';
import { PlayerRoster } from './PlayerRoster';
import { Search, ChevronRight } from 'lucide-react';
import './StandingsDetails.css';
import { Trophy } from '../ui/Icons';
import { PlacementStandingsView } from './PlacementStandingsView';

export function StandingsView({ bracket }: { bracket?: BracketDraft }) {
  const rows = bracket?.status === 'published' ? getTournamentStandings(bracket.matches) : [];
  const isSwiss = !!bracket?.matches.some(match => match.tournamentFormat === 'swiss');
  const [search,setSearch]=useState(''),[selectedId,setSelectedId]=useState<string|null>(null),[detailTab,setDetailTab]=useState('matches');
  const selected=rows.find(row=>row.team.id===selectedId);
  const filtered=rows.filter(row=>`${row.team.name} ${row.team.collegeCode}`.toLowerCase().includes(search.toLowerCase().trim()));
  const history=selected && bracket?completedSeries(bracket.matches).filter(entry=>entry.team1.id===selected.team.id||entry.team2.id===selected.team.id):[];
  if (!rows.length) return <section className="arena-panel standings-empty"><Trophy size={22} aria-hidden="true"/><div><h2>No results yet</h2><p>Team records appear after a played match has a valid published result.</p></div></section>;
  return <section className="arena-panel published-standings">
    <div className="standings-tools"><div><h2>Team records</h2><p>Select a team to inspect its results and players.</p></div><label><Search size={15}/><input aria-label="Find a team in standings" type="search" placeholder="Find a team" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
    <div className="overflow-x-auto"><table><caption className="sr-only">Published results for {bracket?.title}</caption><thead><tr><th scope="col">Team</th><th scope="col">Matches (W–L)</th><th scope="col">Games (W–L)</th>{isSwiss&&<th scope="col"><abbr title="Total wins of the teams this team played">Buchholz</abbr></th>}<th scope="col">Series win rate</th></tr></thead><tbody>{filtered.map(({team,wins,losses,gameWins,gameLosses,buchholz})=><tr key={team.id}><th scope="row"><button type="button" className="standings-team-button" aria-haspopup="dialog" onClick={()=>{setSelectedId(team.id);setDetailTab('matches');}}><CollegeLogo code={team.collegeCode} size="sm"/><span>{team.name}<small>{team.collegeCode}</small></span><ChevronRight size={15}/></button></th><td>{wins}–{losses}</td><td>{gameWins}–{gameLosses}</td>{isSwiss&&<td>{buchholz}</td>}<td><span className="standings-percent">{Math.round(wins/(wins+losses)*100)}%</span><span className="standings-record-bar"><span style={{width:`${wins/(wins+losses)*100}%`}}/></span></td></tr>)}</tbody></table></div>
    {!filtered.length && <p className="broadcast-copy" role="status">No teams match “{search}”.</p>}
    <p className="studio-muted">{isSwiss ? 'Swiss ranking: series wins (including byes), then Buchholz (total wins of opponents), game difference and seed. Games count played series only.' : 'Completed, played series only. BYEs are excluded.'} {isSwiss ? 'Rankings remain provisional until all rounds finish.' : 'These records do not determine final bracket placement or Battle Royale placement points.'}</p>
    <Modal open={!!selected} onClose={()=>setSelectedId(null)} title={selected?.team.name || 'Team results'} description={bracket?.title} className="standings-detail-dialog">
      {selected && <><div className="standings-summary"><div><span>Matches won</span><strong>{selected.wins}</strong></div><div><span>Matches lost</span><strong>{selected.losses}</strong></div><div><span>Games</span><strong>{selected.gameWins}–{selected.gameLosses}</strong></div></div><div className="broadcast-segments" role="group" aria-label="Team details"><button type="button" aria-pressed={detailTab==='matches'} onClick={()=>setDetailTab('matches')}>Matches</button><button type="button" aria-pressed={detailTab==='players'} onClick={()=>setDetailTab('players')}>Players</button></div>{detailTab==='players'?<PlayerRoster team={selected.team}/>:<div className="standings-match-history">{selected.byes > 0 && <p className="studio-muted">{selected.byes} automatic bye win{selected.byes === 1 ? '' : 's'}. No games were played for a bye.</p>}{history.map(({match,winner,team1,team2})=><article key={match.id}><span className={winner===selected.team.id?'series-result-won':'series-result-lost'}>{winner===selected.team.id?'Won':'Lost'}</span><div><strong>vs {team1.id===selected.team.id?team2.name:team1.name}</strong><small>{match.roundName} · {bracketScheduleLabel(match)}</small></div><b>{team1.id===selected.team.id?`${match.score.team1Score}–${match.score.team2Score}`:`${match.score.team2Score}–${match.score.team1Score}`}</b></article>)}</div>}</>}
    </Modal>
  </section>;
}

export function StandingsPage({ brackets, selectedId, onSelect }: { brackets: BracketDraft[]; selectedId?: string | null; onSelect: (id: string) => void }) {
  const bracket = brackets.find(item => item.id === selectedId) ?? brackets[0];

  return <div className="module-page">
    <header className="dashboard-page-heading"><h1>Standings</h1><p>Results by published bracket.</p></header>
    {brackets.length > 1 && <label className="module-form viewer-bracket-selector">Published bracket
      <select value={bracket.id} onChange={event => onSelect(event.target.value)}>
        {brackets.map(item => <option value={item.id} key={item.id}>{item.gameName} · {item.title}</option>)}
      </select>
    </label>}
    {bracket?.placement ? <PlacementStandingsView key={bracket.id} event={bracket.placement} /> : <StandingsView key={bracket?.id} bracket={bracket} />}
  </div>;
}
