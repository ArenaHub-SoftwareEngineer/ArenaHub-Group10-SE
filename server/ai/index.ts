// The Arena AI pipeline, in order:
//   1. guard: refuse private-data, injection and off-topic questions before reading anything
//   2. cache: same question, same data revision, no conversation history -> same answer
//   3. live records: the deterministic engine answers factual questions it fully covers
//   4. the model with read-only tools (Gemini), then the backup model (Groq)
//   5. when no model is configured, over budget, or every model fails: the live-records answer
// Every reply is cleaned (sanitize.ts) and labelled with where it came from. No model name is shown.
import type { KnowledgeReference } from '../../src/lib/tournamentKnowledge.ts';
import { answerTournamentQuestion, knowledgeSnapshot } from '../../src/lib/tournamentKnowledge.ts';
import type { Caller } from '../auth.ts';
import type { PublishedData } from '../data.ts';
import { AnswerCache, normalizeQuestion } from './cache.ts';
import type { AiConfig } from './config.ts';
import { MemoryRateStore, screenQuestion, type RateStore } from './guard.ts';
import { assistantPrompt } from './prompt.ts';
import type { Provider } from './provider.ts';
import { cleanReply, StreamCleaner } from './sanitize.ts';
import { buildTools, type Tool, type ToolContext } from './tools.ts';

export type Source = 'Live records' | 'Arena AI' | 'Arena AI (backup model)';
export interface AnswerEvents { start(source: Source): void; delta(text: string): void }
export interface AnswerResult { source: Source; text: string; references: KnowledgeReference[]; cached?: boolean; limited?: boolean; refused?: string }
export interface AskInput { caller: Caller; query: string; history: Array<{ role: 'user' | 'assistant'; text: string }>; data: PublishedData; signal: AbortSignal }

/** A model failed after part of its answer was already shown. The partial text stays on screen. */
export class InterruptedAnswer extends Error {}

export interface AssistantDeps {
  /** Primary first, backup second. Empty when no API key is configured. */
  providers: Provider[];
  config: Pick<AiConfig, 'userPerMinute' | 'globalPerMinute'>;
  /** Per-user model budget: Firestore when the server has admin access. */
  rate: RateStore;
  /** Whole-server model budget for this instance. */
  globalRate?: RateStore;
  openReports?: ToolContext['openReports'];
  cache?: AnswerCache<AnswerResult>;
  now?: () => Date;
  log?: (message: string) => void;
}

const MAX_REPLY = 2400;
const sourceOf = (provider: Provider, index: number): Source => index > 0 || provider.id === 'groq' ? 'Arena AI (backup model)' : 'Arena AI';

export function createAssistant(deps: AssistantDeps) {
  const cache = deps.cache || new AnswerCache<AnswerResult>(60_000);
  const globalRate = deps.globalRate || new MemoryRateStore();
  const now = deps.now || (() => new Date());
  const log = deps.log || ((message: string) => console.warn(`[Arena AI] ${message}`));

  const emit = (events: AnswerEvents, result: AnswerResult) => { events.start(result.source); events.delta(result.text); return result; };

  async function answer(input: AskInput, events: AnswerEvents): Promise<AnswerResult> {
    const screen = screenQuestion(input.query);
    if (screen.kind === 'refuse') return emit(events, { source: 'Arena AI', text: screen.text, references: [], refused: screen.reason });

    const history = input.history.slice(-12);
    const key = `${input.caller.staff ? 'staff' : 'viewer'}|${input.data.revision}|${normalizeQuestion(input.query)}`;
    const cacheable = history.length === 0;
    const hit = cacheable ? cache.get(key) : undefined;
    if (hit) return emit(events, { ...hit, cached: true });

    const snapshot = knowledgeSnapshot(input.data.brackets, 0, input.data.checkedAt);
    const records = answerTournamentQuestion(snapshot, input.query, history);
    const recordsAnswer = (limited = false): AnswerResult => ({ source: 'Live records', text: cleanReply(records.text, MAX_REPLY), references: records.references, ...(limited ? { limited } : {}) });
    const remember = (result: AnswerResult) => { if (cacheable) cache.set(key, result); return result; };

    if (!records.needsModel || !deps.providers.length) return emit(events, remember(recordsAnswer()));

    const allowed = await deps.rate.hit(`user_${input.caller.uid}`, deps.config.userPerMinute, 60)
      && await globalRate.hit('global', deps.config.globalPerMinute, 60);
    if (!allowed) return emit(events, recordsAnswer(true));

    const references: KnowledgeReference[] = [];
    const tools: Tool[] = buildTools({ brackets: input.data.brackets, checkedAt: input.data.checkedAt, staff: input.caller.staff, openReports: deps.openReports })
      .map(tool => ({ ...tool, run: async args => {
        const result = await tool.run(args);
        for (const r of result.references) if (references.length < 12 && !references.some(x => x.bracketId === r.bracketId && x.matchId === r.matchId)) references.push(r);
        return result;
      } }));

    for (const [index, provider] of deps.providers.entries()) {
      const cleaner = new StreamCleaner(MAX_REPLY);
      let text = '', started = false;
      const source = sourceOf(provider, index);
      const out = (piece: string) => {
        if (!piece) return;
        if (!started) { events.start(source); started = true; }
        text += piece; events.delta(piece);
      };
      try {
        for await (const delta of provider.stream({ system: assistantPrompt(now(), input.caller.staff), history, question: input.query, tools, signal: input.signal, maxOutputTokens: 900 })) {
          out(cleaner.push(delta));
          if (cleaner.length >= MAX_REPLY) break;
        }
        out(cleaner.flush());
        if (!text.trim()) throw new Error('empty reply');
        // Exactly what was streamed, so a cached replay matches what the first viewer saw.
        return remember({ source, text, references: [...references] });
      } catch (error) {
        if (input.signal.aborted) throw error;
        log(`${provider.id} failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`);
        if (started) throw new InterruptedAnswer('The answer stopped partway. Try again.');
        references.length = 0;
      }
    }
    return emit(events, recordsAnswer());
  }

  return { answer };
}
