import express from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { originAllowed } from './cors.ts';
import { AuthError, bearer, callerVerifier, type Caller, type VerifyCaller } from './auth.ts';
import { publishedReader, type PublishedReader } from './data.ts';
import { adminApp } from './firebaseAdmin.ts';
import { aiConfig } from './ai/config.ts';
import { askSchema, bracketSchema, chatAskSchema, FirestoreRateStore, MemoryRateStore, type RateStore } from './ai/guard.ts';
import { draftBracket } from './ai/bracketDraft.ts';
import { ChatAskError, createChatResponder, firestoreChatSink } from './ai/chat.ts';
import { createAssistant, InterruptedAnswer } from './ai/index.ts';
import type { Provider } from './ai/provider.ts';
import { geminiProvider } from './ai/gemini.ts';
import { groqProvider } from './ai/groq.ts';
import { fakeProvider } from './ai/fake.ts';
import type { ToolContext } from './ai/tools.ts';

type Env = Record<string, string | undefined>;
export interface AiDeps {
  verify?: VerifyCaller;
  published?: PublishedReader;
  providers?: Provider[];
  rate?: RateStore;
  fetcher?: typeof fetch;
  /** Live-chat responder; null disables it. Defaults to Firestore when the server has admin access. */
  chat?: ReturnType<typeof createChatResponder> | null;
}

/** Gemini first, Groq as the backup. The scripted provider replaces both on the test emulators only. */
export function configuredProviders(env: Env, fetcher: typeof fetch = fetch): Provider[] {
  const config = aiConfig(env);
  if (config.fake) return [fakeProvider()];
  return [
    ...(config.gemini ? [geminiProvider(config.gemini.key, config.gemini.model)] : []),
    ...(config.groq ? [groqProvider(config.groq.key, config.groq.model, fetcher)] : []),
  ];
}

function openReportsReader(env: Env): ToolContext['openReports'] {
  const app = adminApp(env);
  if (!app) return undefined;
  return async () => {
    const snapshot = await getFirestore(app).collection('integrityCases').where('status', 'in', ['open', 'reviewing']).limit(20).get();
    // Case ids, status, match and evidence count only. No reporter, reason text or details (plan Q5).
    return snapshot.docs.map(doc => ({
      id: doc.id, status: String(doc.get('status')), matchId: String(doc.get('matchId') || ''),
      createdAt: doc.get('createdAt')?.toDate?.().toISOString?.() || '',
      evidence: (Array.isArray(doc.get('evidenceFiles')) ? doc.get('evidenceFiles').length : 0) + (doc.get('evidenceUrl') ? 1 : 0),
    }));
  };
}

