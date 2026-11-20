// Arena AI modes (Quick, Think, Deep), visible reasoning, record blocks and the 5-hour allowance.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createAssistant, type AnswerResult, type ModeSetup } from '../server/ai/index.ts';
import { MemoryRateStore } from '../server/ai/guard.ts';
import { attemptSignal, Cooldown, runTool, type Provider, type ProviderRequest } from '../server/ai/provider.ts';
import { groqProvider, reasoningEffort } from '../server/ai/groq.ts';
import { addTokens, allowanceOf, MemoryUsageStore } from '../server/ai/usage.ts';
import { blocksFor } from '../server/ai/blocks.ts';
import { createAiRouter } from '../server/ai.ts';
import { parseBlocks } from '../src/lib/aiBlocks.ts';
import { emptyHistory, loadHistory, saveHistory, type HistoryStorage } from '../src/lib/chatHistory.ts';
import type { Caller } from '../server/auth.ts';
import type { AiMode } from '../server/ai/config.ts';
import { publishedFixture } from './fixtures/ai/tournaments.ts';

const HOUR = 3_600_000;
const viewer: Caller = { uid: 'thinker', email: 'thinker@wmsu.edu.ph', campus: true, admitted: true, staff: false, role: '' };
const policy = { tokensPerWindow: 10_000, windowHours: 5, staffMultiplier: 2 };
const data = publishedFixture();

// ---- The allowance window ----
test('a window opens with the first question, adds up, and resets after five hours', () => {
  const t0 = Date.parse('2026-11-18T01:00:00Z');
  let record = { used: 0, startedAt: null as number | null };
  assert.deepEqual(allowanceOf(record, policy, false, t0), { used: 0, limit: 10_000, windowHours: 5, startedAt: null, resetsAt: null, exhausted: false });
  record = addTokens(record, 4000, t0, 5, t0 + 3000);
  assert.equal(record.startedAt, t0, 'the window starts when the question was asked');
  record = addTokens(record, 7000, t0 + HOUR, 5, t0 + HOUR);
  const mid = allowanceOf(record, policy, false, t0 + 2 * HOUR);
  assert.deepEqual([mid.used, mid.exhausted, mid.resetsAt], [11_000, true, t0 + 5 * HOUR]);
  assert.equal(allowanceOf(record, policy, true, t0 + 2 * HOUR).exhausted, false, 'staff have twice the allowance');
  const after = allowanceOf(record, policy, false, t0 + 5 * HOUR);
  assert.deepEqual([after.used, after.startedAt, after.exhausted], [0, null, false], 'a fresh allowance after the window');
  // Asked just before the old window ended, finished just after: the new window starts now.
  const edge = addTokens(record, 500, t0 + 5 * HOUR - 1000, 5, t0 + 5 * HOUR + 2000);
  assert.deepEqual(edge, { used: 500, startedAt: t0 + 5 * HOUR + 2000 });
});

// ---- The pipeline ----
type Plan = (request: ProviderRequest) => AsyncGenerator<string>;
function model(plan: Plan): Provider & { calls: number; lastRequest?: ProviderRequest } {
  const provider = { id: 'mock' as const, calls: 0, lastRequest: undefined as ProviderRequest | undefined,
    async *stream(request: ProviderRequest) { provider.calls++; provider.lastRequest = request; yield* plan(request); }, async json() { return null; } };
  return provider;
}
/** Reasons, reads the MLBB standings and the tournament list, then answers. */
const reasoner: Plan = async function* (request) {
  request.onThought?.('They want the MLBB table. I should read the standings rather than guess.');
  await runTool(request.tools, 'listTournaments', {});
  await runTool(request.tools, 'getStandings', { tournament: 'mlbb' });
  request.onUsage?.(2500);
  yield 'Crimson Wolves lead the MLBB standings. ';
  request.onUsage?.(1500);
  yield 'The table below has every team.';
};
function setup(provider: Provider, usage = new MemoryUsageStore(5)) {
  const modes: Record<AiMode, ModeSetup> = {
    quick: { providers: [provider], thinkingBudget: 0, recordsFirst: true },
    think: { providers: [provider], thinkingBudget: 2048, recordsFirst: false },
    deep: { providers: [provider], thinkingBudget: 8192, recordsFirst: false },
  };
  return { usage, assistant: createAssistant({ providers: [provider], modes, usage: { store: usage, policy }, config: { userPerMinute: 50, globalPerMinute: 500 }, rate: new MemoryRateStore(), cooldown: new Cooldown(), log: () => {} }) };
}
async function ask(assistant: ReturnType<typeof setup>['assistant'], query: string, mode: AiMode) {
  const seen: Array<[string, unknown]> = [];
  const result: AnswerResult = await assistant.answer({ caller: viewer, query, history: [], data, signal: new AbortController().signal, mode }, {
    start: source => seen.push(['start', source]), delta: text => seen.push(['delta', text]),
    step: label => seen.push(['step', label]), thinking: text => seen.push(['thinking', text]), block: block => seen.push(['block', block]),
  });
  return { result, seen, order: seen.map(([kind]) => kind).filter((kind, i, all) => kind !== all[i - 1]) };
}

