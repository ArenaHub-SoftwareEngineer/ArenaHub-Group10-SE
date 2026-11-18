import test from 'node:test';
import assert from 'node:assert/strict';
import { createBracketFromTeams, updateMatchAndAdvance } from '../src/lib/bracketUtils';
import { advanceSwiss, swiss, swissComplete, swissStandings, swissRoundCount } from '../src/lib/formats/swiss';
import { getTournamentStandings } from '../src/lib/standings';
import { fromDocs, toRosterDoc, toTournamentDoc } from '../src/lib/data/tournamentDocs';
import { parseBracketPromptLocally, resolveBracketRequest } from '../src/lib/bracketRequest';
import { knowledgeSnapshot } from '../src/lib/tournamentKnowledge';
import { buildTools } from '../server/ai/tools';
import type { Match } from '../src/lib/types';
import { canEditRoundFormat, changeRoundFormat } from '../src/lib/tournamentFormats';

const draft = (count = 5) => createBracketFromTeams({ title: 'Swiss QA', format: 'Swiss', gameName: 'Dota 2', matchFormat: 'Bo3', teams: Array.from({ length: count }, (_, i) => ({ name: `Squad ${i + 1}`, seed: i + 1 })) });
const finish = (match: Match, side = 1): Match => ({ ...match, status: 'completed', winnerId: side === 1 ? match.team1!.id : match.team2!.id, score: { team1Score: side === 1 ? 2 : 0, team2Score: side === 2 ? 2 : 0 } });
function finishRound(matches: Match[], round: number) {
  for (const match of matches.filter(m => m.round === round && !m.team1?.isBye && !m.team2?.isBye)) matches = updateMatchAndAdvance(matches, finish(match));
  return matches;
}

test('Swiss completes every supported field with one appearance per team per round and no rematches', () => {
  for (const count of [2, 3, 4, 5, 7, 8, 16, 31, 32, 64, 127, 128]) {
    let matches = draft(count).matches;
    const pairs = new Set<string>(), byeTeams = new Set<string>();
    for (let round = 1; round <= swissRoundCount(count); round++) {
      const current = matches.filter(m => m.round === round);
      const ids = current.flatMap(m => [m.team1, m.team2]).filter(t => t && !t.isBye).map(t => t!.id);
      assert.equal(ids.length, count, `field ${count}, round ${round}`);
      assert.equal(new Set(ids).size, count);
      for (const match of current) {
        if (match.team2?.isBye) {
          assert.ok(!byeTeams.has(match.team1!.id), 'no repeat bye');
          byeTeams.add(match.team1!.id);
        } else {
          const key = [match.team1!.id, match.team2!.id].sort().join(':');
          assert.ok(!pairs.has(key), `rematch in field ${count}, round ${round}`);
          pairs.add(key);
        }
      }
      matches = finishRound(matches, round);
    }
    assert.ok(swissComplete(matches));
    assert.equal(swissStandings(matches).length, count);
    assert.equal(advanceSwiss(matches).length, matches.length, 'completion does not create another round');
  }
});

test('Swiss waits for all results and generates the next round exactly once', () => {
  const first = draft(4).matches;
  let matches = updateMatchAndAdvance(first, finish(first[0]));
  assert.equal(matches.length, 2);
  matches = updateMatchAndAdvance(matches, finish(first[1]));
  assert.equal(matches.length, 4);
  assert.equal(advanceSwiss(matches).length, 4);
  assert.equal(swissComplete(matches), false);
});

test('an unstarted Swiss round with a BYE can change series length without losing its bye win', () => {
  const first = draft().matches;
  assert.equal(canEditRoundFormat(first), true);
  const changed = changeRoundFormat(first, 1, 'Bo1');
  assert.ok(changed.every(m => m.matchFormat === 'Bo1'));
  assert.equal(changed.find(m => m.team2?.isBye)!.score.team1Score, 1);
  assert.equal(getTournamentStandings(changed)[0].wins, 1);
  const live = changed.map((m, i) => i === 0 ? { ...m, status: 'live' as const } : m);
  assert.equal(canEditRoundFormat(live), false);
  assert.equal(changeRoundFormat(live, 1, 'Bo5'), live);
});

test('Swiss corrections rebuild unstarted rounds and preserve started pairings', () => {
  const initial = finishRound(draft(8).matches, 1);
  const source = initial[0];
  const changed = finish(source, 2);
  const corrected = updateMatchAndAdvance(initial, changed);
  assert.notDeepEqual(corrected.filter(m => m.round === 2).map(m => [m.team1!.id, m.team2!.id]), initial.filter(m => m.round === 2).map(m => [m.team1!.id, m.team2!.id]));
  const live = initial.map(m => m.round === 2 ? { ...m, status: 'live' as const } : m);
  assert.deepEqual(updateMatchAndAdvance(live, changed).filter(m => m.round === 2), live.filter(m => m.round === 2));
  const reopened = updateMatchAndAdvance(initial, { ...source, status: 'upcoming', winnerId: undefined, score: { team1Score: 0, team2Score: 0 } });
  assert.ok(reopened.every(m => m.round === 1));
});

