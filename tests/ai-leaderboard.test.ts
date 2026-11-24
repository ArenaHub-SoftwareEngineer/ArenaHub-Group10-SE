// Arena AI and the player leaderboard (M10): routing, the records answer, the model tool, fact checks
// against past events, and the server reader when past events cannot be read yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistant } from '../server/ai/index.ts';
import { MemoryRateStore } from '../server/ai/guard.ts';
import { Cooldown, runTool, type Provider, type ProviderRequest } from '../server/ai/provider.ts';
import { buildTools } from '../server/ai/tools.ts';
import { leaderboardSort } from '../server/ai/leaderboard.ts';
import { publishedReader, type PublishedData } from '../server/data.ts';
import { LEADERBOARD_QUESTION } from '../src/lib/tournamentKnowledge.ts';
import type { Caller } from '../server/auth.ts';
import type { BracketDraft, Match, Player, Team } from '../src/lib/types.ts';

const viewer: Caller = { uid: 'lb-viewer', email: 'viewer@wmsu.edu.ph', campus: true, admitted: true, staff: false, role: '' };
const player = (id: string, ign: string): Player => ({ id, name: ign, ign, role: 'Jungler', collegeId: '', isVerified: true });
const team = (id: string, name: string, code: string, players: Player[]): Team => ({ id, name, collegeId: '', collegeCode: code, gameId: 'game-mlbb', seed: 1, winRate: 0, record: '', players });
const sheet = (rows: Record<string, [number, number, number]>) => ({ playerStats: Object.fromEntries(Object.entries(rows).map(([id, [kills, deaths, assists]]) => [id, { kills, deaths, assists }])), notes: '' });
function bracket(id: string, title: string, t1: Team, t2: Team, score: [number, number], games: Record<string, ReturnType<typeof sheet>>): BracketDraft {
  const match = { id: `${id}-m1`, matchNumber: 'M1', tournamentId: id, gameId: 'game-mlbb', round: 1, roundName: 'Final', bracketType: 'final', matchFormat: 'Bo3', status: 'completed',
    score: { team1Score: score[0], team2Score: score[1] }, winnerId: score[0] > score[1] ? t1.id : t2.id, scheduledDate: '2026-11-10', scheduledTime: '13:00', organizerName: '', team1: t1, team2: t2, statGames: games } as Match;
  return { id, title, gameName: 'Mobile Legends: Bang Bang', gameId: 'game-mlbb', format: 'Single Elimination', teamsCount: 2, matchFormat: 'Bo3', seedingRule: '', matches: [match], teams: [],
    parsedParams: {} as BracketDraft['parsedParams'], rawPrompt: '', createdAt: '', status: 'published' };
}
// Past event: Kaizen 6/1/2 + 4/2/3. Current: Kaizen 5/0/5 + 1/1/1 + 3/2/0. Echo plays both, fewer kills.
const past = bracket('past', 'Intramurals Cup', team('pa', 'Crimson Wolves', 'CCS', [player('pa-0', 'Kaizen')]), team('pb', 'Azure Hawks', 'COE', [player('pb-0', 'Echo')]), [2, 0],
  { 1: sheet({ 'pa-0': [6, 1, 2], 'pb-0': [1, 3, 0] }), 2: sheet({ 'pa-0': [4, 2, 3], 'pb-0': [2, 4, 1] }) });
const current = bracket('now', 'Palaro Qualifiers', team('na', 'Crimson Wolves', 'CCS', [player('na-0', 'Kaizen')]), team('nb', 'Azure Hawks', 'COE', [player('nb-0', 'Echo')]), [2, 1],
  { 1: sheet({ 'na-0': [5, 0, 5], 'nb-0': [3, 2, 1] }), 2: sheet({ 'na-0': [1, 1, 1], 'nb-0': [4, 1, 2] }), 3: sheet({ 'na-0': [3, 2, 0], 'nb-0': [0, 3, 1] }) });
const data: PublishedData = { brackets: [current], archived: [past], revision: 'r1|a:past:1', checkedAt: '2026-11-18T04:00:00.000Z' };

function assistant(providers: Provider[]) {
  return createAssistant({ providers, config: { userPerMinute: 5, globalPerMinute: 100 }, rate: new MemoryRateStore(), cooldown: new Cooldown(), log: () => {} });
}
async function ask(a: ReturnType<typeof assistant>, query: string) {
  let streamed = '';
  const result = await a.answer({ caller: viewer, query, history: [], data, signal: new AbortController().signal }, { start: () => {}, delta: d => { streamed += d; } });
  assert.equal(streamed, result.text);
  return result;
}

test('leaderboard questions are recognised; match MVP and team standings questions are not', () => {
  for (const q of ['Who has the most kills in MLBB?', 'Top 5 players by KDA', 'MLBB leaderboard', 'who has the highest KDA', 'Who has the most MVPs?', 'kill leader sa Dota', 'Sino pinakamaraming kills?', 'player stats for MLBB'])
    assert.ok(LEADERBOARD_QUESTION.test(q), q);
  for (const q of ['Who was the MVP of the MLBB semifinal M1?', 'MLBB standings', 'Show the MLBB players roster', 'Who leads CODM BR?'])
    assert.ok(!LEADERBOARD_QUESTION.test(q), q);
  assert.deepEqual(['most kills', 'most assists', 'most MVPs', 'most series wins', 'best KDA'].map(leaderboardSort), ['kills', 'assists', 'mvps', 'wins', 'kda']);
});