test('Think reasons with the model first, even for a question the records could answer', async () => {
  const m = model(reasoner);
  const { assistant } = setup(m);
  const { result, order, seen } = await ask(assistant, 'MLBB standings', 'think');
  assert.equal(m.calls, 1);
  assert.equal(m.lastRequest?.thinkingBudget, 2048);
  assert.deepEqual(order, ['thinking', 'step', 'start', 'delta', 'block'], 'reasoning and lookups come before the answer, the table after it');
  assert.deepEqual(result.steps, ['Listing tournaments', 'Reading “mlbb” standings']);
  assert.match(result.thinking!, /read the standings rather than guess/);
  // The tournament list was only a lookup on the way; the standings table is what is shown.
  assert.deepEqual(result.blocks!.map(b => b.title), ['Campus Cup MLBB']);
  const table = seen.find(([kind]) => kind === 'block')![1] as any;
  assert.deepEqual(table.columns.map((c: any) => c.key), ['team', 'college', 'wins', 'losses', 'games']);
  assert.equal(result.tokens, 4000, 'the tokens the API reported');
  assert.deepEqual([result.allowance!.used, result.allowance!.limit], [4000, 10_000]);
  assert.ok(result.thoughtMs! >= 0);
});

test('Quick answers factual questions from the records without the model and without using the allowance', async () => {
  const m = model(reasoner);
  const { assistant } = setup(m);
  const { result } = await ask(assistant, 'MLBB standings', 'quick');
  assert.equal(m.calls, 0);
  assert.equal(result.source, 'Live records');
  assert.equal(result.allowance?.used, 0);
  assert.equal(m.lastRequest, undefined);
});

test('the same question and records reuse the answer for free; modes do not share answers', async () => {
  const m = model(reasoner);
  const { assistant } = setup(m);
  await ask(assistant, 'MLBB standings', 'think');
  const again = await ask(assistant, 'MLBB standings', 'think');
  assert.equal(m.calls, 1);
  assert.equal(again.result.cached, true);
  assert.equal(again.result.tokens, 0);
  assert.equal(again.result.allowance!.used, 4000, 'a reused answer costs nothing');
  assert.deepEqual(again.order, ['step', 'thinking', 'start', 'delta', 'block'], 'the saved reasoning and table come back with it');
  await ask(assistant, 'MLBB standings', 'deep');
  assert.equal(m.calls, 2);
  assert.equal(m.lastRequest?.thinkingBudget, 8192);
});

test('when the allowance is used up, the live records answer and the model is not called', async () => {
  const m = model(reasoner);
  const usage = new MemoryUsageStore(5);
  await usage.add(viewer.uid, 10_000, Date.now());
  const { assistant } = setup(m, usage);
  const { result } = await ask(assistant, 'Who leads MLBB and why?', 'think');
  assert.equal(m.calls, 0);
  assert.equal(result.source, 'Live records');
  assert.equal(result.allowanceUsed, true);
  assert.equal(result.allowance!.exhausted, true);
  assert.ok(result.allowance!.resetsAt! > Date.now());
});

test('a model that is reasoning is not abandoned as silent', async () => {
  const attempt = attemptSignal(new AbortController().signal, 60);
  for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 30)); attempt.alive(); }
  assert.equal(attempt.signal.aborted, false, 'thoughts and tool calls keep it alive');
  await new Promise(r => setTimeout(r, 90));
  assert.equal(attempt.signal.aborted, true, 'real silence still times out');
  attempt.done();
});

// ---- Groq reasoning models ----
test('Groq: reasoning streams as thinking, usage is reported, and effort follows the budget', async () => {
  let body: any;
  const sse = [
    { choices: [{ delta: { reasoning: 'Check the schedule first. ' } }] },
    { choices: [{ delta: { content: 'Next match is at 3 PM.' } }] },
    { choices: [], usage: { total_tokens: 812 } },
  ].map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  const fetcher = (async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(sse, { status: 200 }); }) as typeof fetch;
  const thoughts: string[] = [], usage: number[] = [];
  let text = '';
  for await (const piece of groqProvider('key', 'openai/gpt-oss-20b', fetcher).stream({ system: 's', history: [], question: 'q', tools: [], signal: new AbortController().signal, maxOutputTokens: 900, thinkingBudget: 2048, onThought: t => thoughts.push(t), onUsage: n => usage.push(n) })) text += piece;
  assert.equal(text, 'Next match is at 3 PM.');
  assert.deepEqual(thoughts, ['Check the schedule first. ']);
  assert.deepEqual(usage, [812]);
  assert.equal(body.reasoning_effort, 'medium');
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.deepEqual([reasoningEffort(512), reasoningEffort(2048), reasoningEffort(8192)], ['low', 'medium', 'high']);
});

