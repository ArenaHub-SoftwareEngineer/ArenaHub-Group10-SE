import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockSeconds, matchMvp, mvpCandidates, sortedTimeline, timelineEvent, MAX_TIMELINE_EVENTS } from '../src/lib/matchHighlights';
import { toTournamentDoc } from '../src/lib/data/tournamentDocs';
import type { BracketDraft, Match, Player } from '../src/lib/types';

const player = (ign: string, role: string, name: string): Player => ({ id: ign, name, ign, role, collegeId: '', isVerified: true });
const match = {
  id: 'm1', matchNumber: '#1', tournamentId: 't', gameId: 'game-mlbb', round: 1, roundName: 'Final', bracketType: 'final', matchFormat: 'Bo3',
  status: 'completed', score: { team1Score: 2, team2Score: 1 }, scheduledDate: '', scheduledTime: '', organizerName: '',
  team1: { id: 'a', name: 'Alpha', collegeId: '', collegeCode: 'CCS', gameId: 'game-mlbb', seed: 1, winRate: 0, record: '', players: [player('Riley', 'Jungler', 'Riley Real Name')] },
  team2: { id: 'b', name: 'Bravo', collegeId: '', collegeCode: 'COE', gameId: 'game-mlbb', seed: 2, winRate: 0, record: '', players: [player('Bolt', 'Roamer', 'Bolt Real Name')] },
  playerStats: { Riley: { kills: 9, deaths: 1, assists: 6, ign: 'Riley' } },
} as Match;

test('game clock parsing', () => {
  assert.equal(clockSeconds('12:35'), 755);
  assert.equal(clockSeconds('0:05'), 5);
  assert.equal(clockSeconds('12:60'), null);
  assert.equal(clockSeconds('12.35'), null);
});

test('timeline events are validated and kept in game-time order', () => {
  const late = timelineEvent(match, { time: '18:10', type: 'lord', team: 'CCS', text: 'Takes the Lord after a fight at mid' });
  const early = timelineEvent(match, { time: '2:15', type: 'first-blood', team: 'COE', text: 'First blood in the jungle' });
  assert.deepEqual(late, { time: '18:10', type: 'lord', title: 'Lord, Roshan or boss', team: 'CCS', text: 'Takes the Lord after a fight at mid' });
  assert.deepEqual(sortedTimeline([late, early]).map(e => e.time), ['2:15', '18:10']);
  assert.throws(() => timelineEvent(match, { time: 'soon', type: 'lord', team: '', text: 'Something' }), /minutes:seconds/);
  assert.throws(() => timelineEvent(match, { time: '1:00', type: 'made-up', team: '', text: 'Something' }), /what happened/);
  assert.throws(() => timelineEvent(match, { time: '1:00', type: 'ace', team: 'CN', text: 'Something' }), /two teams/);
  assert.throws(() => timelineEvent(match, { time: '1:00', type: 'ace', team: '', text: 'x' }), /3 to 200/);
  assert.throws(() => sortedTimeline(Array.from({ length: MAX_TIMELINE_EVENTS + 1 }, () => early)), /up to 60/);
});

test('the MVP comes from the rosters, carries K/D/A when entered, and is public by in-game name only', () => {
  assert.deepEqual(mvpCandidates(match).map(c => [c.ign, c.teamCode, c.kda]), [['Riley', 'CCS', '9/1/6'], ['Bolt', 'COE', undefined]]);
  const mvp = matchMvp(match, 'Riley', 'Triple kill in the deciding fight')!;
  assert.deepEqual(mvp, { playerName: 'Riley', ign: 'Riley', role: 'Jungler', teamCode: 'CCS', kda: '9/1/6', statsHighlight: 'Triple kill in the deciding fight' });
  assert.equal(matchMvp(match, ''), undefined);
  assert.throws(() => matchMvp(match, 'Stranger'), /two rosters/);
  const doc = toTournamentDoc({ id: 't', title: 'Cup', gameName: 'MLBB', format: 'Single Elimination', teamsCount: 2, matchFormat: 'Bo3', seedingRule: '', teams: [], parsedParams: {} as never, rawPrompt: '', createdAt: '', status: 'published', matches: [{ ...match, mvp, timelineEvents: [timelineEvent(match, { time: '2:15', type: 'first-blood', team: 'COE', text: 'First blood' })] }] } as BracketDraft, 1);
  const text = JSON.stringify(doc);
  assert.ok(!text.includes('Real Name'), 'no real names reach the public tournament document');
  assert.equal(doc.matches[0].timelineEvents?.length, 1);
});
