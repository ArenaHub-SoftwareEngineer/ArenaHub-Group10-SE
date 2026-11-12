import type { Match, Team } from './types';
import { validateScore } from './integrityChecks';
function playing(team?:Team):team is Team {return Boolean(team?.id && !team.isBye && !['bye','tbd'].includes(team.name.trim().toLowerCase()));}
export function completedSeries(matches:Match[]) {
  return matches.flatMap(match=>{
    if(match.status!=='completed'||!playing(match.team1)||!playing(match.team2)||match.team1.id===match.team2.id)return [];
    try{validateScore(match.matchFormat,match.score.team1Score,match.score.team2Score,true);}catch{return [];}
    const winner=match.score.team1Score>match.score.team2Score?match.team1.id:match.team2.id;
    if(match.winnerId && match.winnerId!==winner)return [];
    return [{match,winner,team1:match.team1,team2:match.team2}];
  });
}
export function getStandings(matches:Match[]) {
  const rows=new Map<string,{team:Team;wins:number;losses:number;gameWins:number;gameLosses:number}>();
  for(const {match,winner,team1,team2} of completedSeries(matches)){
    [team1,team2].forEach((team,side)=>{const row=rows.get(team.id)||{team,wins:0,losses:0,gameWins:0,gameLosses:0};row.wins+=Number(team.id===winner);row.losses+=Number(team.id!==winner);row.gameWins+=side===0?match.score.team1Score:match.score.team2Score;row.gameLosses+=side===0?match.score.team2Score:match.score.team1Score;rows.set(team.id,row);});
  }
  return [...rows.values()].sort((a,b)=>b.wins-a.wins||a.losses-b.losses||a.team.name.localeCompare(b.team.name));
}
