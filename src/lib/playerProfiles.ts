import type { BracketDraft, Player, Team } from './types';
import rankAssets from './rankAssets.json';
import { rankGame, rankTiers, rankUnit, isRetiredGame } from './gameRanks';
const assets: Record<string, string> = rankAssets;
const tiers: Record<string, string[]> = {
  'game-mlbb': ['Mythical Immortal','Mythical Glory','Mythical Honor','Mythic','Legend','Epic','Grandmaster','Master','Elite','Warrior'],
  'game-val': ['Radiant','Immortal','Ascendant','Diamond','Platinum','Gold','Silver','Bronze','Iron'],
  'game-lol': ['Challenger','Grandmaster','Master','Diamond','Emerald','Platinum','Gold','Silver','Bronze','Iron'],
};
export interface DisplayRank { tier: string; division?: string; value?: number; unit: 'stars' | 'RR' | 'LP' | 'MMR' | 'RP' | 'Rank XP' | 'points'; image?: string; isPeak: boolean; accessibleLabel: string }
export function playerRank(player: Pick<Player,'rank'|'peakRank'>, gameId: string, mode?: string): DisplayRank | null {
  const peak = player.peakRank;
  const raw = peak?.tier || player.rank;
  if (!raw?.trim()) return null;
  const normalized = raw.trim().replace(/mythic(?:al)?\s+(honou?r|glory|immortal)/i, (_, tier: string) => `Mythical ${tier.toLowerCase().startsWith('hon') ? 'Honor' : tier}`).replace(/grand\s+master/i,'Grandmaster');
  const game = rankGame(gameId, mode);
  const tier = (game ? rankTiers(game).map(t=>t.name).reverse() : tiers[gameId])?.find(name => new RegExp(`^${name}(?:\\s|$)`, 'i').test(normalized));
  const rawDivision = peak?.division || (tier ? normalized.slice(tier.length).match(/^\s+([IVX]+|[1-5])\b/i)?.[1] : undefined);
  const division = game && rawDivision && /^[1-5]$/.test(rawDivision) ? ['I','II','III','IV','V'][Number(rawDivision)-1] : rawDivision?.toUpperCase();
  const matched = player.rank?.match(/(\d[\d,]*)\s*(?:★|stars?\b|RR\b|LP\b|MMR\b|RP\b|Rank\s+XP\b|XP\b|points?\b)/i);
  const value = peak ? peak.value : matched ? Number(matched[1].replace(/,/g,'')) : undefined;
  const validValue = value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
  const unit = game ? rankUnit(game) : gameId === 'game-val' ? 'RR' : gameId === 'game-lol' ? 'LP' : /codm|call-of-duty/.test(gameId) ? 'points' : 'stars';
  const key = tier ? `${gameId}|${tier.toLowerCase().replaceAll(' ','-')}${gameId === 'game-val' && tier !== 'Radiant' && division ? `-${division}` : ''}` : '';
  const label = `${tier || raw}${division ? ` ${division}` : ''}`;
  return { tier: tier || raw, division, value: validValue, unit, image: game ? rankTiers(game).find(t=>t.name===tier)?.image : assets[key], isPeak: !!peak,
    accessibleLabel: `${peak ? 'Peak rank' : 'Recorded rank'}: ${label}${validValue !== undefined ? `, ${validValue.toLocaleString('en-US')} ${unit}` : ''}` };
}
export function safePlayerImage(value?: string): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value,'https://arena.invalid'); return url.protocol === 'https:' && !url.username && !url.password ? value : undefined; } catch { return undefined; }
}
/** Never spread account/registration data into a public profile. */
export function publicPlayerProfile(player: Player, team: Team) {
  return { id: player.id, ign: player.ign, fullName: player.name, role: player.role, verified: player.isVerified,
    avatarUrl: safePlayerImage(player.avatarUrl), samplePortrait: player.isSampleProfile ? player.samplePortrait : undefined,
    yearLevel: player.yearLevel, department: player.department, program: player.program, bio: player.bio,
    isSample: !!player.isSampleProfile, rank: playerRank(player,team.gameId,team.gameMode), recordedRank: playerRank({rank:player.rank},team.gameId,team.gameMode), teamName: team.name, teamCode: team.collegeCode };
}
export type PublicPlayerProfile = ReturnType<typeof publicPlayerProfile>;
/** Published rosters replace fictional fixtures for that game's player directory. */
export function directoryTeams(samples:Team[],brackets:BracketDraft[]):Team[] {
  const published=new Map<string,Team>(),activeGames=new Set<string>();
  for(const bracket of brackets.filter(b=>b.status==='published'))for(const match of bracket.matches)for(const team of [match.team1,match.team2]){
    if(!team || team.isBye || isRetiredGame(team))continue;
    const game=rankGame(team.gameId,team.gameMode)||team.gameId;activeGames.add(game);
    const key=`${game}:${team.id}`,prior=published.get(key);
    if(!prior || (!prior.players.length && team.players.length))published.set(key,team);
  }
  return [...samples.filter(team=>!isRetiredGame(team) && !activeGames.has(rankGame(team.gameId,team.gameMode)||team.gameId)),...published.values()];
}
/** Refresh only identifiable, unchanged fictional fixtures from older browser snapshots. */
export function hydrateSampleRoster(team: Team | undefined, fixtures: Team[]): Team | undefined {
  const fixture = fixtures.find(t=>t.id===team?.id && t.gameId===team.gameId);
  if (!team || !fixture) return team;
  return { ...team,players:team.players.map(player=>{
    const sample=fixture.players.find(p=>p.id===player.id && p.name===player.name && p.ign===player.ign && p.isSampleProfile);
    if (!sample || player.isSampleProfile===false) return player;
    return { ...player,peakRank:player.peakRank ?? sample.peakRank,yearLevel:player.yearLevel ?? sample.yearLevel,
      department:player.department ?? sample.department,program:player.program ?? sample.program,bio:player.bio ?? sample.bio,
      isSampleProfile:true,samplePortrait:player.samplePortrait ?? sample.samplePortrait };
  }) };
}
/** The entire bracket document, including its draft field, is publicly readable. */
export function publicBracket(draft: BracketDraft): BracketDraft {
  const publicTeam = (team?: Team): Team | undefined => team ? { id:team.id,name:team.name,collegeId:team.collegeId,collegeCode:team.collegeCode,
    gameId:team.gameId,gameMode:team.gameMode,seed:team.seed,winRate:team.winRate,record:team.record,isBye:team.isBye,
    players:team.players.map(player => ({ id:player.id,name:player.name,ign:player.ign,role:player.role,collegeId:player.collegeId,
      isVerified:player.isVerified,avatarUrl:safePlayerImage(player.avatarUrl),rank:player.rank,
      peakRank:player.peakRank ? {tier:player.peakRank.tier,division:player.peakRank.division,value:player.peakRank.value,unit:player.peakRank.unit} : undefined,
      yearLevel:player.yearLevel,department:player.department,program:player.program,bio:player.bio,
      samplePortrait:player.isSampleProfile ? player.samplePortrait : undefined,isSampleProfile:player.isSampleProfile,
      signatureHero:player.signatureHero,stats:player.stats ? {kda:player.stats.kda,winRate:player.stats.winRate,matchesPlayed:player.stats.matchesPlayed,
        record:player.stats.record,totalKills:player.stats.totalKills,totalDeaths:player.stats.totalDeaths,totalAssists:player.stats.totalAssists,palaroAppearances:player.stats.palaroAppearances} : undefined })) } : undefined;
  return { ...draft, matches:draft.matches.map(match => ({ ...match,team1:publicTeam(match.team1),team2:publicTeam(match.team2) })) };
}