test('Swiss metadata changes preserve later schedules and unknown updates do nothing', () => {
  const matches = finishRound(draft(4).matches, 1).map(m => m.round === 2 ? { ...m, scheduledDate: '2026-12-04', scheduledTime: '14:00' } : m);
  assert.deepEqual(updateMatchAndAdvance(matches, { ...matches[0], organizerName: 'New referee' }).filter(m => m.round === 2), matches.filter(m => m.round === 2));
  assert.equal(updateMatchAndAdvance(matches, { ...matches[0], id: 'missing' }), matches);
});

test('Swiss standings reject impossible results and count BYEs only as series wins', () => {
  const matches = draft(5).matches;
  const bye = matches.find(m => m.team2?.isBye)!;
  const rows = getTournamentStandings(matches);
  assert.equal(rows[0].team.id, bye.team1!.id);
  assert.equal(rows[0].wins, 1);
  assert.equal(rows[0].byes, 1);
  assert.equal(rows[0].gameWins, 0);
  const invalid = { ...finish(matches[0]), score: { team1Score: 1, team2Score: 0 } };
  assert.ok(swissStandings([invalid]).every(row => row.wins === 0 && row.losses === 0 && row.opponents.length === 0));
  assert.ok(swissStandings([{ ...finish(matches[0]), winnerId: matches[0].team2!.id }]).every(row => row.wins === 0));
});

test('Swiss public documents retain round metadata and roster references', () => {
  const bracket = draft();
  bracket.matches = finishRound(bracket.matches, 1);
  const restored = fromDocs(toTournamentDoc(bracket, 1), toRosterDoc(bracket));
  assert.equal(restored.matches.length, bracket.matches.length);
  assert.ok(restored.matches.every(m => m.tournamentFormat === 'swiss' && m.swissRounds === 3));
  assert.deepEqual(getTournamentStandings(restored.matches), getTournamentStandings(bracket.matches).map(row => ({ ...row, team: restored.matches.flatMap(m => [m.team1, m.team2]).find(t => t?.id === row.team.id) })));
});

test('Swiss prompt limits match manual setup and there is no invented final series', () => {
  const resolve = (prompt: string) => resolveBracketRequest(prompt, parseBracketPromptLocally(prompt));
  const valid = resolve('MLBB 8 teams Swiss Bo3');
  assert.equal(valid.kind, 'ready');
  if (valid.kind === 'ready') {
    assert.equal(valid.request.format, 'Swiss');
    assert.equal(valid.request.finalMatchFormat, 'Bo3');
    assert.ok(!valid.request.defaults.includes('finalMatchFormat'));
  }
  const tooMany = resolve('MLBB 129 teams Swiss');
  assert.equal(tooMany.kind, 'question');
  if (tooMany.kind === 'question') assert.match(tooMany.text, /128/);
  assert.equal(resolve('MLBB 33 teams round robin').kind, 'question');
});

test('Swiss enforces distinct entrants, field limits and whole round counts', () => {
  const matches = draft(4).matches, teams = matches.flatMap(m => [m.team1!, m.team2!]);
  assert.throws(() => draft(129), /128/);
  assert.throws(() => swiss([teams[0], teams[0]], matches[0], 'Bo3'), /distinct/);
  for (const rounds of [0, NaN, Infinity, 1.5, 4]) assert.throws(() => swiss(teams, matches[0], 'Bo3', rounds), /rounds/);
});

test('Arena AI and viewers use identical Swiss rankings, including byes and Buchholz', async () => {
  const bracket = { ...draft(), status: 'published' as const };
  bracket.matches = finishRound(bracket.matches, 1);
  const snapshot = knowledgeSnapshot([bracket]);
  assert.equal(snapshot.brackets[0].matches[0].tournamentFormat, 'swiss');
  const tools = buildTools({ brackets: snapshot.brackets, checkedAt: snapshot.checkedAt, staff: false });
  const result = await tools.find(t => t.name === 'getStandings')!.run({ tournament: bracket.id });
  const data = result.data as { rows: Array<{ team: string; wins: number; buchholz: number; byes: number }> };
  assert.deepEqual(data.rows.map(row => [row.team, row.wins, row.buchholz, row.byes]), getTournamentStandings(bracket.matches).map(row => [row.team.name, row.wins, row.buchholz, row.byes]));
  const help = await tools.find(t => t.name === 'explainFormat')!.run({ format: 'swiss' });
  assert.match(JSON.stringify(help.data), /Buchholz/);
});
