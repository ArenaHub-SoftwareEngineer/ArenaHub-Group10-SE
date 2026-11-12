import type { Match,Team } from './types';
export const FAIR_PLAY_GAMES = [
 {id:'mlbb',name:'Mobile Legends',mode:'5v5',gameIds:['game-mlbb'],players:5,image:'/fairplay-mlbb.webp',evidence:['Match result and player IGN / server ID','Replay timestamp and the full sequence','Lobby roster and approved substitutes'],tip:'Include the replay perspective and surrounding play. Vision or a strong prediction alone does not establish cheating.'},
 {id:'dota2',name:'Dota 2',mode:'5v5',gameIds:['game-dota2','game-dota-2','game-dota','dota2'],players:5,image:'/fairplay-dota2.jpg',evidence:['Dota match ID and player slot','Replay time, player perspective and camera context','Lobby roster and approved substitutes'],tip:'Preserve the match ID and replay while available. Describe the observed inputs and context; ArenaHub does not analyze replay files or scan devices.'},
 {id:'codm-br',name:'CODM',mode:'Battle Royale',gameIds:['game-codm','game-codm-br','game-call-of-duty-mobile','game-call-of-duty-mobile-br','codm'],players:4,image:'/fairplay-codm.webp',evidence:['Room / match reference and player UID or IGN','Recording timestamp, squad and placement','Final results and lobby roster'],tip:'Capture the full encounter and surrounding audio or visual cues. An unusual shot alone does not establish cheating.'},
 {id:'codm-mp',name:'CODM',mode:'Multiplayer',gameIds:['game-codm','game-codm-mp','game-call-of-duty-mobile','game-call-of-duty-mobile-mp','codm'],players:5,image:'/fairplay-codm.webp',evidence:['Room / match reference, map and mode','Round number, timestamp and player UID or IGN','Scoreboard, lobby roster and relevant recording'],tip:'Include the round and mode, plus the complete encounter. Killcam footage can omit context; organizers should compare available perspectives.'},
] as const;
export type FairPlayGame = typeof FAIR_PLAY_GAMES[number];
export function belongsToFairPlayGame(record: Pick<Match,'gameId'> & {gameMode?:string}, game:FairPlayGame) {
 if (!(game.gameIds as readonly string[]).includes(record.gameId)) return false;
 if(!game.id.startsWith('codm'))return true;
 const mode=record.gameMode?.toLowerCase() || (record.gameId.endsWith('-br')?'br':record.gameId.endsWith('-mp')?'mp':'');
 return !mode || mode===game.id.slice(5);
}
export function evidenceContext(game:FairPlayGame,details:string) {
 const clean=details.trim();if(clean.length<30)throw new Error('Add at least 30 characters.');
 const result=`[ArenaHub:${game.id}]\nGame: ${game.name} · ${game.mode} (reporter-selected context)\n${clean}`;
 if(result.length>3000)throw new Error('Shorten the report.');return result;
}
