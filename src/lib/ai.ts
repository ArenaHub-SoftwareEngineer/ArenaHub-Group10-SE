/**
 * Arena AI in the browser.
 *
 * Questions stream from the server (server/ai.ts), which reads the published records itself; the
 * browser never sends tournament context and never holds a provider key. When the server cannot be
 * reached, the same live-records engine and the same refusals run on this device, using the brackets
 * that are already loaded.
 *
 * Bracket drafts: the server model reads the prompt when it can, the offline parser otherwise. Either
 * way the organizer sees the parsed parameters, or a clarifying question, before anything is built.
 */
import { auth } from './firebase';
import { apiUrl } from './apiBase';
import { firestoreService } from './firestore';
import type { BracketDraft } from './types';
import { createBracketFromTeams } from './bracketUtils';
import { answerTournamentQuestion, knowledgeSnapshot, type KnowledgeReference } from './tournamentKnowledge';
import { screenQuestion } from './aiGuard';
import { parseBracketPromptLocally, resolveBracketRequest, type BracketRequest, type Resolution } from './bracketRequest';
import { parseSse } from './sse';

export interface StreamChunk {
  delta: string;
  done: boolean;
  source?: string;
  references?: KnowledgeReference[];
}
export type DraftResolution = Resolution & { source: string };

export const OFFLINE_SOURCE = 'Live records (this device)';
export const OFFLINE_DRAFT_SOURCE = 'Rules engine (offline)';
type History = Array<{ role: 'user' | 'assistant'; text: string }>;

async function idToken() {
  try { return auth.currentUser ? await auth.currentUser.getIdToken() : null; } catch { return null; }
}
const withTimeout = (ms: number, signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

class AIService {
  /** On-device answer from the loaded brackets. Same engine and refusals as the server. */
  localAnswer(query: string, history: History = []) {
    const screen = screenQuestion(query);
    if (screen.kind === 'refuse') return { text: screen.text, references: [] as KnowledgeReference[] };
    const snapshot = knowledgeSnapshot(firestoreService.getPublishedBrackets(), 0, new Date().toISOString(), 'loaded');
    const answer = answerTournamentQuestion(snapshot, query, history);
    return { text: answer.text, references: answer.references };
  }

  /**
   * Streams one answer. Throws when stopped, or when the server's answer broke off partway
   * (the caller keeps the text it already has and offers a retry).
   */
  public async *streamAnswer(query: string, history: History = [], signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const stopped = () => { if (signal?.aborted) throw new Error('Response stopped.'); };
    const token = await idToken();
    if (token) {
      let response: Response | undefined;
      try {
        response = await fetch(apiUrl('/api/ai'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ query, history }),
          signal: withTimeout(90_000, signal),
        });
      } catch { stopped(); }
      if (response?.ok && response.body) {
        let source: string | undefined, wrote = false;
        for await (const { event, data } of parseSse(response.body)) {
          if (event === 'start') source = data?.source;
          else if (event === 'delta' && typeof data?.text === 'string') { wrote = true; yield { delta: data.text, done: false, source }; }
          else if (event === 'done') { yield { delta: '', done: true, source: data?.source || source, references: Array.isArray(data?.references) ? data.references : [] }; return; }
          else if (event === 'error') throw new Error(data?.message || 'The answer stopped partway.');
        }
        stopped();
        if (wrote) throw new Error('The answer stopped partway.');
      } else if (response && [401, 403, 429].includes(response.status)) {
        // Signed out, not admitted, or too many questions: say why instead of answering offline.
        const message = (await response.json().catch(() => null))?.error;
        if (typeof message === 'string') { yield { delta: message, done: true, source: 'Arena AI' }; return; }
      }
    }
    stopped();
    const local = this.localAnswer(query, history);
    yield { delta: local.text, done: true, source: OFFLINE_SOURCE, references: local.references };
  }

  /** Reads a bracket prompt into parameters or a clarifying question. Never builds the bracket. */
  public async readBracketPrompt(prompt: string, signal?: AbortSignal): Promise<DraftResolution> {
    const token = await idToken();
    if (token) {
      try {
        const response = await fetch(apiUrl('/api/ai/bracket'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ prompt }),
          signal: withTimeout(45_000, signal),
        });
        const body = response.ok ? await response.json() : null;
        if (body && ['ready', 'question', 'battle-royale'].includes(body.kind)) return body as DraftResolution;
      } catch {
        if (signal?.aborted) throw new Error('Stopped.');
      }
    }
    return { ...resolveBracketRequest(prompt, parseBracketPromptLocally(prompt)), source: OFFLINE_DRAFT_SOURCE };
  }

  /** Builds the confirmed request. Only called after the organizer has seen the parameters. */
  public buildBracket(request: BracketRequest, prompt = ''): BracketDraft {
    const draft = createBracketFromTeams({
      title: request.title, teams: request.teams, gameName: request.game, format: request.format,
      matchFormat: request.matchFormat, finalMatchFormat: request.finalMatchFormat,
      seedingRule: request.seeding, explicitBracketSize: request.teamsCount,
    });
    return { ...draft, rawPrompt: prompt.slice(0, 6000) };
  }
}

export const aiService = new AIService();
