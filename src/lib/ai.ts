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
  /** delta replaces everything received so far instead of being appended. */
  replace?: boolean;
}
export type DraftResolution = Resolution & { source: string };
/** What the viewer was looking at before opening Arena AI. The label is shown; only the ids are sent. */
export interface AskFocus { bracketId: string; matchId?: string; label: string }

export const OFFLINE_SOURCE = 'Live records (this device)';
export const OFFLINE_DRAFT_SOURCE = 'Rules engine (offline)';
type History = Array<{ role: 'user' | 'assistant'; text: string }>;

async function idToken() {
  try { return auth.currentUser ? await auth.currentUser.getIdToken() : null; } catch { return null; }
}
const withTimeout = (ms: number, signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

class AIService {
  /** On-device answer from the loaded brackets. Same engine and refusals as the server. */
  localAnswer(query: string, history: History = [], focus?: AskFocus | null) {
    const screen = screenQuestion(query);
    if (screen.kind === 'refuse') return { text: screen.text, references: [] as KnowledgeReference[] };
    const snapshot = knowledgeSnapshot(firestoreService.getPublishedBrackets(), 0, new Date().toISOString(), 'loaded');
    const answer = answerTournamentQuestion(snapshot, query, history, focus ? { bracketId: focus.bracketId, ...(focus.matchId ? { matchId: focus.matchId } : {}) } : null);
    return { text: answer.text, references: answer.references };
  }

  /**
   * Streams one answer. Throws when stopped, or when the server's answer broke off partway
   * (the caller keeps the text it already has and offers a retry).
   */
  public async *streamAnswer(query: string, history: History = [], signal?: AbortSignal, focus?: AskFocus | null): AsyncGenerator<StreamChunk> {
    const stopped = () => { if (signal?.aborted) throw new Error('Response stopped.'); };
    const token = await idToken();
    if (token) {
      let response: Response | undefined;
      try {
        response = await fetch(apiUrl('/api/ai'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ query, history, ...(focus ? { focus: { bracketId: focus.bracketId, ...(focus.matchId ? { matchId: focus.matchId } : {}) } } : {}) }),
          signal: withTimeout(90_000, signal),
        });
      } catch { stopped(); }
      if (response?.ok && response.body) {
        let source: string | undefined, wrote = false;
        for await (const { event, data } of parseSse(response.body)) {
          if (event === 'start') source = data?.source;
          else if (event === 'delta' && typeof data?.text === 'string') { wrote = true; yield { delta: data.text, done: false, source }; }
          // The server withdrew what it had sent (a sentence failed its fact check) and sends the records answer.
          else if (event === 'replace' && typeof data?.text === 'string') { source = data.source || source; yield { delta: data.text, done: false, source, replace: true }; }
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
    const local = this.localAnswer(query, history, focus);
    yield { delta: local.text, done: true, source: OFFLINE_SOURCE, references: local.references };
  }

  /**
   * Asks Arena AI a question in a match's live chat. The server posts the reply into the chat itself,
   * so every viewer sees it; this only reports whether it will. Never answers on the device: an
   * offline answer would be visible to the asker alone.
   */
  public async askInChat(matchId: string, question: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const token = await idToken();
    if (!token) return { ok: false, message: 'Sign in with your campus account to ask Arena AI.' };
    try {
      const response = await fetch(apiUrl('/api/ai/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ matchId, question }),
        signal: AbortSignal.timeout(45_000),
      });
      if (response.ok) return { ok: true };
      const message = (await response.json().catch(() => null))?.error;
      return { ok: false, message: typeof message === 'string' ? message : 'Arena AI could not answer in chat right now.' };
    } catch {
      return { ok: false, message: 'Arena AI could not be reached. Check your connection.' };
    }
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

  /**
   * Staff only: a short written summary of a Fair play case, by the Groq model when the server has one
   * (plan Q5: never the free Gemini tier), otherwise the server's case digest. The server reads the case
   * itself; only its id is sent. Errors come back as a message so the caller can show the local digest.
   */
  public async summarizeCase(caseId: string, signal?: AbortSignal): Promise<{ ok: true; summary: string; source: 'model' | 'digest' } | { ok: false; message: string }> {
    const token = await idToken();
    if (!token) return { ok: false, message: 'Sign in again to summarize this case.' };
    try {
      const response = await fetch(apiUrl('/api/ai/case-summary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ caseId }),
        signal: withTimeout(45_000, signal),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && typeof body?.summary === 'string') return { ok: true, summary: body.summary, source: body.source === 'model' ? 'model' : 'digest' };
      return { ok: false, message: typeof body?.error === 'string' ? body.error : 'The summary service could not answer.' };
    } catch {
      if (signal?.aborted) return { ok: false, message: 'Stopped.' };
      return { ok: false, message: 'The summary service could not be reached.' };
    }
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
