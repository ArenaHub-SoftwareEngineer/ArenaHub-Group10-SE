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
import { teamNameKey } from './teamNames';
import { answerTournamentQuestion, knowledgeSnapshot, type KnowledgeReference } from './tournamentKnowledge';
import { screenQuestion } from './aiGuard';
import { parseBracketPromptLocally, readTeamNameRequest, resolveBracketRequest, type BracketRequest, type Resolution } from './bracketRequest';
import { parseSse } from './sse';
import { parseBlocks, type AnswerBlock } from './aiBlocks';
import type { AiMode } from './chatHistory';

export interface StreamChunk {
  delta: string;
  done: boolean;
  source?: string;
  references?: KnowledgeReference[];
  /** delta replaces everything received so far instead of being appended. */
  replace?: boolean;
  /** A lookup the assistant is making ("Reading MLBB standings"). */
  step?: string;
  /** More of the model's reasoning summary. */
  thinking?: string;
  /** A table or match cards built from the records. */
  block?: AnswerBlock;
  /** Sent with done. */
  meta?: { mode?: AiMode; cached?: boolean; limited?: boolean; allowanceUsed?: boolean; thoughtMs?: number; allowance?: Allowance };
}

/** The asker's Arena AI allowance (tokens per window), as the server reports it. */
export interface Allowance { used: number; limit: number; windowHours: number; startedAt: number | null; resetsAt: number | null; exhausted: boolean }
export interface ModeInfo { id: AiMode; name: string; summary: string }
export const AI_MODES: ModeInfo[] = [
  { id: 'quick', name: 'Quick', summary: 'Instant answers from the live records. Uses the least of your allowance.' },
  { id: 'think', name: 'Think', summary: 'Reasons through your question and checks the records first. Best for most questions.' },
  { id: 'deep', name: 'Deep', summary: 'Longest reasoning, for comparisons and “why” questions. Uses more of your allowance.' },
];
const allowanceOf = (raw: any): Allowance | undefined => raw && Number.isFinite(raw.used) && Number.isFinite(raw.limit) && raw.limit > 0
  ? { used: raw.used, limit: raw.limit, windowHours: Number(raw.windowHours) || 5, startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : null, resetsAt: Number.isFinite(raw.resetsAt) ? raw.resetsAt : null, exhausted: raw.exhausted === true }
  : undefined;
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
  private readonly lastDraws = new Map<string, string[]>();

  /** On-device answer from the loaded brackets. Same engine and refusals as the server. */
  localAnswer(query: string, history: History = [], focus?: AskFocus | null) {
    const screen = screenQuestion(query);
    if (screen.kind === 'refuse') return { text: screen.text, references: [] as KnowledgeReference[], steps: [] as string[] };
    const snapshot = knowledgeSnapshot(firestoreService.getPublishedBrackets(), 0, new Date().toISOString(), 'loaded');
    const answer = answerTournamentQuestion(snapshot, query, history, focus ? { bracketId: focus.bracketId, ...(focus.matchId ? { matchId: focus.matchId } : {}) } : null);
    return { text: answer.text, references: answer.references, steps: answer.steps || [] };
  }

  /**
   * Streams one answer. Throws when stopped, or when the server's answer broke off partway
   * (the caller keeps the text it already has and offers a retry).
   */
  /** The signed-in person's allowance, or null when the server cannot be reached or nobody is signed in. */
  public async getAllowance(signal?: AbortSignal): Promise<Allowance | null> {
    const token = await idToken();
    if (!token) return null;
    try {
      const response = await fetch(apiUrl('/api/ai/usage'), { headers: { Authorization: `Bearer ${token}` }, signal: withTimeout(10_000, signal) });
      return response.ok ? allowanceOf((await response.json())?.allowance) ?? null : null;
    } catch { return null; }
  }

  public async *streamAnswer(query: string, history: History = [], signal?: AbortSignal, focus?: AskFocus | null, mode: AiMode = 'think'): AsyncGenerator<StreamChunk> {
    const stopped = () => { if (signal?.aborted) throw new Error('Response stopped.'); };
    const token = await idToken();
    if (token) {
      let response: Response | undefined;
      try {
        response = await fetch(apiUrl('/api/ai'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ query, history, mode, ...(focus ? { focus: { bracketId: focus.bracketId, ...(focus.matchId ? { matchId: focus.matchId } : {}) } } : {}) }),
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
          else if (event === 'step' && typeof data?.label === 'string') yield { delta: '', done: false, source, step: data.label.slice(0, 120) };
          else if (event === 'thinking' && typeof data?.text === 'string') yield { delta: '', done: false, source, thinking: data.text };
          else if (event === 'block') { const [block] = parseBlocks([data?.block]); if (block) yield { delta: '', done: false, source, block }; }
          else if (event === 'done') {
            const mode = ['quick', 'think', 'deep'].includes(data?.mode) ? data.mode as AiMode : undefined;
            yield { delta: '', done: true, source: data?.source || source, references: Array.isArray(data?.references) ? data.references : [],
              meta: { mode, cached: data?.cached === true, limited: data?.limited === true, allowanceUsed: data?.allowanceUsed === true,
                ...(Number.isFinite(data?.thoughtMs) ? { thoughtMs: data.thoughtMs } : {}), ...(allowanceOf(data?.allowance) ? { allowance: allowanceOf(data.allowance) } : {}) } };
            return;
          }
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
    // Think and Deep say why no model answered and show how the question was read, instead of an unexplained instant reply.
    if (mode !== 'quick') for (const step of ['Arena AI’s server could not be reached, so this answer comes from the records loaded on this device', ...local.steps]) yield { delta: '', done: false, source: OFFLINE_SOURCE, step };
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
    const generation = readTeamNameRequest(prompt);
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
        if (body?.kind === 'ready') {
          // Older APIs could return instruction lines as teams for a naming prompt.
          if (!generation || body.request?.generatedNames === true) return body as DraftResolution;
        } else if (body?.kind === 'question' || body?.kind === 'battle-royale') {
          return body as DraftResolution;
        }
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
    const drawKey = request.seeding === 'Random draw' && !request.openingMatches?.length
      ? JSON.stringify([request.game, request.format, request.teamsCount, request.teams.map(team => teamNameKey(team.name)).sort()])
      : null;
    const draft = createBracketFromTeams({
      title: request.title, teams: request.teams, gameName: request.game, format: request.format,
      matchFormat: request.matchFormat, finalMatchFormat: request.finalMatchFormat,
      seedingRule: request.seeding, explicitBracketSize: request.teamsCount,
      openingMatches: request.openingMatches,
      previousDraw: drawKey ? this.lastDraws.get(drawKey) : undefined,
    });
    if (drawKey) this.lastDraws.set(drawKey, draft.teams.map(team => team.name));
    const badges = Object.fromEntries(draft.matches.flatMap(match => [match.team1, match.team2]).flatMap(team => {
      const style = team && request.teamStyles?.[team.name.toLowerCase()];
      return team && style && !team.isBye ? [[team.id, style]] : [];
    }));
    const appearance = request.appearance || Object.keys(badges).length
      ? { ...request.appearance, ...(Object.keys(badges).length && { teams: badges }) }
      : undefined;
    return { ...draft, ...(appearance && { appearance }), rawPrompt: prompt.slice(0, 6000) };
  }
}

export const aiService = new AIService();
