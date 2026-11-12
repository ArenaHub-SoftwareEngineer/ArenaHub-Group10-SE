import test from 'node:test';
import assert from 'node:assert/strict';
import { createBracketFromTeams, updateMatchAndAdvance } from '../src/lib/bracketUtils';
import { announcementChanges, assertDocSize, bracketTeams, fingerprint, fromDocs, toRosterDoc, toTournamentDoc } from '../src/lib/data/tournamentDocs';
import type { BracketDraft, Player } from '../src/lib/types';

function sampleBracket(): BracketDraft {
  const draft = createBracketFromTeams({
    title: 'QA Cup', gameName: 'Dota 2', format: 'Double Elimination', matchFormat: 'Bo3',
    teams: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((name, i) => ({ id: `t${i}`, name, college: i % 2 ? 'CCS' : 'COE', seed: i + 1 })),
  });
  const player = (id: string): Player => ({
    id, name: `Real Name ${id}`, ign: `ign-${id}`, role: 'Carry', collegeId: 'col-ccs', isVerified: true,
    studentId: '2024-00001', department: 'Computing', program: 'BSCS', yearLevel: '2', bio: 'private bio',
  });
  const rosterFor = (id?: string) => id ? [player(`${id}-a`), player(`${id}-b`)] : [];
  return {
    ...draft, gameId: 'game-dota2', status: 'published',
    matches: draft.matches.map(m => ({
      ...m,
      team1: m.team1 ? { ...m.team1, players: m.team1.isBye ? [] : rosterFor(m.team1.id) } : m.team1,
      team2: m.team2 ? { ...m.team2, players: m.team2.isBye ? [] : rosterFor(m.team2.id) } : m.team2,
    })),
  };
}

const PRIVATE = /Real Name|2024-00001|private bio|BSCS|Computing|studentId|yearLevel|department|program/;

test('tournament and roster documents never contain private player fields', () => {
  const bracket = sampleBracket();
  const tournament = toTournamentDoc(bracket, 3);
  const roster = toRosterDoc(bracket);
  assert.doesNotMatch(JSON.stringify(tournament), PRIVATE);
  assert.doesNotMatch(JSON.stringify(roster), PRIVATE);
  assert.ok(tournament.matches.every(m => !(m.team1 as any)?.players && !(m.team2 as any)?.players), 'match teams carry no rosters');
  assert.equal(tournament.gameKey, 'game-dota2');
  assert.equal(tournament.revision, 3);
  assert.equal(roster.teams.length, 5);
  assert.deepEqual(roster.teams[0].players.map(p => p.ign), [`ign-${roster.teams[0].id}-a`, `ign-${roster.teams[0].id}-b`]);
});

test('MVP credit keeps the IGN and drops the real name', () => {
  const bracket = sampleBracket();
  bracket.matches[0] = { ...bracket.matches[0], mvp: { playerName: 'Real Name X', ign: 'ign-x', role: 'Mid', teamCode: 'CCS' } };
  const doc = toTournamentDoc(bracket, 1);
  assert.deepEqual(doc.matches[0].mvp, { playerName: 'ign-x', ign: 'ign-x', role: 'Mid', teamCode: 'CCS' });
});

test('documents round-trip back into the same match graph', () => {
  const bracket = sampleBracket();
  const rebuilt = fromDocs(toTournamentDoc(bracket, 1), toRosterDoc(bracket));
  assert.equal(rebuilt.id, bracket.id);
  assert.equal(rebuilt.matches.length, bracket.matches.length);
  const shape = (b: BracketDraft) => b.matches.map(m => ({ id: m.id, next: m.nextMatchId, t1: m.team1?.id, t2: m.team2?.id, score: m.score, status: m.status, round: m.round, type: m.bracketType }));
  assert.deepEqual(shape(rebuilt), shape(bracket));
  const firstReal = rebuilt.matches.find(m => m.team1 && !m.team1.isBye)!;
  assert.deepEqual(firstReal.team1!.players.map(p => p.ign), [`ign-${firstReal.team1!.id}-a`, `ign-${firstReal.team1!.id}-b`]);
  assert.equal(firstReal.team1!.players[0].name, firstReal.team1!.players[0].ign, 'public name falls back to IGN');
  // A second conversion of the rebuilt bracket is stable.
  assert.equal(fingerprint(toTournamentDoc(rebuilt, 1)), fingerprint(toTournamentDoc(bracket, 1)));
});

test('scoring a match changes only that tournament fingerprint and yields a result announcement', () => {
  const bracket = sampleBracket();
  const before = toTournamentDoc(bracket, 1);
  const target = bracket.matches.find(m => m.team1 && m.team2 && !m.team1.isBye && !m.team2.isBye)!;
  const scored = { ...target, score: { team1Score: 2, team2Score: 0 }, status: 'completed' as const, winnerId: target.team1!.id };
  const after = toTournamentDoc({ ...bracket, matches: updateMatchAndAdvance(bracket.matches, scored) }, 2);
  assert.notEqual(fingerprint(before.matches), fingerprint(after.matches));
  const changes = announcementChanges(before.matches, after.matches);
  assert.deepEqual(changes.map(c => [c.match.id, c.kind]), [[target.id, 'result']]);
});

test('bracketTeams skips byes and keeps the fullest roster', () => {
  const teams = bracketTeams(sampleBracket());
  assert.equal(teams.length, 5);
  assert.ok(teams.every(t => !t.isBye && t.players.length === 2));
});

test('oversized documents are refused with a clear message', () => {
  assert.throws(() => assertDocSize({ blob: 'x'.repeat(950_000) }, 'This bracket'), /too large/);
  assert.doesNotThrow(() => assertDocSize(toTournamentDoc(sampleBracket(), 1), 'This bracket'));
});
