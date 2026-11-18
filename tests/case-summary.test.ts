// Staff Fair play case summaries (M7, plan Q5): scrubbed digest in, Groq only, staff only.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { buildCaseDigest, scrubPersonal } from '../src/lib/caseDigest';
import { summarizeCase, type CaseRecord } from '../server/ai/caseSummary';
import { caseSummaryProvider, createAiRouter } from '../server/ai';
import { MemoryRateStore } from '../server/ai/guard';
import { AuthError, type Caller } from '../server/auth';
import type { Provider } from '../server/ai/provider';

const found: CaseRecord = {
  record: {
    matchId: 'm-1', reason: 'Suspected cheating', status: 'reviewing', evidenceUrl: 'https://youtu.be/abc123',
    details: 'At 08:42 the CCS jungler seemed to see through walls. Contact me at juan.delacruz@wmsu.edu.ph or 0917 123 4567, student ID 2021-01234. Clip: https://drive.google.com/x',
    evidenceFiles: [{ mime: 'video/mp4', name: 'juan-recording.mp4' }],
    createdAt: { seconds: 1_763_280_000 },
  },
  events: [{ action: 'reviewing', note: 'Started review. Asked reporter (uid abcdefghij1234567890) for the full replay.', createdAt: { seconds: 1_763_283_600 } }],
  matchLabel: '#M4 · DEMO CN Pulse vs DEMO CA Echo',
};

test('the digest removes emails, phone numbers, student IDs and links, and keeps the facts', () => {
  const digest = buildCaseDigest(found.record, found.events, found.matchLabel);
  for (const leak of ['juan.delacruz@wmsu.edu.ph', '0917 123 4567', '2021-01234', 'drive.google.com', 'youtu.be/abc123', 'juan-recording.mp4']) {
    assert.ok(!digest.text.includes(leak), `digest leaked ${leak}`);
  }
  assert.match(digest.text, /Match: #M4 · DEMO CN Pulse vs DEMO CA Echo/);
  assert.match(digest.text, /Evidence: Video recording \(private\); External link on youtu\.be/);
  assert.match(digest.text, /08:42 the CCS jungler/);
  assert.match(digest.text, /Review started: Started review/);
  assert.match(digest.text, /Decision: No decision recorded yet\./);
  assert.equal(scrubPersonal('call +639171234567 now'), 'call [number removed] now');
});

test('the model only ever sees the digest, and its reply is cleaned', async () => {
  let seen = '';
  const model: Provider = { id: 'mock', async *stream(request) { seen = request.question + request.system; yield 'The report says **x** happened. 🙂 Evidence is a private video.'; }, async json() { return null; } };
  const result = await summarizeCase(model, found, new AbortController().signal);
  assert.equal(result.source, 'model');
  assert.ok(!seen.includes('juan.delacruz') && !seen.includes('2021-01234') && !seen.includes('drive.google.com'));
  assert.ok(!/\p{Extended_Pictographic}/u.test(result.summary));
  const none = await summarizeCase(undefined, found, new AbortController().signal);
  assert.equal(none.source, 'digest');
  assert.equal(none.summary, none.digest.text);
});

test('case summaries use Groq only, never Gemini (plan Q5)', () => {
  assert.equal(caseSummaryProvider({ GEMINI_API_KEY: 'g' }), undefined);
  assert.equal(caseSummaryProvider({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' })?.id, 'groq');
  assert.equal(caseSummaryProvider({ VITE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'demo-arenahub', ARENA_AI_PROVIDER: 'fake' })?.id, 'fake');
});

test('the route is staff only, validates the id, and falls back to the digest when the model fails', async t => {
  const viewer = (overrides: Partial<Caller> = {}): Caller => ({ uid: 'u1', email: 'u@wmsu.edu.ph', campus: true, admitted: true, staff: false, role: '', ...overrides });
  const callers: Record<string, Caller> = { student: viewer(), staff: viewer({ uid: 's1', staff: true, role: 'organizer' }) };
  const verify = async (token?: string) => { if (!token || !callers[token]) throw new AuthError(401, 'Sign in.'); return callers[token]; };
  const broken: Provider = { id: 'groq', async *stream() { throw new Error('Groq returned 503.'); }, async json() { return null; } };
  const app = express();
  app.use('/ai', createAiRouter({ VITE_FIREBASE_PROJECT_ID: 'demo-arenahub' }, {
    verify, published: async () => ({ brackets: [], revision: 'none', checkedAt: '' }), providers: [], rate: new MemoryRateStore(),
    cases: async id => id === 'case-1' ? found : null, caseProvider: broken,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (token: string, body: unknown) => fetch(`${base}/ai/case-summary`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  assert.equal((await post('student', { caseId: 'case-1' })).status, 403);
  assert.equal((await post('staff', { caseId: '../../users' })).status, 400);
  assert.equal((await post('staff', { caseId: 'missing' })).status, 404);
  const response = await post('staff', { caseId: 'case-1' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'digest');
  assert.match(body.summary, /Concern: Suspected cheating/);
  assert.ok(!JSON.stringify(body).includes('juan.delacruz'));
});
