import type { GameTitle } from './types';
/** Player-facing ladders. Values describe a recorded rank, never a live publisher sync. */
export type RankGame = 'mlbb' | 'dota2' | 'codm-mp' | 'codm-br';
export interface RankTier { name: string; divisions: string[]; stars?: number; min?: number; max?: number; color: string; image: string }
const roman = ['I', 'II', 'III', 'IV', 'V'];
const mlbb = (name: string, divisions: number, stars: number, color: string): RankTier => ({ name, divisions: roman.slice(0, divisions).reverse(), stars, color, image: `/ranks/game-mlbb-${name.toLowerCase()}.webp` });
export const MLBB_RANKS: RankTier[] = [
  mlbb('Warrior',3,3,'#ba9870'), mlbb('Elite',3,4,'#b9c7d3'), mlbb('Master',4,4,'#dfbd71'),
  mlbb('Grandmaster',5,5,'#8fc8df'), mlbb('Epic',5,5,'#66ceba'), mlbb('Legend',5,5,'#f3c876'),
  ...['Mythic','Mythical Honor','Mythical Glory','Mythical Immortal'].map((name,i) => ({ name,divisions:[],min:[0,25,50,100][i],max:[24,49,99,undefined][i],color:['#bc9af3','#6ad4e9','#f6c365','#eed79d'][i],image:name==='Mythical Immortal'?'/ranks/mlbb-immortal-reference.png':`/ranks/game-mlbb-${name.toLowerCase().replaceAll(' ','-')}.webp` })),
];
export const DOTA_RANKS: RankTier[] = ['Herald','Guardian','Crusader','Archon','Legend','Ancient','Divine','Immortal'].map((name,i)=>({name,divisions:i===7?[]:roman, color:['#97be66','#c8b294','#77d1d1','#a5dcc4','#e4bc76','#b9abf1','#a6c1f8','#f2b56f'][i],image:`/ranks/dota2-${name.toLowerCase()}.png`}));
/** Approximate reference points from the supplied medal chart; never infer a verified medal from MMR. */
export const DOTA_MMR_REFERENCE = [[0,150,300,450,610],[770,920,1080,1230,1400],[1540,1700,1850,2000,2150],[2310,2450,2610,2770,2930],[3080,3230,3390,3540,3700],[3850,4000,4150,4300,4460],[4620,4820,5020,5220,5420],[5620]];
export const CODM_RANKS: RankTier[] = ['Rookie','Veteran','Elite','Pro','Master','Grandmaster','Legendary'].map((name,i)=>({name,divisions:i===6?[]:roman,min:[1,1001,2001,3001,4501,6001,8001][i],max:[1000,2000,3000,4500,6000,8000,undefined][i],color:['#bb998a','#bdc9d4','#e1ce8f','#85cfc9','#ba9bef','#d0acf0','#efb26b'][i],image:`/ranks/codm-${name.toLowerCase()}.png`}));
export const RANK_GAMES = [
  {id:'mlbb' as const,name:'Mobile Legends',short:'MLBB',gameId:'game-mlbb',image:'/fairplay-mlbb.webp'},
  {id:'dota2' as const,name:'Dota 2',short:'Dota 2',gameId:'game-dota2',image:'/fairplay-dota2.jpg'},
  {id:'codm-mp' as const,name:'CODM Multiplayer',short:'CODM MP',gameId:'game-codm-mp',image:'/fairplay-codm.webp'},
  {id:'codm-br' as const,name:'CODM Battle Royale',short:'CODM BR',gameId:'game-codm-br',image:'/fairplay-codm.webp'},
];
export function rankGame(gameId: string, mode?: string): RankGame | undefined {
  if (['mlbb','game-mlbb'].includes(gameId)) return 'mlbb';
  if (['dota2','game-dota2','game-dota-2','game-dota'].includes(gameId)) return 'dota2';
  if (/codm|call-of-duty-mobile/.test(gameId)) {
    if (gameId.endsWith('-br')) return 'codm-br';
    if (gameId.endsWith('-mp')) return 'codm-mp';
    if (/^(br|battle royale)$/i.test(mode || '')) return 'codm-br';
    if (/^(mp|multiplayer)$/i.test(mode || '')) return 'codm-mp';
  }
}
export function rankTiers(game: RankGame): RankTier[] { return game==='mlbb'?MLBB_RANKS:game==='dota2'?DOTA_RANKS:CODM_RANKS; }
export function rankUnit(game: RankGame) { return game==='mlbb'?'stars':game==='dota2'?'MMR':game==='codm-br'?'RP':'Rank XP'; }
export function mythicTier(stars: number): RankTier | undefined {
  return Number.isInteger(stars) && stars>=0 ? MLBB_RANKS.slice(6).find(t=>stars>=t.min! && (t.max===undefined || stars<=t.max)) : undefined;
}
export function codmRank(points: number) {
  if (!Number.isInteger(points) || points<0) return null;
  const tier=CODM_RANKS.find(t=>points >= (t.min===1?0:t.min!) && (t.max===undefined || points<=t.max))!;
  const division=tier.max===undefined?undefined:roman[Math.min(4, Math.max(0,Math.ceil((points-tier.min!+1)/((tier.max-tier.min!+1)/5))-1))];
  const next=tier.max===undefined?undefined:tier.min!+(roman.indexOf(division!)+1)*((tier.max-tier.min!+1)/5);
  const start=tier.max===undefined?8001:tier.min!+roman.indexOf(division!)*((tier.max-tier.min!+1)/5);
  return {tier,division,next,progress:next===undefined?100:Math.max(0,Math.min(100,((points-start)/(next-start))*100))};
}
/** Hide retired titles without deleting historical tournament records. */
export function isRetiredGame(record: {gameId?:string;id?:string;name?:string;gameName?:string}) {
  return ['game-val','game-valorant','valorant','game-lol','lol','game-league-of-legends'].includes((record.gameId || record.id || '').toLowerCase()) || /^(valorant|league of legends(?:\s*\(lol\))?|lol)$/i.test(record.gameName || record.name || '');
}
/** Upgrade the legacy catalog once; later intentional removals must stay removed. */
export function gameCatalog(games: GameTitle[], defaults: GameTitle[]): GameTitle[] {
  const visible = games.filter(g=>!isRetiredGame(g));
  return games.some(isRetiredGame) ? [...visible,...defaults.filter(g=>!visible.some(v=>v.id===g.id || v.name.toLowerCase()===g.name.toLowerCase()))] : visible;
}