// ---- Blocks ----
test('blocks keep only shown columns and well-formed shapes', () => {
  const [table] = blocksFor('getStandings', {}, { title: 'Cup', kind: 'series records', rows: [{ team: 'A', college: 'CCS', wins: 2, losses: 0, games: '4-1', secret: 'x' }] }) as any[];
  assert.deepEqual(Object.keys(table.rows[0]), ['team', 'college', 'wins', 'losses', 'games']);
  assert.equal(blocksFor('getStandings', {}, { error: 'No tournament' }).length, 0);
  const parsed = parseBlocks([table, { kind: 'script', html: '<b>' }, { kind: 'table', columns: [{ key: 'bad key', label: 'x' }], rows: [] }, { kind: 'matches', title: 't', matches: [{ team1: 'A', team2: 'B', score: '2-1', status: 'completed', label: 'Final', when: null }] }]);
  assert.deepEqual(parsed.map(b => b.kind), ['table', 'matches']);
});

test('saved conversations keep reasoning, steps and tables, and drop malformed ones', () => {
  const store = new Map<string, string>();
  const storage: HistoryStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k) };
  const history = emptyHistory();
  const now = Date.now();
  history.threads.push({ id: 't1', title: 'Standings', createdAt: now, updatedAt: now, messages: [
    { id: 'u', sender: 'user', text: 'MLBB standings', timestamp: now, status: 'complete' },
    { id: 'a', sender: 'assistant', text: 'Crimson Wolves lead.', timestamp: now, status: 'complete', mode: 'think', steps: ['Reading standings'], thinking: 'Read the table.', thoughtMs: 1800,
      blocks: [{ kind: 'table', title: 'MLBB Open', columns: [{ key: 'team', label: 'Team' }], rows: [{ team: 'Crimson Wolves' }] }, { kind: 'bogus' } as any], cached: true },
  ] });
  saveHistory(storage, 'u1', history);
  const loaded = loadHistory(storage, 'u1').data.threads[0].messages[1];
  assert.deepEqual([loaded.mode, loaded.steps, loaded.thinking, loaded.thoughtMs, loaded.cached], ['think', ['Reading standings'], 'Read the table.', 1800, true]);
  assert.deepEqual(loaded.blocks!.map(b => b.kind), ['table']);
});

// ---- API ----
async function events(response: Response) {
  return (await response.text()).split('\n\n').filter(Boolean).map(block => [block.match(/^event: (.+)$/m)?.[1] || '', JSON.parse(block.match(/^data: (.+)$/m)?.[1] || 'null')] as [string, any]);
}
test('API: the chosen mode is used, reasoning and tables stream, and the allowance is reported', async t => {
  const usage = new MemoryUsageStore(5);
  const m = model(reasoner);
  const app = express();
  app.use('/ai', createAiRouter({ VITE_FIREBASE_PROJECT_ID: 'demo-arenahub', AI_WINDOW_TOKENS: '9000' }, { verify: async () => viewer, published: async () => data, providers: [m], rate: new MemoryRateStore(), usage, myTeams: null, chat: null }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ai`;
  const auth = { Authorization: 'Bearer token' };

  const fresh = await (await fetch(`${base}/usage`, { headers: auth })).json();
  assert.deepEqual([fresh.allowance.used, fresh.allowance.limit, fresh.allowance.resetsAt], [0, 9000, null]);

  const post = (body: object) => fetch(base, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ query: 'MLBB standings', mode: 'turbo' })).status, 400);
  const stream = await events(await post({ query: 'MLBB standings', mode: 'deep' }));
  const kinds = stream.map(([e]) => e);
  assert.ok(kinds.indexOf('thinking') < kinds.indexOf('start') && kinds.indexOf('step') < kinds.indexOf('start'));
  assert.ok(kinds.includes('block'));
  const done = stream.find(([e]) => e === 'done')![1];
  assert.equal(done.mode, 'deep');
  assert.equal(done.allowance.used, 4000);
  assert.equal(m.lastRequest?.thinkingBudget, 8192, 'Deep uses its own thinking budget');
  const after = await (await fetch(`${base}/usage`, { headers: auth })).json();
  assert.equal(after.allowance.used, 4000);
});
