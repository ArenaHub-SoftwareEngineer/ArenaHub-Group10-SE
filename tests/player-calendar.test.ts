import test from 'node:test';
import assert from 'node:assert/strict';
import {playerRank,publicPlayerProfile,publicBracket,directoryTeams,teamInCollege} from '../src/lib/playerProfiles';
import {validateAuthFields} from '../src/lib/authValidation';
import {scheduleDate,timeOrder,manilaToday} from '../src/lib/calendar';
import type {Player,Team,BracketDraft} from '../src/lib/types';
const p:Player={id:'p',name:'Public Name',ign:'Player',role:'Roamer',collegeId:'c',studentId:'PRIVATE-ID',isVerified:true,rank:'Mythical Glory 80★',peakRank:{tier:'Mythical Immortal',value:132,unit:'stars'}};
const team:Team={id:'t',name:'Team',collegeId:'c',collegeCode:'C',gameId:'game-mlbb',seed:1,winRate:0,record:'',players:[p]};
test('the player directory lists only published teams, once each, plus Battle Royale squads',()=>{
  const actual={...team,id:'actual',name:'Actual roster'};
  const draft={status:'published',matches:[{team1:actual},{team1:actual},{team1:{...team,id:'lol',gameId:'game-lol'}}]} as unknown as BracketDraft;
  assert.deepEqual(directoryTeams([draft]).map(row=>row.id),['actual']);
  assert.deepEqual(directoryTeams([{...draft,status:'draft'}]),[]);
  const br={status:'published',matches:[],placement:{config:{pointsTable:[10],killPoints:1},games:[],teams:[{id:'sq',name:'Night Owls',collegeCode:'CN'}]}} as unknown as BracketDraft;
  const [squad]=directoryTeams([br]);
  assert.equal(squad.gameId,'game-codm-br');assert.equal(squad.gameMode,'br');assert.equal(squad.collegeCode,'CN');assert.deepEqual(squad.players,[]);
});
test('teams match their college by code, since generated college ids do not',()=>{
  const college={id:'col-ccs',code:'CCS'};
  assert.ok(teamInCollege({collegeId:'col-3',collegeCode:'ccs'},college));
  assert.ok(teamInCollege({collegeId:'col-ccs',collegeCode:''},college));
  assert.ok(!teamInCollege({collegeId:'col-1',collegeCode:'COE'},college));
});
test('peak ranks stay distinct from current ranks and do not confuse divisions with ratings',()=>{assert.equal(playerRank(p,'game-mlbb')?.value,132);assert.equal(playerRank({...p,peakRank:undefined},'game-mlbb')?.isPeak,false);assert.equal(playerRank({rank:'Diamond 3 — 80 RR'},'game-val')?.value,80);assert.equal(playerRank({rank:'Diamond 3'},'game-val')?.value,undefined);assert.ok(playerRank({rank:'Challenger — 900 LP'},'game-lol')?.image);});
test('public profiles omit private registration fields and published nested players are scrubbed',()=>{const raw={...p,age:20,address:'PRIVATE-ADDRESS',email:'PRIVATE-EMAIL'};assert.ok(!JSON.stringify(publicPlayerProfile(raw,team)).includes('PRIVATE'));const draft={matches:[{team1:{...team,players:[raw]},team2:team}]} as unknown as BracketDraft;assert.ok(!JSON.stringify(publicBracket(draft)).includes('PRIVATE'));assert.equal(publicBracket(draft).matches[0].team1?.players[0].ign,'Player');});
test('auth validates personal email normally and rejects weak passwords before affiliation',()=>{const errors=validateAuthFields({name:'Student',email:'student@gmail.com',password:'123',campus:'Campus'},true);assert.equal(errors.email,undefined);assert.equal(errors.password,'Use 6+ characters.');assert.equal(validateAuthFields({email:'bad',password:'x'},false).email,'Invalid email.');});
test('calendar dates use Philippine today and keep undated rounds out of calendar cells',()=>{assert.equal(manilaToday(new Date('2026-10-31T17:00:00Z')),'2026-11-01');assert.equal(scheduleDate('Today','2026-11-01'),'2026-11-01');assert.equal(scheduleDate('Oct 9','2026-11-01'),'2026-10-09');assert.equal(scheduleDate('Round 1','2026-11-01'),null);assert.equal(timeOrder('Oct 9 · 4:00 PM'),960);assert.equal(timeOrder('23:15'),1395);});