/** Provider credentials stay in this process. The browser sends a question and receives text. */
export function createAiRouter(env: Env, deps: AiDeps = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '128kb' }));
  const config = aiConfig(env);
  const verify = deps.verify || callerVerifier(env, deps.fetcher);
  const published = deps.published || publishedReader(env, { fetcher: deps.fetcher });
  const app = adminApp(env);
  const providers = deps.providers || configuredProviders(env, deps.fetcher);
  const rate = deps.rate || (app ? new FirestoreRateStore(app) : new MemoryRateStore());
  const assistant = createAssistant({ providers, config, rate, openReports: openReportsReader(env) });
  const burst = new MemoryRateStore();

  const fail = (res: express.Response, status: number, error: string) => { res.status(status).json({ error }); };
  /** Front door, before the body is read: configuration, origin and a bearer token. Returns the token. */
  function admit(req: express.Request, res: express.Response): string | null {
    if (!env.VITE_FIREBASE_PROJECT_ID) { fail(res, 503, 'The assistant is not configured on this server.'); return null; }
    // Same host, or a site listed in CORS_ORIGINS (server/cors.ts).
    if (!originAllowed(req, env)) { fail(res, 403, 'Open the assistant from ArenaHub.'); return null; }
    const token = bearer(req.get('authorization'));
    if (!token || ['local-dev-token', 'demo-token'].includes(token)) { fail(res, 401, 'Sign in to use the assistant.'); return null; }
    return token;
  }
  /** After the body is valid: the verified caller, who must be admitted and under the burst limit. */
  async function identify(res: express.Response, token: string): Promise<Caller | null> {
    try {
      const caller = await verify(token);
      if (!caller.admitted) { fail(res, 403, 'Join with a campus invite to use the assistant.'); return null; }
      if (!await burst.hit(caller.uid, config.burstPerMinute, 60)) { fail(res, 429, 'Too many questions at once. Wait a minute and try again.'); return null; }
      return caller;
    } catch (error) {
      fail(res, error instanceof AuthError ? error.status : 401, error instanceof AuthError ? error.message : 'Your account could not be verified.');
      return null;
    }
  }

  router.post('/', async (req, res) => {
    const token = admit(req, res);
    if (!token) return;
    const body = askSchema.safeParse(req.body);
    if (!body.success) { fail(res, 400, 'Invalid assistant request.'); return; }
    const caller = await identify(res, token);
    if (!caller) return;
    let data;
    try { data = await published(token); }
    catch { fail(res, 503, 'Tournament records could not be read. Try again.'); return; }

    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event: string, payload: unknown) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); };
    const controller = new AbortController();
    // The viewer pressed stop or left: stop the model call too.
    res.on('close', () => { if (!res.writableFinished) controller.abort(new Error('client closed')); });
    try {
      const result = await assistant.answer({ caller, query: body.data.query, history: body.data.history, data, signal: controller.signal }, {
        start: source => send('start', { source }),
        delta: text => send('delta', { text }),
      });
      send('done', { source: result.source, references: result.references, ...(result.limited ? { limited: true } : {}) });
    } catch (error) {
      if (!controller.signal.aborted) send('error', { message: error instanceof InterruptedAnswer ? error.message : 'The assistant could not answer. Try again.' });
    } finally { res.end(); }
  });

  // "@Arena ..." in a match's live chat. The reply is posted into the chat for every viewer.
  const chat = deps.chat !== undefined ? deps.chat : app ? createChatResponder({ providers, config, rate, sink: firestoreChatSink(app) }) : null;
  router.post('/chat', async (req, res) => {
    const token = admit(req, res);
    if (!token) return;
    const body = chatAskSchema.safeParse(req.body);
    if (!body.success) { fail(res, 400, 'Ask a question of up to 500 characters about this match.'); return; }
    // Posting as Arena AI needs firebase-admin (a service account, or the emulators).
    if (!chat) { fail(res, 503, 'Arena AI cannot reply in chat on this server. Ask on the Arena AI page instead.'); return; }
    const caller = await identify(res, token);
    if (!caller) return;
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(new Error('client closed')); });
    try {
      const data = await published(token);
      res.set('Cache-Control', 'no-store').json({ posted: true, ...(await chat({ caller, matchId: body.data.matchId, question: body.data.question, data, signal: controller.signal })) });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ChatAskError) { fail(res, error.status, error.message); return; }
      fail(res, 503, 'Arena AI could not answer in chat. Try again.');
    }
  });

  // Bracket from a prompt. Staff only; returns parameters or a clarifying question, never a bracket.
  // Any failure is a 503 so Bracket Studio switches to its offline parser.
  router.post('/bracket', async (req, res) => {
    const token = admit(req, res);
    if (!token) return;
    const body = bracketSchema.safeParse(req.body);
    if (!body.success) { fail(res, 400, 'Describe the bracket in up to 6,000 characters.'); return; }
    const caller = await identify(res, token);
    if (!caller) return;
    if (!caller.staff) { fail(res, 403, 'Only tournament staff can draft brackets.'); return; }
    if (!providers.length) { fail(res, 503, 'No model is configured; the offline parser will read the prompt.'); return; }
    if (!await rate.hit(`bracket_${caller.uid}`, config.userPerMinute, 60)) { fail(res, 429, 'Too many drafts in a minute. Wait and try again.'); return; }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(new Error('client closed')); });
    try { res.set('Cache-Control', 'no-store').json(await draftBracket(providers, body.data.prompt, controller.signal)); }
    catch { if (!controller.signal.aborted) fail(res, 503, 'The model could not read this prompt; the offline parser will.'); }
  });

  return router;
}
