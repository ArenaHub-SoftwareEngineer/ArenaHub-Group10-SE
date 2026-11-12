import test from 'node:test';
import assert from 'node:assert/strict';
import {FAIR_PLAY_GAMES,belongsToFairPlayGame,evidenceContext} from '../src/lib/fairPlayGames';
import {checkTeamRoster} from '../src/lib/integrityChecks';
import type {Team} from '../src/lib/types';
test('game selection separates CODM BR and MP and excludes unrelated games',()=>{const br=FAIR_PLAY_GAMES[2],mp=FAIR_PLAY_GAMES[3];assert.ok(belongsToFairPlayGame({gameId:'game-codm',gameMode:'br'},br));assert.equal(belongsToFairPlayGame({gameId:'game-codm',gameMode:'br'},mp),false);assert.equal(belongsToFairPlayGame({gameId:'game-codm-mp'},br),false);assert.equal(belongsToFairPlayGame({gameId:'game-val'},br),false);assert.ok(belongsToFairPlayGame({gameId:'game-dota2'},FAIR_PLAY_GAMES[1]));});
test('evidence context keeps selected mode and cannot satisfy the detail minimum by prefix alone',()=>{assert.throws(()=>evidenceContext(FAIR_PLAY_GAMES[2],'short'));assert.ok(evidenceContext(FAIR_PLAY_GAMES[2],'Observed the full encounter at replay time 04:15.').startsWith('[ArenaHub:codm-br]'));assert.throws(()=>evidenceContext(FAIR_PLAY_GAMES[0],'x'.repeat(3000)));});
test('four-player BR rosters use the selected tournament target without an automatic five-player warning',()=>{const team={id:'a',collegeId:'c',gameId:'game-codm',players:Array.from({length:4},(_,i)=>({ign:'P'+i,name:'P'+i,studentId:'ID'+i,isVerified:true,collegeId:'c'}))} as Team;assert.equal(checkTeamRoster(team,[team],4).length,0);assert.ok(checkTeamRoster(team,[team],5).some(x=>x.startsWith('Fewer')));});
