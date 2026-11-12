import test from 'node:test';
import assert from 'node:assert/strict';
import { codmRank, mythicTier, rankGame, rankTiers, rankUnit, isRetiredGame, gameCatalog, MLBB_RANKS } from '../src/lib/gameRanks';
import type { GameTitle } from '../src/lib/types';
import { playerRank } from '../src/lib/playerProfiles';

test('MLBB continuous stars cross the correct Mythic milestones',()=>{
  for(const [stars,name] of [[0,'Mythic'],[24,'Mythic'],[25,'Mythical Honor'],[49,'Mythical Honor'],[50,'Mythical Glory'],[99,'Mythical Glory'],[100,'Mythical Immortal'],[500,'Mythical Immortal']] as const) assert.equal(mythicTier(stars)?.name,name);
  for(const invalid of [-1,1.5,NaN,Infinity]) assert.equal(mythicTier(invalid),undefined);
  assert.deepEqual(MLBB_RANKS.slice(0,6).map(t=>[t.divisions.length,t.stars]),[[3,3],[3,4],[4,4],[5,5],[5,5],[5,5]]);
  assert.deepEqual(MLBB_RANKS[0].divisions,['III','II','I']);
});
test('CODM point divisions have no overlaps, gaps or invented Top 5000 tier',()=>{
  for(const [points,name,division] of [[0,'Rookie','I'],[200,'Rookie','I'],[201,'Rookie','II'],[1000,'Rookie','V'],[1001,'Veteran','I'],[3000,'Elite','V'],[3001,'Pro','I'],[4500,'Pro','V'],[4501,'Master','I'],[6000,'Master','V'],[6001,'Grandmaster','I'],[8000,'Grandmaster','V'],[8001,'Legendary',undefined],[99999,'Legendary',undefined]] as const){const rank=codmRank(points);assert.equal(rank?.tier.name,name);assert.equal(rank?.division,division);}
  assert.equal(codmRank(8000)?.next,8001);
  assert.equal(codmRank(8001)?.next,undefined);
  for(const invalid of [-1,NaN,Infinity,2.5]) assert.equal(codmRank(invalid),null);
});
test('game aliases retain CODM mode context and Dota medals do not imply MMR',()=>{
  assert.equal(rankGame('game-dota-2'),'dota2');assert.equal(rankGame('game-codm','br'),'codm-br');assert.equal(rankGame('game-codm','mp'),'codm-mp');assert.equal(rankGame('game-codm'),undefined);
  assert.equal(rankGame('game-codm-mp','br'),'codm-mp');
  assert.equal(rankUnit('codm-mp'),'Rank XP');assert.equal(rankUnit('codm-br'),'RP');
  assert.equal(rankTiers('dota2').length,8);assert.equal(rankTiers('dota2')[7].divisions.length,0);
  assert.equal(playerRank({rank:'Divine V'},'game-dota2')?.value,undefined);
  assert.equal(playerRank({rank:'Ancient 3'},'game-dota2')?.division,'III');
  assert.equal(playerRank({rank:'Grand Master IV — 7,500 RP'},'game-codm-br')?.division,'IV');
  assert.equal(playerRank({rank:'Ancient III — 4,200 MMR'},'game-dota2')?.value,4200);
  assert.equal(playerRank({rank:'Grandmaster V — 7,900 RP'},'game-codm-br')?.unit,'RP');
  assert.equal(playerRank({rank:'Grandmaster III — 6,900 Rank XP'},'game-codm-mp')?.unit,'Rank XP');
  assert.equal(playerRank({rank:'Mythic Honor 40 stars'},'game-mlbb')?.tier,'Mythical Honor');
});
test('retired catalog entries are hidden by id or name without filtering supported games',()=>{
  assert.ok(isRetiredGame({gameId:'game-val'}));assert.ok(isRetiredGame({name:'League of Legends'}));
  for(const id of ['game-mlbb','game-dota2','game-codm-mp','game-codm-br']) assert.equal(isRetiredGame({gameId:id}),false);
});
test('legacy catalog upgrades preserve edits and later removals without mutating saved input',()=>{
  const game=(id:string,name=id):GameTitle=>({id,name,registeredTeams:0,visibility:'Show everywhere',bannerImage:'',category:'Esports'});
  const defaults=['game-mlbb','game-dota2','game-codm-mp','game-codm-br'].map(id=>game(id));
  const edited={...defaults[0],name:'Campus MLBB',visibility:'Hidden' as const};
  const legacy=[edited,game('game-val','Valorant'),game('game-lol','League of Legends')];
  const upgraded=gameCatalog(legacy,defaults);
  assert.equal(upgraded.length,4);assert.equal(upgraded[0].name,'Campus MLBB');assert.equal(upgraded[0].visibility,'Hidden');
  assert.equal(legacy.length,3);assert.equal(legacy[1].id,'game-val');
  const removed=upgraded.filter(g=>g.id!=='game-dota2');
  assert.deepEqual(gameCatalog(removed,defaults),removed);
});
