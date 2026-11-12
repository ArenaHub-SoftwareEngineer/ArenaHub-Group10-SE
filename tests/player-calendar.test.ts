import test from 'node:test';
import assert from 'node:assert/strict';
import {playerRank,publicPlayerProfile,publicBracket,directoryTeams} from '../src/lib/playerProfiles';
import {validateAuthFields} from '../src/lib/authValidation';
import {scheduleDate,timeOrder,manilaToday} from '../src/lib/calendar';
import type {Player,Team,BracketDraft} from '../src/lib/types';
const p:Player={id:'p',name:'Public Name',ign:'Player',role:'Roamer',collegeId:'c',studentId:'PRIVATE-ID',isVerified:true,rank:'Mythical Glory 80★',peakRank:{tier:'Mythical Immortal',value:132,unit:'stars'}};
const team:Team={id:'t',name:'Team',collegeId:'c',collegeCode:'C',gameId:'game-mlbb',seed:1,winRate:0,record:'',players:[p]};
test('published player directories replace samples and deduplicate advancing rosters',()=>{
  const actual={...team,id:'actual',name:'Actual roster'},sample={...team,id:'sample'};
  const draft={status:'published',matches:[{team1:actual},{team1:actual}]} as unknown as BracketDraft;
  const rows=directoryTeams([sample,{...sample,id:'lol',gameId:'game-lol'}],[draft]);assert.deepEqual(rows.map(row=>row.id),['actual']);
  assert.equal(directoryTeams([sample],[{...draft,status:'draft'}])[0].id,'sample');
});
test('peak ranks stay distinct from current ranks and do not confuse divisions with ratings',()=>{assert.equal(playerRank(p,'game-mlbb')?.value,132);assert.equal(playerRank({...p,peakRank:undefined},'game-mlbb')?.isPeak,false);assert.equal(playerRank({rank:'Diamond 3 — 80 RR'},'game-val')?.value,80);assert.equal(playerRank({rank:'Diamond 3'},'game-val')?.value,undefined);assert.ok(playerRank({rank:'Challenger — 900 LP'},'game-lol')?.image);});
test('public profiles omit private registration fields and published nested players are scrubbed',()=>{const raw={...p,age:20,address:'PRIVATE-ADDRESS',email:'PRIVATE-EMAIL'};assert.ok(!JSON.stringify(publicPlayerProfile(raw,team)).includes('PRIVATE'));const draft={matches:[{team1:{...team,players:[raw]},team2:team}]} as unknown as BracketDraft;assert.ok(!JSON.stringify(publicBracket(draft)).includes('PRIVATE'));assert.equal(publicBracket(draft).matches[0].team1?.players[0].ign,'Player');});
test('auth validates personal email normally and rejects weak passwords before affiliation',()=>{const errors=validateAuthFields({name:'Student',email:'student@gmail.com',password:'123',campus:'Campus'},true);assert.equal(errors.email,undefined);assert.equal(errors.password,'Use 6+ characters.');assert.equal(validateAuthFields({email:'bad',password:'x'},false).email,'Invalid email.');});
test('calendar dates use Philippine today and keep undated rounds out of calendar cells',()=>{assert.equal(manilaToday(new Date('2026-10-31T17:00:00Z')),'2026-11-01');assert.equal(scheduleDate('Today','2026-11-01'),'2026-11-01');assert.equal(scheduleDate('Oct 9','2026-11-01'),'2026-10-09');assert.equal(scheduleDate('Round 1','2026-11-01'),null);assert.equal(timeOrder('Oct 9 · 4:00 PM'),960);assert.equal(timeOrder('23:15'),1395);});
