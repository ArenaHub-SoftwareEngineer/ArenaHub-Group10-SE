import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTeamRoster, validateEvidenceUrl, validateReport, validateScore } from '../src/lib/integrityChecks';
import { createBracketFromTeams, updateMatchAndAdvance, parseTeamsFromCSV } from '../src/lib/bracketUtils';
import { Team } from '../src/lib/types';
import { validateEmail, validateProfile } from '../src/lib/profileValidation';
import { buildEmbedUrl, detectPlatform } from '../src/lib/streamUtils';

test('stream embeds accept supported HTTPS hosts and reject deceptive or executable URLs', () => {
  for (const url of ['https://youtu.be/P5E3LDzWTRg', 'https://www.youtube.com/watch?v=P5E3LDzWTRg', 'https://www.youtube.com/live/P5E3LDzWTRg', 'https://www.youtube.com/embed/P5E3LDzWTRg']) assert.equal(buildEmbedUrl(url, detectPlatform(url)), 'https://www.youtube.com/embed/P5E3LDzWTRg?autoplay=1&mute=1&playsinline=1&rel=0');
  for (const url of ['javascript:alert(1)//youtube.com/embed/P5E3LDzWTRg', 'https://youtube.com.evil.test/watch?v=P5E3LDzWTRg', 'https://evil.test/?youtube.com/embed/P5E3LDzWTRg', 'http://youtu.be/P5E3LDzWTRg', 'https://user:secret@youtube.com/watch?v=P5E3LDzWTRg', 'https://youtu.be/invalid']) assert.equal(buildEmbedUrl(url, detectPlatform(url)), null);
  assert.ok(buildEmbedUrl('https://www.facebook.com/test/videos/12345', 'facebook')?.startsWith('https://www.facebook.com/plugins/video.php?'));
  assert.equal(buildEmbedUrl('https://www.facebook.com/', 'facebook'), null);
});

test('profile edits validate trimmed lengths, control characters and email structure', () => {
  assert.equal(validateProfile('  Arena Player  ', 'Test Campus'), null);
  assert.ok(validateProfile(' ', 'Test Campus'));
  assert.ok(validateProfile('A'.repeat(81), 'Test Campus'));
  assert.ok(validateProfile('Arena Player', ' '));
  assert.ok(validateProfile('Arena\nPlayer', 'Test Campus'));
  assert.equal(validateEmail(' player@arena.test '), null);
  for (const email of ['a', 'a@', '@arena.test', 'a b@arena.test', 'a@arena']) assert.ok(validateEmail(email));
});

