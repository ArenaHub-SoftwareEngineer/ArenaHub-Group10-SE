import type { BracketDraft, Match, Team } from './types';
import { completedSeries, getStandings } from './standings';
import { isRetiredGame } from './gameRanks';
import { scheduleDate, timeOrder, manilaToday } from './calendar';
import { computeStandings, lobbyMatches, type PlacementEvent } from './formats/placement';

export interface KnowledgeReference {label:string;bracketId:string;matchId?:string}
export interface KnowledgeSnapshot {revision:number;checkedAt:string;origin:'server'|'loaded';brackets:BracketDraft[]}
export interface KnowledgeAnswer {text:string;references:KnowledgeReference[];kind:'records'|'help';needsModel?:boolean}
const str=(value:unknown,max=180)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').slice(0,max):'';
const number=(value:unknown)=>typeof value==='number' && Number.isFinite(value)?value:NaN;
const md=(value:string)=>value.replace(/[\\`*_{}\[\]<>#|]/g,'\\$&');
function placementOf(value:any):PlacementEvent|undefined {
  if(!value || typeof value!=='object' || !Array.isArray(value.teams) || !Array.isArray(value.games))return undefined;
  const int=(v:unknown)=>Number.isInteger(v)?v as number:0;
  return {config:{pointsTable:Array.isArray(value.config?.pointsTable)?value.config.pointsTable.slice(0,25).map(int):[],killPoints:int(value.config?.killPoints)},
    teams:value.teams.slice(0,25).map((t:any)=>({id:str(t?.id),name:str(t?.name),collegeCode:str(t?.collegeCode,30)})),
    games:value.games.slice(0,24).map((g:any)=>({id:str(g?.id),label:str(g?.label,40),status:['live','completed'].includes(g?.status)?g.status:'upcoming',scheduledDate:str(g?.scheduledDate,40),scheduledTime:str(g?.scheduledTime,40),results:Array.isArray(g?.results)?g.results.slice(0,25).map((r:any)=>({teamId:str(r?.teamId),placement:int(r?.placement),kills:int(r?.kills)})):[]}))};
}
/** Battle Royale results: placement points, never head-to-head records. */
function placementBlock(b:BracketDraft) {
  const event=b.placement!,rows=computeStandings(event),done=event.games.filter(g=>g.status==='completed').length;
  if(!done)return `**${md(b.title)}**\n\nNo lobby game has finished yet. ${event.games.length} games are planned for ${event.teams.length} squads.`;
  const finished=done===event.games.length;
  const lead=finished?`${md(rows[0].name)} won with ${rows[0].total} points.`:`After ${done} of ${event.games.length} games (not final):`;
  return `**${md(b.title)}**\n\n${lead}\n\n${rows.slice(0,8).map(r=>`- #${r.rank} ${md(r.name)}${r.collegeCode?` (${md(r.collegeCode)})`:''}: ${r.total} points, ${r.kills} eliminations.`).join('\n')}`;
}
/** Only fields needed for public tournament questions enter the assistant context. */
export function knowledgeSnapshot(raw:unknown,revision=0,checkedAt=new Date().toISOString(),origin:KnowledgeSnapshot['origin']='server'):KnowledgeSnapshot {
  const raw0=raw;
  const team=(value:any):Team|undefined=>value && typeof value==='object'?{id:str(value.id),name:str(value.name),collegeCode:str(value.collegeCode,30),collegeId:'',gameId:str(value.gameId),seed:number(value.seed),winRate:0,record:'',isBye:value.isBye===true,players:Array.isArray(value.players)?value.players.slice(0,12).map((p:any)=>({id:'',name:'',collegeId:'',isVerified:false,ign:str(p?.ign,80),role:str(p?.role,80)})):[]}:undefined;
  const brackets:BracketDraft[]=Array.isArray(raw)?raw.filter(b=>b?.status==='published' && !isRetiredGame(b)).slice(0,100).map(b=>({
    id:str(b.id),title:str(b.title),gameId:str(b.gameId),gameName:str(b.gameName),format:str(b.format),matchFormat:str(b.matchFormat),teamsCount:number(b.teamsCount),status:'published',createdAt:str(b.createdAt),teams:[],parsedParams:{},rawPrompt:'',seedingRule:'',
    matches:Array.isArray(b.matches)?b.matches.slice(0,2048).map((m:any)=>({id:str(m?.id),matchNumber:str(m?.matchNumber),tournamentId:str(b.id),gameId:str(m?.gameId),gameMode:m?.gameMode==='br'?'br':m?.gameMode==='mp'?'mp':undefined,round:number(m?.round),roundName:str(m?.roundName),bracketType:str(m?.bracketType),status:str(m?.status),matchFormat:str(m?.matchFormat),team1:team(m?.team1),team2:team(m?.team2),score:{team1Score:number(m?.score?.team1Score),team2Score:number(m?.score?.team2Score)},winnerId:str(m?.winnerId),nextMatchId:str(m?.nextMatchId),inactive:m?.inactive===true,conditionalReset:m?.conditionalReset===true,scheduledDate:str(m?.scheduledDate),scheduledTime:str(m?.scheduledTime),organizerName:'',...(m?.mvp && typeof m.mvp==='object' && str(m.mvp.ign,80)?{mvp:{playerName:'',ign:str(m.mvp.ign,80),role:str(m.mvp.role,80),teamCode:str(m.mvp.teamCode,30)}}:{})})):[],
  } as unknown as BracketDraft)).map(b=>{const raw=(Array.isArray(raw0)?raw0:[]).find((r:any)=>str(r?.id)===b.id);const placement=placementOf(raw?.placement);return placement?{...b,placement,matches:lobbyMatches({...b,placement})}:b;}):[];
  return {revision:Number.isFinite(revision)?revision:0,checkedAt,origin,brackets};
}
function gameQuery(query:string) {
  if(/\bmlbb\b|mobile legends/i.test(query))return 'mlbb';
  if(/\bdota\s*2?\b/i.test(query))return 'dota2';
  if(/\bcodm\b|call of duty/i.test(query))return /battle royale|\bbr\b/i.test(query)?'codm-br':/multiplayer|\bmp\b/i.test(query)?'codm-mp':'codm';
  // Games ArenaHub does not run: name them so the answer says so instead of covering every game.
  const other=query.match(/\b(valorant|league of legends|tekken|pubg|free fire|honor of kings|wild rift)\b/i);
  if(other)return other[1].toLowerCase();
}
function gameOf(bracket:BracketDraft) {return gameQuery(`${bracket.gameName} ${bracket.gameId?.replaceAll('-',' ')}`);}
/** What the viewer was looking at when they asked. Used only when the question names nothing itself. */
export interface KnowledgeFocus {bracketId:string;matchId?:string}
export function selectKnowledge(snapshot:KnowledgeSnapshot,query:string,history:Array<{role:string;text:string}>=[],focus?:KnowledgeFocus|null) {
  const own=selectFromQuery(snapshot,query,history);
  if(!focus || own.game || own.teamIds.size || own.brackets.length!==snapshot.brackets.length)return own;
  const bracket=snapshot.brackets.find(b=>b.id===focus.bracketId);
  if(!bracket)return own;
  const match=focus.matchId?bracket.matches.find(m=>m.id===focus.matchId):undefined;
  return {game:gameOf(bracket),brackets:[bracket],teamIds:new Set([match?.team1?.id,match?.team2?.id].filter((id):id is string=>!!id))};
}
function selectFromQuery(snapshot:KnowledgeSnapshot,query:string,history:Array<{role:string;text:string}>) {
  let game=gameQuery(query);
  if(!game && /\b(who won|winner|champion|that|they|it|next|score|sila|yun|iyon|ito|nanalo|panalo|sunod|susunod)\b/i.test(query) && !/\b(all|lahat)\b/i.test(query))game=history.filter(m=>m.role==='user').map(m=>gameQuery(m.text)).filter(Boolean).at(-1);
  let brackets=snapshot.brackets.filter(b=>!game || (game==='codm'?gameOf(b)?.startsWith('codm'):gameOf(b)===game));
  const q=query.toLowerCase();
  const named=brackets.filter(b=>b.title.length>=4 && q.includes(b.title.toLowerCase()));
  if(named.length)brackets=named;
  const teamMatches=brackets.flatMap(b=>b.matches).flatMap(m=>[m.team1,m.team2]).filter((t):t is Team=>!!t && t.name.length>=3 && q.includes(t.name.toLowerCase()));
  const teamIds=new Set(teamMatches.map(t=>t.id));
  return {game,brackets,teamIds};
}
export function recordedChampion(bracket:BracketDraft) {
  if(/round.?robin|group|battle royale|placement/i.test(bracket.format+' '+bracket.gameName+' '+bracket.gameId))return null;
  const finals=bracket.matches.filter(m=>m.bracketType==='final' || (!m.nextMatchId && /\b(?:grand final|finals?|championship)\b/i.test(m.roundName)));
  const reset=finals.find(m=>m.conditionalReset),first=finals.find(m=>!m.conditionalReset);
  if(reset){
    if(!first || first.status!=='completed')return null;
    const firstResult=completedSeries([first])[0];if(!firstResult)return null;
    // The repository's double-elimination graph assigns the upper finalist to slot one.
    if(firstResult.winner===first.team2?.id){const result=completedSeries([reset])[0];return !reset.inactive && result?result:null;}
    return firstResult;
  }
  const terminal=finals.filter(m=>!m.nextMatchId && !m.inactive);
  return terminal.length===1?completedSeries(terminal)[0] || null:null;
}
function score(match:Match) {if(match.lobby)return match.status==='completed'?`won by ${md(match.lobby.winner || 'a recorded squad')}`:match.status==='live'?'lobby in progress':'lobby game';
  // An unplayed match has no score; "0–0" would read as a result.
  if(match.status==='upcoming'||match.status==='pre-match')return 'not played yet';
  return [match.score.team1Score,match.score.team2Score].every(Number.isFinite)?`${match.score.team1Score}–${match.score.team2Score}`:'score not recorded';}
const matchup=(m:Match)=>m.lobby?`${md(m.roundName)}, ${m.lobby.squads} squads`:`${md(m.team1?.name || 'Awaiting team')} vs ${md(m.team2?.name || 'Awaiting team')}`;
const validMatch=(m:Match)=>!m.inactive && !m.team1?.isBye && !m.team2?.isBye;
export function answerTournamentQuestion(snapshot:KnowledgeSnapshot,query:string,history:Array<{role:string;text:string}>=[],focus?:KnowledgeFocus|null):KnowledgeAnswer {
  const q=query.trim().toLowerCase(),selected=selectKnowledge(snapshot,query,history,focus),refs:KnowledgeReference[]=[];
  const reference=(b:BracketDraft,m?:Match)=>{if(refs.length<12 && !refs.some(r=>r.bracketId===b.id && r.matchId===m?.id))refs.push({label:m?`${b.title} · ${m.matchNumber || m.roundName}`:b.title,bracketId:b.id,...(m?{matchId:m.id}:{})});};
  // Questions a model answers better (judgement, stories, predictions); the records reply is the fallback without one.
  const askModel=/\b(best player|best team|pinakamagaling|magaling|highlights?|what happened|nangyari|timeline|key moments|predict|prediction|chances?|mananalo|favou?rites?|will [\w ]{2,30} win|who should)\b/.test(q);
  const reply=(text:string,kind:KnowledgeAnswer['kind']='records',needsModel=false):KnowledgeAnswer=>({text,references:refs,kind,needsModel:needsModel||askModel});
  if(/cheat|fair.?play|evidence|report/.test(q))return reply('Open Fair play to submit a recording or review match evidence. Organizers can inspect sampled frames and returned observations. A referee must confirm the finding; a replay alone cannot prove hidden software or input automation.','help',!/\bwhere\b|\bhow\b.*(?:upload|submit|report)|\bcan\b.*detect/.test(q));
  // "Explain seeding" needs no bracket; only record questions stop at "nothing is published".
  const explanatory=/\b(explain|how|why|what (?:is|are|does)|meaning|rules?|help)\b/.test(q);
  if(!selected.brackets.length)return reply(snapshot.brackets.length?`No published bracket matches ${selected.game?selected.game.toUpperCase():'that tournament'}. Available brackets:\n\n${snapshot.brackets.slice(0,8).map(b=>`- ${md(b.title)} — ${md(b.gameName)}`).join('\n')}`:'No official brackets are published in the records I just checked. Once an organizer publishes one, I can answer questions about its matches, scores, and players.','records',explanatory);
  // MVPs are recorded by organizers per match and credited by in-game name.
  if(/\bmvp\b/.test(q)){
    const rows=selected.brackets.flatMap(b=>b.matches.filter(m=>m.mvp && typeof m.mvp==='object' && (!selected.teamIds.size||selected.teamIds.has(m.team1?.id||'')||selected.teamIds.has(m.team2?.id||''))).filter(m=>!/\bm\d+\b/.test(q)||q.includes((m.matchNumber||'').toLowerCase())).map(m=>({b,m,mvp:m.mvp as Exclude<Match['mvp'],string|undefined>})));
    return reply(rows.length?rows.slice(0,8).map(({b,m,mvp})=>{reference(b,m);return `- ${md(m.matchNumber||m.roundName)} (${md(m.roundName)}), ${matchup(m)}: MVP ${md(mvp.ign)}${mvp.role?`, ${md(mvp.role)}`:''}${mvp.teamCode?` (${md(mvp.teamCode)})`:''}.`;}).join('\n'):'No MVP is recorded yet for this selection. Organizers add one after a match ends.');
  }
  // English and Taglish ("sino nanalo", "kelan laban", "sino maglalaro mamaya").
  const winnerQuestion=/\b(winner|won|champion|champs?|nanalo|panalo|nagwagi|nagchampion|result|resulta)\b/.test(q);
  if(winnerQuestion){
    const blocks=selected.brackets.map(b=>{
      reference(b);if(b.placement)return placementBlock(b);const champion=recordedChampion(b);
      const namedMatch=b.matches.filter(m=>m.matchNumber && q.includes(m.matchNumber.toLowerCase()));
      const candidates=namedMatch.length?namedMatch:b.matches.filter(m=>!selected.teamIds.size || selected.teamIds.has(m.team1?.id || '') || selected.teamIds.has(m.team2?.id || ''));
      if(champion && !namedMatch.length && !selected.teamIds.size){reference(b,champion.match);const winner=champion.winner===champion.team1.id?champion.team1:champion.team2;return `**${md(winner.name)} won ${md(b.title)}.**\n\nFinal: ${matchup(champion.match)}, ${score(champion.match)}.`;}
      const completed=completedSeries(candidates).filter(entry=>validMatch(entry.match));
      if(!completed.length)return `**${md(b.title)}**\n\nNo completed, valid result is recorded for ${namedMatch.length?'that match':'this selection'} yet.${b.matches.some(m=>m.status==='live')?' A match is still live.':''}`;
      const latest=completed.slice(-6).reverse();
      return `**${md(b.title)}**\n\n${!namedMatch.length && !selected.teamIds.size?'The tournament champion is not confirmed yet. Latest completed series:\n\n':''}${latest.map(({match,winner,team1,team2})=>{reference(b,match);return `- ${md((winner===team1.id?team1:team2).name)} won against ${md((winner===team1.id?team2:team1).name)} — ${winner===team1.id?score(match):`${match.score.team2Score}–${match.score.team1Score}`} (${md(match.roundName)}).`;}).join('\n')}`;
    });return reply(blocks.join('\n\n'));
  }
  if(/\b(standing|standings|leader|leads|leading|record|records|points|ranking|rankings|puntos|nangunguna|lamang)\b/.test(q))return reply(selected.brackets.map(b=>{reference(b);if(b.placement)return placementBlock(b);const rows=getStandings(b.matches);return `**${md(b.title)}**\n\n${rows.length?rows.map(r=>`- ${md(r.team.name)}: ${r.wins} wins, ${r.losses} losses; games ${r.gameWins}–${r.gameLosses}.`).join('\n'):'No completed, valid series are recorded yet.'}\n\nThese are played-series records, not final placement or Battle Royale placement points.`;}).join('\n\n'));
  if(/\b(roster|players?|lineup|teams?|miyembro|members?|manlalaro)\b/.test(q) && !/bracket|format|schedule|next|score|laban|kelan|kailan/.test(q))return reply(selected.brackets.map(b=>{reference(b);const teams=new Map(b.matches.flatMap(m=>[m.team1,m.team2]).filter((t):t is Team=>!!t&&!t.isBye&&(!selected.teamIds.size||selected.teamIds.has(t.id))).map(t=>[t.id,t]));return `**${md(b.title)}**\n\n${[...teams.values()].map(t=>`- ${md(t.name)}${t.collegeCode?` (${md(t.collegeCode)})`:''}: ${t.players.length?t.players.map(p=>`${md(p.ign)}${p.role?` — ${md(p.role)}`:''}`).join('; '):'Player names are not published yet.'}`).join('\n')}`;}).join('\n\n'));
  if(/\b(live|next|schedule|today|tonight|tomorrow|when|plays|score|scores|winning|laban|kelan|kailan|maglalaro|lalaro|mamaya|ngayon|bukas|sunod|susunod|iskor|lamang)\b/.test(q)){
    const today=manilaToday(new Date(snapshot.checkedAt));
    const tomorrow=manilaToday(new Date(new Date(snapshot.checkedAt).getTime()+86_400_000));
    // "mamaya" (later today) and "ngayon" (now/today) mean today; "bukas" means tomorrow.
    const day=/\b(tomorrow|bukas)\b/.test(q)?tomorrow:/\b(today|tonight|mamaya|ngayon)\b/.test(q)?today:null;
    const entries=selected.brackets.flatMap(b=>b.matches.filter(validMatch).filter(m=>!selected.teamIds.size||selected.teamIds.has(m.team1?.id||'')||selected.teamIds.has(m.team2?.id||'')).map(m=>({b,m})));
    const live=entries.filter(({m})=>m.status==='live'),upcoming=entries.filter(({m})=>['upcoming','pre-match'].includes(m.status) && (!day||scheduleDate(m.scheduledDate,today)===day)).sort((a,b)=>(scheduleDate(a.m.scheduledDate,today)||'9999').localeCompare(scheduleDate(b.m.scheduledDate,today)||'9999')||timeOrder(a.m.scheduledTime)-timeOrder(b.m.scheduledTime));
    const rows=(items:typeof entries)=>items.slice(0,12).map(({b,m})=>{reference(b,m);return `- ${matchup(m)} — ${m.status==='live'?(m.lobby?score(m):`${score(m)} (live, not final)`):scheduleDate(m.scheduledDate,today)?`${scheduleDate(m.scheduledDate,today)} · ${timeOrder(m.scheduledTime)===9999?'time not set':md(m.scheduledTime)} Manila time`:'date/time not set'} · ${md(b.gameName)}.`;}).join('\n');
    return reply(`${live.length?`**Live now**\n\n${rows(live)}\n\n`:''}**Upcoming matches**\n\n${upcoming.length?rows(upcoming):'No upcoming matches are scheduled for this selection.'}`);
  }
  if(/bracket|tournament|format|round|seed|\bmlbb\b|mobile legends|\bdota\b|\bcodm\b|call of duty/.test(q))return reply(selected.brackets.map(b=>{reference(b);const champion=recordedChampion(b);return `**${md(b.title)}**\n\n${md(b.gameName)} · ${md(b.format)} · ${md(b.matchFormat)}\n\n${b.matches.filter(validMatch).slice(0,10).map(m=>{reference(b,m);return `- ${md(m.roundName)}: ${matchup(m)} — ${score(m)} · ${md(m.status)}.`;}).join('\n')}${champion?`\n\nChampion: ${md((champion.winner===champion.team1.id?champion.team1:champion.team2).name)}.`:''}`;}).join('\n\n'),'records',/\b(?:explain|how|why|rules?)\b|\bhelp\b.*(?:format|seed)/.test(q));
  return reply('I can check published brackets, match winners, live scores, schedules, and rosters. Try “Who won MLBB?” or “Who plays next in Dota 2?” For a report or explanation, include the game and match.','help',true);
}
/** Bounded, public context for optional model explanation; facts stay authoritative. */
export function modelReference(snapshot:KnowledgeSnapshot,query:string,history:Array<{role:string;text:string}>=[]) {
  const {brackets}=selectKnowledge(snapshot,query,history);
  const records=brackets.slice(0,8).map(b=>({id:b.id,title:b.title,game:b.gameName,format:b.format,champion:recordedChampion(b)?.winner || null,matches:b.matches.filter(validMatch).filter(m=>m.status==='completed'||m.status==='live').slice(-24).map(m=>({id:m.id,round:m.roundName,teams:[m.team1?.name,m.team2?.name],score:score(m),status:m.status,winnerId:m.winnerId || null}))}));
  return JSON.stringify({checkedAt:snapshot.checkedAt,revision:snapshot.revision,records}).slice(0,40000);
}
