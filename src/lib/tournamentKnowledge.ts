import type { BracketDraft, Match, Team } from './types';
import { completedSeries, getTournamentStandings as getStandings } from './standings';
import { isRetiredGame } from './gameRanks';
import { scheduleDate, timeOrder, manilaToday } from './calendar';
import { computeStandings, lobbyMatches, type PlacementEvent } from './formats/placement';

export interface KnowledgeReference {label:string;bracketId:string;matchId?:string}
export interface KnowledgeSnapshot {revision:number;checkedAt:string;origin:'server'|'loaded';brackets:BracketDraft[]}
export interface KnowledgeAnswer {text:string;references:KnowledgeReference[];kind:'records'|'help';needsModel?:boolean;
  /** What the engine understood the question to be and what it read, in plain words. Shown as its reasoning. */
  steps?:string[]}
const str=(value:unknown,max=180)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').slice(0,max):'';
const number=(value:unknown)=>typeof value==='number' && Number.isFinite(value)?value:NaN;
function placementOf(value:any):PlacementEvent|undefined {
  if(!value || typeof value!=='object' || !Array.isArray(value.teams) || !Array.isArray(value.games))return undefined;
  const int=(v:unknown)=>Number.isInteger(v)?v as number:0;
  return {config:{pointsTable:Array.isArray(value.config?.pointsTable)?value.config.pointsTable.slice(0,25).map(int):[],killPoints:int(value.config?.killPoints)},
    teams:value.teams.slice(0,25).map((t:any)=>({id:str(t?.id),name:str(t?.name),collegeCode:str(t?.collegeCode,30)})),
    games:value.games.slice(0,24).map((g:any)=>({id:str(g?.id),label:str(g?.label,40),status:['live','completed'].includes(g?.status)?g.status:'upcoming',scheduledDate:str(g?.scheduledDate,40),scheduledTime:str(g?.scheduledTime,40),results:Array.isArray(g?.results)?g.results.slice(0,25).map((r:any)=>({teamId:str(r?.teamId),placement:int(r?.placement),kills:int(r?.kills)})):[]}))};
}
/** Only fields needed for public tournament questions enter the assistant context. */
export function knowledgeSnapshot(raw:unknown,revision=0,checkedAt=new Date().toISOString(),origin:KnowledgeSnapshot['origin']='server'):KnowledgeSnapshot {
  const raw0=raw;
  const team=(value:any):Team|undefined=>value && typeof value==='object'?{id:str(value.id),name:str(value.name),collegeCode:str(value.collegeCode,30),collegeId:'',gameId:str(value.gameId),seed:number(value.seed),winRate:0,record:'',isBye:value.isBye===true,players:Array.isArray(value.players)?value.players.slice(0,12).map((p:any)=>({id:'',name:'',collegeId:'',isVerified:false,ign:str(p?.ign,80),role:str(p?.role,80)})):[]}:undefined;
  const brackets:BracketDraft[]=Array.isArray(raw)?raw.filter(b=>b?.status==='published' && !isRetiredGame(b)).slice(0,100).map(b=>({
    id:str(b.id),title:str(b.title),gameId:str(b.gameId),gameName:str(b.gameName),format:str(b.format),matchFormat:str(b.matchFormat),teamsCount:number(b.teamsCount),status:'published',createdAt:str(b.createdAt),teams:[],parsedParams:{},rawPrompt:'',seedingRule:'',
    matches:Array.isArray(b.matches)?b.matches.slice(0,2048).map((m:any)=>({id:str(m?.id),matchNumber:str(m?.matchNumber),tournamentId:str(b.id),gameId:str(m?.gameId),gameMode:m?.gameMode==='br'?'br':m?.gameMode==='mp'?'mp':undefined,round:number(m?.round),roundName:str(m?.roundName),bracketType:str(m?.bracketType),status:str(m?.status),matchFormat:str(m?.matchFormat),tournamentFormat:str(m?.tournamentFormat),swissRounds:number(m?.swissRounds),team1:team(m?.team1),team2:team(m?.team2),score:{team1Score:number(m?.score?.team1Score),team2Score:number(m?.score?.team2Score)},winnerId:str(m?.winnerId),nextMatchId:str(m?.nextMatchId),inactive:m?.inactive===true,conditionalReset:m?.conditionalReset===true,scheduledDate:str(m?.scheduledDate),scheduledTime:str(m?.scheduledTime),organizerName:'',...(m?.mvp && typeof m.mvp==='object' && str(m.mvp.ign,80)?{mvp:{playerName:'',ign:str(m.mvp.ign,80),role:str(m.mvp.role,80),teamCode:str(m.mvp.teamCode,30)}}:{})})):[],
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
// ---- How a records answer reads: it works out what was asked, answers that in the first sentence,
// then gives a short list only when one helps. Plain words: no markdown symbols, no "#1", no escapes. ----
/** Organizer-entered text as plain words: characters the chat would read as formatting are dropped. */
const plain=(value:string)=>value.replace(/[\\`*#]/g,'').replace(/\|/g,'/').replace(/\s+/g,' ').trim();
const plural=(n:number,word:string,many=`${word}s`)=>`${n} ${n===1?word:many}`;
export const ordinal=(n:number)=>{const t=n%100;return `${n}${t>=11&&t<=13?'th':(['th','st','nd','rd'][n%10]||'th')}`;};
const PLACEHOLDER=/^(?:awaiting team|to be decided|tbd|bye)$/i;
const teamName=(t:Team|undefined)=>t?.name && !PLACEHOLDER.test(t.name.trim())?plain(t.name):'';
/** "M4" for "#M4"; the round name when the match has no number. */
const matchLabel=(m:Match)=>plain((m.matchNumber||'').replace(/^#+/,''))||plain(m.roundName)||'this match';
/** "the Semifinal", but "Round 2" without an article. */
const roundPhrase=(m:Match)=>{const r=plain(m.roundName)||'match';return /^(?:round|game|week|day)\s*\d/i.test(r)?r:`the ${r}`;};
const GAME_LABEL:Record<string,string>={mlbb:'MLBB',dota2:'Dota 2','codm-br':'CODM Battle Royale','codm-mp':'CODM Multiplayer',codm:'CODM'};
const gameLabel=(game:string)=>GAME_LABEL[game]||game.replace(/\b\w/g,c=>c.toUpperCase());
/** "Bo3 (best of 3: the first team to win 2 games takes the match)". */
function bestOf(format:string) {
  const n=Number(format.match(/^bo(\d+)$/i)?.[1]);
  if(!n)return plain(format);
  return n===1?`${format} (a single game decides the match)`:`${format} (best of ${n}: the first team to win ${Math.ceil(n/2)} games takes the match)`;
}
/** Both sides of a match in words, without inventing a name for an empty slot. */
function pairing(m:Match) {
  if(m.lobby)return `${plain(m.roundName)} (${plural(m.lobby.squads,'squad')})`;
  const a=teamName(m.team1),b=teamName(m.team2);
  return a&&b?`${a} vs ${b}`:a||b?`${a||b} against an opponent still to be decided`:'two teams still to be decided';
}
/** "today at 3:00 PM", "tomorrow at 1:00 PM", "Sat, Nov 21 at 9:00 AM". */
function whenText(m:Match,today:string,tomorrow:string) {
  const date=scheduleDate(m.scheduledDate,today),time=timeOrder(m.scheduledTime)===9999?'':plain(m.scheduledTime);
  if(!date)return time?`at ${time} (date not set yet)`:'date and time not set yet';
  const day=date===today?'today':date===tomorrow?'tomorrow':new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});
  return time?`${day} at ${time}`:`${day}, time not set yet`;
}
type Series=ReturnType<typeof completedSeries>[number];
/** Winner first: "Crimson Wolves beat Azure Hawks 2-1". */
function beat({match,winner,team1,team2}:Series) {
  const first=winner===team1.id,w=first?team1:team2,l=first?team2:team1;
  const a=first?match.score.team1Score:match.score.team2Score,b=first?match.score.team2Score:match.score.team1Score;
  return `${plain(w.name)} beat ${plain(l.name)} ${a}-${b}`;
}
function liveText(m:Match,withRound=true) {
  if(m.lobby)return `${plain(m.roundName)} (${plural(m.lobby.squads,'squad')}) is being played`;
  const a=teamName(m.team1)||'one team',b=teamName(m.team2)||'the other team';
  return [m.score.team1Score,m.score.team2Score].every(Number.isFinite)?`${a} ${m.score.team1Score}-${m.score.team2Score} ${b}${withRound?` in ${roundPhrase(m)}`:''}`:`${a} vs ${b} has started, but no score is recorded yet`;
}
/** Legacy short score, used only by modelReference. */
function score(match:Match) {if(match.lobby)return match.status==='completed'?`won by ${plain(match.lobby.winner || 'a recorded squad')}`:match.status==='live'?'lobby in progress':'lobby game';
  if(match.status==='upcoming'||match.status==='pre-match')return 'not played yet';
  return [match.score.team1Score,match.score.team2Score].every(Number.isFinite)?`${match.score.team1Score}-${match.score.team2Score}`:'score not recorded';}
const validMatch=(m:Match)=>!m.inactive && !m.team1?.isBye && !m.team2?.isBye;
const list=(lines:string[])=>lines.map(line=>`- ${line}`).join('\n');
/** "A, B and C" */
const joinNames=(names:string[])=>names.length<=1?names[0]||'':`${names.slice(0,-1).join(', ')} and ${names.at(-1)}`;

/** Battle Royale results: placement points, never head-to-head records. */
function placementText(b:BracketDraft,short:boolean) {
  const event=b.placement!,rows=computeStandings(event),done=event.games.filter(g=>g.status==='completed').length,title=plain(b.title);
  if(!done)return `No game of ${title} has finished yet. ${plural(event.games.length,'game')} ${event.games.length===1?'is':'are'} planned for ${plural(event.teams.length,'squad')}.`;
  const top=rows[0],finished=done===event.games.length;
  const lead=finished?`${plain(top.name)} won ${title} with ${plural(top.total,'point')}.`
    :`After ${done} of ${event.games.length} games, ${plain(top.name)} ${top.total===rows[1]?.total?'share the lead':'lead'} ${title} with ${plural(top.total,'point')}. This is not final until every game is played.`;
  return `${lead}\n\n${list(rows.slice(0,short?3:8).map(r=>`${ordinal(r.rank)} ${plain(r.name)}${r.collegeCode?` (${plain(r.collegeCode)})`:''}: ${plural(r.total,'point')}, ${plural(r.kills,'elimination')}`))}\n\nPoints come from finishing position plus eliminations.`;
}

/** Questions about individual player rankings ("most kills", "top players by KDA", "most MVPs"). */
export const LEADERBOARD_QUESTION=/\b(leaderboard|top\s+(?:\d+\s+)?players?|most\s+(?:kills|assists|mvps?|eliminations|elims|frags)|kill\s*leaders?|(?:highest|best|top)\s+kda|kda\s+(?:leaders?|rankings?)|player\s+(?:rankings?|stats|statistics|standings)|mvp\s+(?:count|awards?|leaders?)|pinakamaraming\s+(?:kills?|mvps?|assists?))\b/i;

/** What a question is asking for. Checked in this order, so "who won the standings" is a result question. */
export type QuestionIntent='fair-play'|'leaderboard'|'mvp'|'winner'|'standings'|'roster'|'live'|'schedule'|'bracket'|'help';
export function questionIntent(query:string):QuestionIntent {
  const q=query.trim().toLowerCase();
  if(/cheat|fair.?play|evidence|report/.test(q))return 'fair-play';
  if(LEADERBOARD_QUESTION.test(q))return 'leaderboard';
  if(/\bmvp\b/.test(q))return 'mvp';
  // English and Taglish ("sino nanalo", "kelan laban", "sino maglalaro mamaya").
  if(/\b(winner|won|win|champion|champs?|nanalo|panalo|nagwagi|nagchampion|result|results|resulta)\b/.test(q) && !/\bwill\b|\bwinning\b/.test(q))return 'winner';
  if(/\b(standing|standings|leader|leads|leading|record|records|points|ranking|rankings|rank|ranked|puntos|nangunguna|lamang|on top|first place|top team)\b/.test(q))return 'standings';
  if(/\b(roster|players?|lineup|teams?|miyembro|members?|manlalaro)\b/.test(q) && !/bracket|format|schedule|next|score|laban|kelan|kailan/.test(q))return 'roster';
  if(/\b(live|score|scores|iskor|winning|happening now)\b/.test(q))return 'live';
  if(/\b(next|schedule|today|tonight|tomorrow|when|plays|playing|laban|kelan|kailan|maglalaro|lalaro|mamaya|ngayon|bukas|sunod|susunod)\b/.test(q))return 'schedule';
  if(/bracket|tournament|format|round|seed|\bmlbb\b|mobile legends|\bdota\b|\bcodm\b|call of duty/.test(q))return 'bracket';
  return 'help';
}
const ASKED:Record<QuestionIntent,string>={'fair-play':'how fair-play reports work',leaderboard:'the player leaderboard',mvp:'who was MVP',winner:'who won',standings:'the standings',roster:'the team rosters',live:'the live score',schedule:'who plays next',bracket:'how the bracket stands',help:'what you want to know'};
const CHECKED:Partial<Record<QuestionIntent,string>>={mvp:'MVP records',winner:'results',standings:'standings',roster:'rosters',live:'live matches',schedule:'schedule',bracket:'bracket'};

export function answerTournamentQuestion(snapshot:KnowledgeSnapshot,query:string,history:Array<{role:string;text:string}>=[],focus?:KnowledgeFocus|null):KnowledgeAnswer {
  const q=query.trim().toLowerCase(),selected=selectKnowledge(snapshot,query,history,focus),refs:KnowledgeReference[]=[];
  const intent=questionIntent(query);
  const reference=(b:BracketDraft,m?:Match)=>{if(refs.length<12 && !refs.some(r=>r.bracketId===b.id && r.matchId===m?.id))refs.push({label:m?`${b.title} · ${matchLabel(m)}`:b.title,bracketId:b.id,...(m?{matchId:m.id}:{})});};
  const teamIds=selected.teamIds;
  const named=[...new Set(selected.brackets.flatMap(b=>b.matches).flatMap(m=>[m.team1,m.team2]).filter((t):t is Team=>!!t && teamIds.has(t.id)).map(t=>plain(t.name)))];
  const involves=(m:Match)=>!teamIds.size||teamIds.has(m.team1?.id||'')||teamIds.has(m.team2?.id||'');
  const wantsLeader=/\b(who(?:'s| is)? (?:leading|on top|first|number one|top)|leads|leading|nangunguna|lamang|on top|first place|top team)\b/.test(q);
  const day=/\b(tomorrow|bukas)\b/.test(q)?'tomorrow':/\b(today|tonight|mamaya|ngayon)\b/.test(q)?'today':null;
  // What the engine understood and what it read, shown as its reasoning.
  const scope=named.length?` for ${joinNames(named)}`:selected.brackets.length===1?` in ${plain(selected.brackets[0].title)}`:selected.game?` in ${gameLabel(selected.game)}`:' across all published tournaments';
  const titles=selected.brackets.map(b=>plain(b.title));
  const steps=[`Understood the question as: ${intent==='standings'&&wantsLeader?'who is on top of the standings':intent==='schedule'&&day?`the matches ${day}`:ASKED[intent]}${intent==='help'||intent==='fair-play'||intent==='leaderboard'?'':scope}`,
    ...(CHECKED[intent]&&titles.length?[`Checked the ${CHECKED[intent]} of ${titles.length>2?`${titles.slice(0,2).join(', ')} and ${titles.length-2} more`:joinNames(titles)}`]:[])];
  // Questions a model answers better (judgement, stories, predictions); the records reply is the fallback without one.
  const askModel=/\b(best player|best team|pinakamagaling|magaling|highlights?|what happened|nangyari|timeline|key moments|predict|prediction|chances?|mananalo|favou?rites?|will [\w ]{2,30} win|who should)\b/.test(q);
  const reply=(text:string,kind:KnowledgeAnswer['kind']='records',needsModel=false):KnowledgeAnswer=>({text,references:refs,kind,needsModel:needsModel||askModel,steps});
  if(intent==='fair-play')return reply('Open Fair play to submit a recording or review match evidence. Organizers can inspect sampled frames and returned observations. A referee must confirm the finding; a replay alone cannot prove hidden software or input automation.','help',!/\bwhere\b|\bhow\b.*(?:upload|submit|report)|\bcan\b.*detect/.test(q));
  if(intent==='leaderboard')return reply('ArenaHub shows tournament standings and team results.','help',false);
  // "Explain seeding" needs no bracket; only record questions stop at "nothing is published".
  const explanatory=/\b(explain|how|why|what (?:is|are|does)|meaning|rules?|help)\b/.test(q);
  if(!selected.brackets.length){
    if(!snapshot.brackets.length)return reply('No tournaments are published yet. Once an organizer publishes one, I can tell you its results, schedule, standings and rosters.','records',explanatory);
    return reply(`There is no published ${selected.game?`${gameLabel(selected.game)} `:''}tournament that matches your question. These are the published tournaments:\n\n${list(snapshot.brackets.slice(0,8).map(b=>`${plain(b.title)} (${plain(b.gameName)})`))}`,'records',explanatory);
  }
  const today=manilaToday(new Date(snapshot.checkedAt)),tomorrow=manilaToday(new Date(new Date(snapshot.checkedAt).getTime()+86_400_000));

  // MVPs are recorded by organizers per match and credited by in-game name.
  if(intent==='mvp'){
    const rows=selected.brackets.flatMap(b=>b.matches.filter(m=>m.mvp && typeof m.mvp==='object' && involves(m)).filter(m=>!/\bm\d+\b/.test(q)||q.includes(matchLabel(m).toLowerCase())).map(m=>({b,m,mvp:m.mvp as Exclude<Match['mvp'],string|undefined>})));
    const who=(mvp:typeof rows[number]['mvp'])=>`${plain(mvp.ign)}${mvp.role||mvp.teamCode?` (${[mvp.role,mvp.teamCode].filter(Boolean).map(v=>plain(v!)).join(', ')})`:''}`;
    if(!rows.length)return reply(`No MVP is recorded yet${scope}. Organizers add one after a match ends.`);
    rows.slice(0,8).forEach(({b,m})=>reference(b,m));
    if(rows.length===1){const {m,mvp}=rows[0];return reply(`${who(mvp)} was the MVP of match ${matchLabel(m)} (${plain(m.roundName)}, ${pairing(m)}).`);}
    return reply(`MVPs recorded${scope}:\n\n${list(rows.slice(0,8).map(({m,mvp})=>`${matchLabel(m)}, ${plain(m.roundName)} (${pairing(m)}): ${who(mvp)}`))}`);
  }

  if(intent==='winner'){
    const parts=selected.brackets.map(b=>{
      reference(b);const title=plain(b.title);
      if(b.placement)return placementText(b,true);
      const champion=recordedChampion(b);
      const namedMatch=b.matches.filter(m=>{const label=matchLabel(m).toLowerCase();return label.length>=2 && !!m.matchNumber && new RegExp(`(?:^|[^a-z0-9])#?${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![a-z0-9])`).test(q);});
      if(champion && !namedMatch.length && !teamIds.size){reference(b,champion.match);const [w,l]=beat(champion).split(' beat ');return `${w} won ${title}, beating ${l} in ${roundPhrase(champion.match)}.`;}
      const candidates=namedMatch.length?namedMatch:b.matches.filter(involves);
      const done=completedSeries(candidates).filter(entry=>validMatch(entry.match));
      // Two teams named: their meeting comes first.
      const both=teamIds.size>=2?done.filter(e=>teamIds.has(e.team1.id)&&teamIds.has(e.team2.id)):[];
      const latest=(both.length?both:done).slice(-6).reverse();
      const liveNow=candidates.some(m=>m.status==='live');
      if(!latest.length){
        if(namedMatch.length)return `${matchLabel(namedMatch[0])} in ${title} has no final result yet.${liveNow?' It is being played right now.':''}`;
        return `${named.length?`${joinNames(named)}: no finished match in ${title} yet.`:`${title} has no finished match yet.`}${liveNow?' A match is being played right now.':''}`;
      }
      latest.forEach(e=>reference(b,e.match));
      if(latest.length===1)return `${!namedMatch.length&&!teamIds.size?`${title} has no champion yet. The latest result: `:''}In ${roundPhrase(latest[0].match)} of ${title}, ${beat(latest[0])}.`.replace('result: In','result: in');
      const heading=!namedMatch.length&&!teamIds.size?`${title} has no champion yet. Latest results:`:`Results${named.length?` for ${joinNames(named)}`:''} in ${title}, newest first:`;
      return `${heading}\n\n${list(latest.map(e=>`${plain(e.match.roundName)}: ${beat(e)}`))}`;
    });
    return reply(parts.join('\n\n'));
  }

  if(intent==='standings')return reply(selected.brackets.map(b=>{
    reference(b);const title=plain(b.title);
    if(b.placement)return placementText(b,wantsLeader);
    const rows=getStandings(b.matches);
    if(!rows.length)return `${title} has no finished series yet, so there are no standings.`;
    const record=(r:typeof rows[number])=>`${plural(r.wins,'win')} and ${plural(r.losses,'loss','losses')}`;
    const mine=rows.map((r,i)=>({r,i})).filter(({r})=>teamIds.has(r.team.id));
    const note=b.format.toLowerCase()==='swiss'?'Swiss ranks teams by series wins, then by how strong their opponents were (Buchholz), then by game difference.':'Only finished series count.';
    if(mine.length)return `${mine.map(({r,i})=>`${plain(r.team.name)}: ${ordinal(i+1)} of ${rows.length} in ${title}, with ${record(r)}.`).join(' ')}${mine.some(({i})=>i===0)?'':` On top: ${plain(rows[0].team.name)}, with ${record(rows[0])}.`} ${note}`;
    const lead=`On top of ${title}: ${plain(rows[0].team.name)}, with ${record(rows[0])}.`;
    if(wantsLeader)return `${lead}${rows[1]?` Next is ${plain(rows[1].team.name)}, with ${record(rows[1])}.`:''} ${note}`;
    return `${lead}\n\n${list(rows.slice(0,8).map((r,i)=>`${ordinal(i+1)} ${plain(r.team.name)}: ${record(r)} (games ${r.gameWins}-${r.gameLosses})`))}${rows.length>8?`\n\n${plural(rows.length-8,'more team')} below.`:''}\n\n${note}`;
  }).join('\n\n'));

  if(intent==='roster')return reply(selected.brackets.map(b=>{
    reference(b);
    const teams=[...new Map(b.matches.flatMap(m=>[m.team1,m.team2]).filter((t):t is Team=>!!t&&!t.isBye&&!!teamName(t)&&(!teamIds.size||teamIds.has(t.id))).map(t=>[t.id,t])).values()];
    const line=(t:Team)=>`${plain(t.name)}${t.collegeCode?` (${plain(t.collegeCode)})`:''}: ${t.players.length?t.players.map(p=>`${plain(p.ign)}${p.role?` (${plain(p.role)})`:''}`).join(', '):'players not published yet'}`;
    if(!teams.length)return `No team in ${plain(b.title)} has a published roster yet.`;
    return teams.length===1?`${line(teams[0])}. That is the published roster in ${plain(b.title)}.`:`Published rosters in ${plain(b.title)}:\n\n${list(teams.map(line))}`;
  }).join('\n\n'));

  if(intent==='live'||intent==='schedule'){
    const entries=selected.brackets.flatMap(b=>b.matches.filter(validMatch).filter(involves).map(m=>({b,m})));
    const byTime=(a:{m:Match},c:{m:Match})=>(scheduleDate(a.m.scheduledDate,today)||'9999').localeCompare(scheduleDate(c.m.scheduledDate,today)||'9999')||timeOrder(a.m.scheduledTime)-timeOrder(c.m.scheduledTime);
    const live=entries.filter(({m})=>m.status==='live');
    const upcomingAll=entries.filter(({m})=>['upcoming','pre-match'].includes(m.status)).sort(byTime);
    const dayDate=day==='tomorrow'?tomorrow:day==='today'?today:null;
    const upcoming=dayDate?upcomingAll.filter(({m})=>scheduleDate(m.scheduledDate,today)===dayDate):upcomingAll;
    const many=selected.brackets.length>1;
    const side=(m:Match)=>{
      // "against Azure Hawks" when the question named one of the two teams.
      if(m.lobby||teamIds.size!==1)return pairing(m);
      const other=teamIds.has(m.team1?.id||'')?m.team2:m.team1;
      return `against ${teamName(other)||'an opponent still to be decided'}`;
    };
    const next=({b,m}:typeof entries[number])=>{reference(b,m);return `${side(m)}${m.lobby?'':` in ${roundPhrase(m)}`}${many?` of ${plain(b.title)}`:''}, ${whenText(m,today,tomorrow)}`;};
    const liveLine=({b,m}:typeof entries[number])=>{reference(b,m);return `${liveText(m)}${many?` (${plain(b.title)})`:''}`;};
    const out:string[]=[];
    if(intent==='live'){
      if(live.length===1)out.push(`Live right now: ${liveLine(live[0])}. This score can still change, so it is not final.`);
      else if(live.length)out.push(`${plural(live.length,'match','matches')} are live right now. These scores are not final:\n\n${list(live.slice(0,8).map(liveLine))}`);
      else out.push(`No match is live right now${scope}.${upcomingAll[0]?` The next one is ${next(upcomingAll[0])}.`:''}`);
    } else {
      if(upcoming.length){
        const first=upcoming[0];
        out.push(named.length?`Next for ${joinNames(named)}: ${next(first).replace(/^against/,'a match against')}.`:dayDate?`${plural(upcoming.length,'match','matches')} ${day}${scope}. First up: ${next(first)}.`:`Next up${scope}: ${next(first)}.`);
        if(upcoming.length>1)out.push(`After that:\n\n${list(upcoming.slice(1,5).map(next))}${upcoming.length>5?`\n- and ${plural(upcoming.length-5,'more match','more matches')}`:''}`);
      } else {
        out.push(`No upcoming matches are scheduled${day?` for ${day}`:''}${scope}.${day&&upcomingAll[0]?` The next scheduled one is ${next(upcomingAll[0])}.`:''}`);
      }
      if(live.length)out.push(`Live right now: ${live.slice(0,3).map(liveLine).join('; ')} (not final).`);
    }
    if(/\d:\d{2}/.test(out.join(' ')))out.push('All times are Manila time.');
    return reply(out.join('\n\n'));
  }

  if(intent==='bracket')return reply(selected.brackets.map(b=>{
    reference(b);const champion=b.placement?null:recordedChampion(b),valid=b.matches.filter(validMatch),title=plain(b.title);
    if(b.placement)return placementText(b,false);
    const finished=valid.filter(m=>m.status==='completed').length;
    const results=new Map(completedSeries(valid).map(e=>[e.match.id,e]));
    const status=(m:Match)=>{const r=results.get(m.id);return r?beat(r):m.status==='live'?`${liveText(m,false)} (live, not final)`:`${pairing(m)}, not played yet`;};
    return `${title} is a ${plain(b.format).toLowerCase()} ${plain(b.gameName)} tournament. Matches are ${bestOf(b.matchFormat)}. ${finished} of ${plural(valid.length,'match','matches')} ${finished===1?'is':'are'} finished.${champion?` ${beat(champion).split(' beat ')[0]} won it.`:''}\n\n${list(valid.slice(0,10).map(m=>{reference(b,m);return `${plain(m.roundName)}: ${status(m)}`;}))}${valid.length>10?`\n\n${plural(valid.length-10,'more match','more matches')} on the Brackets page.`:''}`;
  }).join('\n\n'),'records',/\b(?:explain|how|why|rules?)\b|\bhelp\b.*(?:format|seed)/.test(q));

  return reply('I could not tell what you want to know from that. I can tell you who won, who plays next, live scores, standings, rosters and MVPs for published tournaments. Try "Who won MLBB?", "Who plays next in Dota 2?" or "When is our next match?"','help',true);
}
/** Bounded, public context for optional model explanation; facts stay authoritative. */
export function modelReference(snapshot:KnowledgeSnapshot,query:string,history:Array<{role:string;text:string}>=[]) {
  const {brackets}=selectKnowledge(snapshot,query,history);
  const records=brackets.slice(0,8).map(b=>({id:b.id,title:b.title,game:b.gameName,format:b.format,champion:recordedChampion(b)?.winner || null,matches:b.matches.filter(validMatch).filter(m=>m.status==='completed'||m.status==='live').slice(-24).map(m=>({id:m.id,round:m.roundName,teams:[m.team1?.name,m.team2?.name],score:score(m),status:m.status,winnerId:m.winnerId || null}))}));
  return JSON.stringify({checkedAt:snapshot.checkedAt,revision:snapshot.revision,records}).slice(0,40000);
}