test('series scores reject negatives, fractions, impossible wins and unfinished finals', () => {
  for (const scores of [[-1, 0], [0.5, 0], [3, 0], [2, 2], [NaN, 0]]) assert.throws(() => validateScore('Bo3', ...scores as [number, number]));
  assert.throws(() => validateScore('Bo3', 1, 0, true));
  assert.doesNotThrow(() => validateScore('Bo3', 2, 1, true));
  assert.doesNotThrow(() => validateScore('Bo5', 3, 2, true));
  assert.doesNotThrow(() => validateScore('Bo1', 1, 0, true));
  assert.doesNotThrow(() => validateScore('Bo7', 4, 3, true));
  assert.throws(() => validateScore('Bo7', 3, 2, true));
  assert.throws(() => validateScore('Bo7', 5, 2));
});
test('evidence links reject unsafe protocols, deceptive hosts and credentials', () => {
  for (const url of ['javascript:alert(1)', 'http://youtu.be/video', 'https://youtube.com.evil.test/video', 'https://user:secret@youtu.be/video', 'https://localhost/a', 'https://127.0.0.1/a']) assert.throws(() => validateEvidenceUrl(url));
  assert.equal(validateEvidenceUrl(' https://youtu.be/example?t=35 '), 'https://youtu.be/example?t=35');
});
test('reports require a match, supported reason, useful detail and evidence', () => {
  const input = { matchId: 'match-1', reason: 'Score dispute', details: 'At replay timestamp 12:35 the displayed series score is incorrect.', evidenceUrl: 'https://youtu.be/example' };
  assert.equal(validateReport(input).reason, 'Score dispute');
  assert.throws(() => validateReport({ ...input, matchId: '' }));
  assert.throws(() => validateReport({ ...input, details: 'cheater' }));
  assert.throws(() => validateReport({ ...input, reason: 'Ban this person' }));
});
function roster(id: string, game = 'mlbb'): Team {
  return { id, name: id, gameId: game, collegeId: 'college-1', collegeCode: 'CCS', seed: 1, winRate: 0, record: '0–0', players: Array.from({ length: 5 }, (_, i) => ({ id: `${id}-${i}`, studentId: `${id}-student-${i}`, name: `Player ${i}`, ign: `ign-${i}`, role: 'Player', collegeId: 'college-1', isVerified: true })) };
}
test('roster checks flag duplicates in the same game but permit cross-game participation', () => {
  const a = roster('A'), b = roster('B'); b.players[0].studentId = a.players[0].studentId;
  assert.ok(checkTeamRoster(a, [a, b]).some(i => i.includes('another roster')));
  b.gameId = 'dota2'; assert.deepEqual(checkTeamRoster(a, [a, b]), []);
  a.players[0].isVerified = false; a.players[1].collegeId = 'other'; a.players[2].studentId = a.players[3].studentId;
  const issues = checkTeamRoster(a, [a, b]);
  assert.ok(issues.some(i => i.includes('verification pending'))); assert.ok(issues.some(i => i.includes('college'))); assert.ok(issues.some(i => i.includes('duplicate')));
});
test('arbitrary tournament sizes produce valid trees and automatically advance byes', () => {
  for (const count of [2, 3, 5, 8, 17, 64, 256]) {
    const d = createBracketFromTeams({ title: 'Test', teams: Array.from({ length: count }, (_, i) => ({ name: `Team ${i + 1}`, seed: i + 1 })), explicitBracketSize: count });
    const size = 2 ** Math.ceil(Math.log2(count));
    assert.equal(d.matches.length, size - 1);
    assert.equal(new Set(d.matches.map(m => m.id)).size, d.matches.length);
    assert.ok(d.matches.filter(m => m.team2?.isBye).every(m => m.status === 'completed' && m.winnerId));
  }
  for (const count of [0, 1, 257]) assert.throws(() => createBracketFromTeams({ title: 'Invalid', teams: [], explicitBracketSize: count }));
  assert.ok(createBracketFromTeams({ title: 'Double elimination', teams: [], explicitBracketSize: 4, format: 'Double Elimination' }).matches.some(match => match.bracketType === 'lower'));
});
test('correcting a winner invalidates dependent results without disturbing the other feeder', () => {
  const d = createBracketFromTeams({ title: 'Test', teams: ['A', 'B', 'C', 'D'].map(name => ({ name })) });
  const first = d.matches.find(m => m.round === 1)!;
  const other = d.matches.find(m => m.round === 1 && m.id !== first.id)!;
  let matches = updateMatchAndAdvance(d.matches, { ...first, winnerId: first.team1!.id, status: 'completed', score: { team1Score: 2, team2Score: 0 } });
  matches = updateMatchAndAdvance(matches, { ...other, winnerId: other.team1!.id, status: 'completed', score: { team1Score: 2, team2Score: 0 } });
  const final = matches.find(m => m.id === first.nextMatchId)!;
  matches = updateMatchAndAdvance(matches, { ...final, winnerId: final.team1!.id, status: 'completed', score: { team1Score: 2, team2Score: 0 } });
  matches = updateMatchAndAdvance(matches, { ...first, winnerId: first.team2!.id, status: 'completed', score: { team1Score: 0, team2Score: 2 } });
  const revised = matches.find(m => m.id === final.id)!;
  assert.equal(revised.winnerId, undefined); assert.equal(revised.status, 'upcoming'); assert.equal(revised.team1?.id, first.team2!.id); assert.equal(revised.team2?.id, other.team1!.id);
});
test('CSV team import preserves quoted commas', () => {
  const teams = parseTeamsFromCSV('name,college,seed\n"Alpha, Squad",CCS,1\nBeta,COE,2');
  assert.equal(teams[0].name, 'Alpha, Squad'); assert.equal(teams[1].name, 'Beta');
});

import { csvCell } from '../src/lib/exportUtils';
test('schedule exports escape formulas and quoted team names', () => { assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"'); assert.equal(csvCell('Alpha, "Squad"'), '"Alpha, ""Squad"""'); });
