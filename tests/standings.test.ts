import test from 'node:test';
import assert from 'node:assert/strict';
import {getStandings,completedSeries} from '../src/lib/standings';
import type {Match,Team} from '../src/lib/types';
const a={id:'a',name:'A',collegeCode:'A'} as Team,b={id:'b',name:'B',collegeCode:'B'} as Team;
const played={id:'m',team1:a,team2:b,status:'completed',matchFormat:'Bo3',score:{team1Score:2,team2Score:1},winnerId:'a'} as Match;
test('standings count played series and games and follow corrected results',()=>{
  const rows=getStandings([played]);assert.equal(rows[0].team.id,'a');assert.equal(rows[0].wins,1);assert.equal(rows[0].gameLosses,1);assert.equal(rows[1].losses,1);
  const corrected={...played,winnerId:'b',score:{team1Score:0,team2Score:2}};assert.equal(getStandings([corrected])[0].team.id,'b');
});
test('unfinished, impossible, self-play and BYE results never contribute to records',()=>{
  const invalid=[{...played,status:'live'},{...played,score:{team1Score:1,team2Score:0}},{...played,score:{team1Score:2,team2Score:-1}},{...played,score:{team1Score:2,team2Score:2}},{...played,winnerId:'b'},{...played,team2:a},{...played,team2:{...b,isBye:true}},{...played,team2:{...b,name:'TBD'}}] as Match[];
  assert.equal(completedSeries(invalid).length,0);assert.equal(getStandings(invalid).length,0);
});