test('without a model, the records answer ranks players across past and current tournaments', async () => {
  const result = await ask(assistant([]), 'Who has the most kills in MLBB?');
  assert.equal(result.source, 'Live records');
  // Kaizen: 6+4+5+1+3 = 19 kills over 5 games. Echo: 1+2+3+4+0 = 10.
  assert.match(result.text, /^Top of Mobile Legends by kills: Kaizen \(Crimson Wolves\), with 19 kills\./);
  assert.match(result.text, /- 1st Kaizen \(Crimson Wolves, CCS\): 19 kills, 6 deaths, 11 assists over 5 games/);
  assert.match(result.text, /- 2nd Echo \(Azure Hawks, COE\): 10 kills/);
  assert.doesNotMatch(result.text, /#|\*\*/);
  assert.deepEqual(result.references.map(r => r.bracketId), ['now'], 'only the current tournament can be opened');
});

test('the model gets the leaderboard tool, and a correct answer naming past results is not blocked', async () => {
  let toolResult: any;
  const m = { id: 'mock' as const, calls: 0, async *stream(request: ProviderRequest) {
    m.calls++;
    toolResult = await runTool(request.tools, 'getPlayerLeaderboard', { game: 'mlbb', player: 'kaizen' });
    const k = toolResult.players[0];
    yield `Kaizen of Crimson Wolves has ${k.kills} kills over ${k.gamesWithStats} games, KDA ${k.kda}, and won ${k.seriesWon} of ${k.seriesWon + k.seriesLost} series. `;
    yield 'In the Intramurals Cup final, Crimson Wolves won 2-0.';
  }, async json() { return null; } };
  const result = await ask(assistant([m]), 'How is Kaizen doing in MLBB? Top players by KDA');
  assert.equal(m.calls, 1);
  assert.notEqual(result.source, 'Live records', `the model answer was replaced: ${result.text}`);
  assert.match(result.text, /19 kills over 5 games, KDA 5\.00, and won 2 of 2 series/);
  assert.deepEqual(toolResult.players[0].recentMatches.map((h: any) => h.tournament), ['Palaro Qualifiers', 'Intramurals Cup']);
});

test('the tool ranks, limits, explains and rejects bad arguments', async () => {
  const tools = buildTools({ brackets: data.brackets, archived: data.archived, checkedAt: data.checkedAt, staff: false });
  const top = await runTool(tools, 'getPlayerLeaderboard', { game: 'mlbb', sort: 'kills', limit: 1 }) as any;
  assert.equal(top.rankedBy, 'Kills');
  assert.deepEqual(top.games[0].top.map((r: any) => [r.rank, r.ign, r.kills]), [[1, 'Kaizen', 19]]);
  assert.deepEqual(top.games[0].tournamentsCounted, ['Intramurals Cup (past)', 'Palaro Qualifiers']);
  assert.match(top.rules, /KDA rank needs 3 games/);
  const nobody = await runTool(tools, 'getPlayerLeaderboard', { player: 'zz-nobody' }) as any;
  assert.match(nobody.note, /No player named like/);
  const bad = await runTool(tools, 'getPlayerLeaderboard', { sort: 'height' }) as any;
  assert.match(bad.error, /Invalid arguments/);
});

// ---- Server reader: Firestore REST, as used without a service account. ----
const encode = (value: unknown): any => typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { booleanValue: value }
  : typeof value === 'number' ? { integerValue: String(value) } : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } }
  : value && typeof value === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } } : { nullValue: null };
const doc = (id: string, status: string) => ({ document: { name: `projects/p/databases/(default)/documents/tournaments/${id}`, fields: encode({ id, title: id, gameId: 'game-mlbb', gameName: 'MLBB', gameKey: 'game-mlbb', format: 'Single Elimination', matchFormat: 'Bo3', teamsCount: 2, status, revision: 3, matches: [] }).mapValue.fields } });

function fakeFirestore(archivedAllowed: boolean): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith(':runQuery')) {
      const status = JSON.parse(String(init?.body)).structuredQuery.where.fieldFilter.value.stringValue;
      if (status === 'archived' && !archivedAllowed) return new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 });
      return new Response(JSON.stringify([status === 'published' ? doc('now', 'published') : doc('past', 'archived')]), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

test('the server reader returns past events separately and keys the cache on them', async () => {
  const read = publishedReader({ VITE_FIREBASE_PROJECT_ID: 'arenahub-lb-test' }, { fetcher: fakeFirestore(true), ttlMs: 0 });
  const result = await read('token');
  assert.deepEqual(result.brackets.map(b => b.id), ['now']);
  assert.deepEqual(result.archived?.map(b => b.id), ['past']);
  assert.equal(result.revision, 'now:3|a:past:3');
});

test('where the rules do not allow past events yet, published answers still work', async () => {
  const read = publishedReader({ VITE_FIREBASE_PROJECT_ID: 'arenahub-lb-test' }, { fetcher: fakeFirestore(false), ttlMs: 0 });
  const result = await read('token');
  assert.deepEqual(result.brackets.map(b => b.id), ['now']);
  assert.deepEqual(result.archived, []);
  assert.equal(result.revision, 'now:3');
});
