// The Arena AI pipeline, in order:
//   1. guard: refuse private-data, injection and off-topic questions before reading anything
//   2. cache: same question, mode and data revision, no conversation history -> same answer (free)
//   3. Quick mode only: the deterministic live-records engine answers factual questions it fully covers.
//      Think and Deep always reason with a model first, showing its steps and its thought summary.
//   4. allowance: tokens per person per window (usage.ts); when it is used up, the live records answer
//   5. the model with read-only tools (Gemini), then the backup model (Groq)
//   6. when no model is configured, over budget, or every model fails: the live-records answer
// Every reply is cleaned (sanitize.ts) and labelled with where it came from. No model name is shown.
import type { KnowledgeFocus, KnowledgeReference } from '../../src/lib/tournamentKnowledge.ts';
import { answerTournamentQuestion, knowledgeSnapshot, LEADERBOARD_QUESTION } from '../../src/lib/tournamentKnowledge.ts';
import type { Caller } from '../auth.ts';
import type { PublishedData } from '../data.ts';
import { AnswerCache, normalizeQuestion } from './cache.ts';
import type { AiConfig, AiMode } from './config.ts';
import { MemoryRateStore, screenQuestion, type RateStore } from './guard.ts';
import { assistantPrompt } from './prompt.ts';
import { attemptSignal, sharedCooldown, type Cooldown, type Provider } from './provider.ts';
import { groundingFacts, SentenceGate, UngroundedSentence } from './grounding.ts';
import { cleanReply, cleanText, StreamCleaner } from './sanitize.ts';
import { buildTools, type Tool, type ToolContext } from './tools.ts';
import { scheduleMatches } from '../../src/lib/formats/placement.ts';
import { myTeamAnswer, personalQuestion, type MyTeamsReader } from './myTeam.ts';
import { leaderboardAnswer, leaderboardSort } from './leaderboard.ts';
import { blocksFor, stepLabel } from './blocks.ts';
import { parseBlocks, MAX_BLOCKS, type AnswerBlock } from '../../src/lib/aiBlocks.ts';
import { allowanceOf, type Allowance, type UsagePolicy, type UsageStore } from './usage.ts';

export type Source = 'Live records' | 'Arena AI' | 'Arena AI (backup model)';
export interface AnswerEvents {
  start(source: Source): void;
  delta(text: string): void;
  /** Discard what was shown and show this instead (a later sentence failed the fact check). */
  replace?(source: Source, text: string): void;
  /** A lookup the assistant is making, in plain words ("Reading MLBB standings"). */
  step?(label: string): void;
  /** Part of the model's own reasoning summary, as the API returns it. Not fact-checked; shown as reasoning. */
  thinking?(text: string): void;
  /** A table or match cards built from the records a tool read. Sent after the answer text. */
  block?(block: AnswerBlock): void;
}
export interface AnswerResult {
  source: Source; text: string; references: KnowledgeReference[];
  cached?: boolean; limited?: boolean; refused?: string; replaced?: boolean;
  mode?: AiMode; steps?: string[]; thinking?: string; blocks?: AnswerBlock[];
  /** Milliseconds from the question to the first answer text. */
  thoughtMs?: number;
  /** Model tokens this answer used (0 for records, refusals and reused answers). */
  tokens?: number;
  /** The asker's allowance after this answer. Absent when no allowance is configured. */
  allowance?: Allowance;
  /** The allowance was used up, so the live records answered instead of a model. */
  allowanceUsed?: boolean;
}
export interface AskInput { caller: Caller; query: string; history: Array<{ role: 'user' | 'assistant'; text: string }>; data: PublishedData; signal: AbortSignal; focus?: KnowledgeFocus; mode?: AiMode }

/** A model failed after part of its answer was already shown. The partial text stays on screen. */
export class InterruptedAnswer extends Error {}

export interface ModeSetup {
  providers: Provider[];
  thinkingBudget: number;
  recordsFirst: boolean;
  /** Silence allowed before a model is abandoned. Thinking modes get longer. */
  firstTokenMs?: number;
}

export interface AssistantDeps {
  /** Primary first, backup second. Empty when no API key is configured. Used for any mode without its own setup. */
  providers: Provider[];
  /** Per-mode models and thinking. A mode not listed uses `providers` without thinking, records first. */
  modes?: Partial<Record<AiMode, ModeSetup>>;
  /** Tokens per person per window. Absent: no allowance is enforced (tests, local development). */
  usage?: { store: UsageStore; policy: UsagePolicy };
  config: Pick<AiConfig, 'userPerMinute' | 'globalPerMinute'> & Partial<Pick<AiConfig, 'firstTokenMs'>>;
  /** Per-user model budget: Firestore when the server has admin access. */
  rate: RateStore;
  /** Whole-server model budget for this instance. */
  globalRate?: RateStore;
  openReports?: ToolContext['openReports'];
  /** The asker's own teams (captain or on the roster). Present when the server has admin access. */
  myTeams?: MyTeamsReader;
  /** Models benched after a quota error or a timeout. Defaults to the process-wide one. */
  cooldown?: Cooldown;
  cache?: AnswerCache<AnswerResult>;
  now?: () => Date;
  log?: (message: string) => void;
}

const MAX_REPLY = 2400;
const MAX_THINKING = 6000;
const sourceOf = (provider: Provider, index: number): Source => index > 0 || provider.id === 'groq' ? 'Arena AI (backup model)' : 'Arena AI';
/** Lists of tournaments or a whole bracket are lookups on the way to an answer; a specific table beats them. */
const GENERAL = new Set(['listTournaments', 'getBracket']);
const errorText = (error: unknown) => error instanceof Error ? error.message.slice(0, 200) : 'unknown error';

export function createAssistant(deps: AssistantDeps) {
  const cache = deps.cache || new AnswerCache<AnswerResult>(60_000);
  const globalRate = deps.globalRate || new MemoryRateStore();
  const cooldown = deps.cooldown || sharedCooldown;
  const now = deps.now || (() => new Date());
  const log = deps.log || ((message: string) => console.warn(`[Arena AI] ${message}`));
  const setupFor = (mode: AiMode): ModeSetup => deps.modes?.[mode] || { providers: deps.providers, thinkingBudget: 0, recordsFirst: true };

  /** The asker's allowance right now, or undefined when none is configured or the store cannot be read. */
  async function allowanceFor(caller: Caller): Promise<Allowance | undefined> {
    if (!deps.usage) return undefined;
    try { return allowanceOf(await deps.usage.store.read(caller.uid), deps.usage.policy, caller.staff, now().getTime()); }
    catch (error) { log(`allowance read failed: ${errorText(error)}`); return undefined; }
  }
  async function charge(caller: Caller, tokens: number, startedAt: number): Promise<Allowance | undefined> {
    if (!deps.usage) return undefined;
    try { return allowanceOf(await deps.usage.store.add(caller.uid, Math.max(1, Math.round(tokens)), startedAt), deps.usage.policy, caller.staff, now().getTime()); }
    catch (error) { log(`allowance charge failed: ${errorText(error)}`); return undefined; }
  }

  /** Sends a finished result: what the assistant did, its reasoning, the text, then the blocks. */
  const emit = (events: AnswerEvents, result: AnswerResult) => {
    for (const step of result.steps || []) events.step?.(step);
    if (result.thinking) events.thinking?.(result.thinking);
    events.start(result.source); events.delta(result.text);
    for (const block of result.blocks || []) events.block?.(block);
    return result;
  };

  async function answer(input: AskInput, events: AnswerEvents): Promise<AnswerResult> {
    const startedAt = now().getTime();
    const modeName: AiMode = input.mode || 'think';
    const mode = setupFor(modeName);
    const screen = screenQuestion(input.query);
    if (screen.kind === 'refuse') return emit(events, { source: 'Arena AI', text: screen.text, references: [], refused: screen.reason, mode: modeName });

    // "When is our next match?" is about the asker's own team: answered from the records, never cached.
    if (deps.myTeams && personalQuestion(input.query)) {
      const teams = await deps.myTeams(input.caller, input.data.brackets.map(b => b.id)).catch(error => { log(`my-team lookup failed: ${errorText(error)}`); return null; });
      if (teams) {
        const mine = myTeamAnswer(teams, input.data.brackets, input.data.checkedAt);
        return emit(events, { source: 'Live records', text: cleanReply(mine.text, MAX_REPLY), references: mine.references, mode: modeName, steps: ['Looking up your team’s registration and schedule'] });
      }
    }

    const history = input.history.slice(-12);
    // Only a focus that exists in the records counts; anything else is ignored.
    const focusBracket = input.focus && input.data.brackets.find(b => b.id === input.focus!.bracketId);
    const focusMatch = focusBracket && input.focus!.matchId ? scheduleMatches(focusBracket).find(m => m.id === input.focus!.matchId) : undefined;
    const focus: KnowledgeFocus | undefined = focusBracket ? { bracketId: focusBracket.id, ...(focusMatch ? { matchId: focusMatch.id } : {}) } : undefined;
    const key = `${modeName}|${input.caller.staff ? 'staff' : 'viewer'}|${input.data.revision}|${focus ? `${focus.bracketId}/${focus.matchId || ''}` : ''}|${normalizeQuestion(input.query)}`;
    const cacheable = history.length === 0;
    const hit = cacheable ? cache.get(key) : undefined;
    // A reused answer costs nothing: the records have not changed since it was written.
    if (hit) return emit(events, { ...hit, cached: true, tokens: 0, allowance: await allowanceFor(input.caller) });

    const toolContext: ToolContext = { brackets: input.data.brackets, archived: input.data.archived, checkedAt: input.data.checkedAt, staff: input.caller.staff, openReports: deps.openReports };
    const snapshot = knowledgeSnapshot(input.data.brackets, 0, input.data.checkedAt);
    const leaderboard = LEADERBOARD_QUESTION.test(input.query);
    const records = leaderboard
      // The records answer here needs per-game stats and past events, which the snapshot leaves out.
      ? { ...leaderboardAnswer(input.data.brackets, input.data.archived || [], input.query), kind: 'records' as const, needsModel: true }
      : answerTournamentQuestion(snapshot, input.query, history, focus);
    /** The leaderboard table for a records answer to a leaderboard question; other records answers have none. */
    const recordBlocks = async (): Promise<AnswerBlock[]> => {
      if (!leaderboard) return [];
      const q = input.query;
      const game = /\bmlbb\b|mobile legends/i.test(q) ? 'mlbb' : /\bdota/i.test(q) ? 'dota2' : /\bcodm\b|call of duty/i.test(q) ? (/battle royale|\bbr\b/i.test(q) ? 'codm-br' : 'codm-mp') : undefined;
      const args = { ...(game ? { game } : {}), sort: leaderboardSort(q) };
      const tool = buildTools(toolContext).find(t => t.name === 'getPlayerLeaderboard')!;
      return parseBlocks(blocksFor('getPlayerLeaderboard', args, (await tool.run(args)).data));
    };
    const recordsAnswer = async (extra: Partial<AnswerResult> = {}): Promise<AnswerResult> => ({
      source: 'Live records', text: cleanReply(records.text, MAX_REPLY), references: records.references, mode: modeName, blocks: await recordBlocks(), ...extra,
    });
    // The allowance belongs to the asker, so it is never part of a cached answer.
    const remember = (result: AnswerResult) => { if (cacheable) { const { allowance: _mine, ...shared } = result; cache.set(key, shared); } return result; };

    if ((mode.recordsFirst && !records.needsModel) || !mode.providers.length) return emit(events, remember(await recordsAnswer({ allowance: await allowanceFor(input.caller) })));

    const before = await allowanceFor(input.caller);
    if (before?.exhausted) return emit(events, await recordsAnswer({ limited: true, allowanceUsed: true, allowance: before }));

    const allowed = await deps.rate.hit(`user_${input.caller.uid}`, deps.config.userPerMinute, 60)
      && await globalRate.hit('global', deps.config.globalPerMinute, 60);
    if (!allowed) return emit(events, await recordsAnswer({ limited: true, allowance: before }));

    const references: KnowledgeReference[] = [];
    const steps: string[] = [];
    const found: Array<{ tool: string; block: AnswerBlock }> = [];
    let thinking = '';
    let attemptAlive = () => {};
    const tools: Tool[] = buildTools(toolContext)
      .map(tool => ({ ...tool, run: async args => {
        const label = stepLabel(tool.name, args);
        if (steps.at(-1) !== label) { steps.push(label); events.step?.(label); }
        attemptAlive();
        const result = await tool.run(args);
        for (const r of result.references) if (references.length < 12 && !references.some(x => x.bracketId === r.bracketId && x.matchId === r.matchId)) references.push(r);
        for (const block of parseBlocks(blocksFor(tool.name, args, result.data))) if (!found.some(f => JSON.stringify(f.block) === JSON.stringify(block))) found.push({ tool: tool.name, block });
        return result;
      } }));
    /** The most specific tables and cards (a whole bracket or tournament list only when nothing narrower was read). */
    const chosenBlocks = () => {
      const specific = found.filter(f => !GENERAL.has(f.tool));
      return (specific.length ? specific : found).slice(-MAX_BLOCKS).map(f => f.block);
    };

    const facts = groundingFacts([...input.data.brackets, ...(input.data.archived || [])]);
    for (const [index, provider] of mode.providers.entries()) {
      if (cooldown.active(provider)) continue;
      const cleaner = new StreamCleaner(MAX_REPLY);
      // Model text reaches the viewer one checked sentence at a time.
      const gate = new SentenceGate(facts);
      const attempt = attemptSignal(input.signal, mode.firstTokenMs ?? deps.config.firstTokenMs ?? 12_000);
      attemptAlive = attempt.alive;
      let text = '', started = false, tokens = 0, thoughtMs: number | undefined;
      const source = sourceOf(provider, index);
      const out = (piece: string) => {
        if (!piece) return;
        if (!started) { thoughtMs = now().getTime() - startedAt; events.start(source); started = true; }
        text += piece; events.delta(piece);
      };
      try {
        for await (const delta of provider.stream({
          system: assistantPrompt(now(), input.caller.staff, focusBracket ? { tournament: focusBracket.title, tournamentId: focusBracket.id, ...(focusMatch ? { match: focusMatch.lobby ? focusMatch.roundName : `${focusMatch.team1?.name || 'To be decided'} vs ${focusMatch.team2?.name || 'To be decided'}`, matchId: focusMatch.id } : {}) } : undefined),
          history, question: input.query, tools, signal: attempt.signal, maxOutputTokens: 900, thinkingBudget: mode.thinkingBudget,
          onThought: piece => {
            attempt.alive();
            const clean = cleanText(piece);
            if (!clean || thinking.length >= MAX_THINKING) return;
            const room = clean.slice(0, MAX_THINKING - thinking.length);
            thinking += room; events.thinking?.(room);
          },
          onUsage: count => { tokens += count; attempt.alive(); },
        })) {
          const clean = cleaner.push(delta);
          if (clean) { attempt.gotText(); out(gate.push(clean)); }
          if (cleaner.length >= MAX_REPLY) break;
        }
        out(gate.push(cleaner.flush()));
        out(gate.flush());
        if (!text.trim()) throw new Error('empty reply');
        const blocks = chosenBlocks();
        for (const block of blocks) events.block?.(block);
        // A provider that reports no usage is charged by length (about four characters per token, plus the prompt).
        const used = tokens || Math.ceil((text.length + thinking.length + 4000) / 4);
        const allowance = await charge(input.caller, used, startedAt);
        // Exactly what was streamed, so a cached replay matches what the first viewer saw.
        return remember({ source, text, references: [...references], mode: modeName, steps: [...steps], ...(thinking ? { thinking } : {}), blocks, thoughtMs, tokens: used, ...(allowance ? { allowance } : {}) });
      } catch (error) {
        if (input.signal.aborted) throw error;
        const benched = cooldown.failed(provider, error);
        log(`${provider.id} ${provider.model || ''} failed${benched ? ` (skipped for ${benched / 1000} s)` : ''}: ${errorText(error)}`);
        if (error instanceof UngroundedSentence && started) {
          // Part of the answer is on screen, the next sentence is not supported: show the records instead.
          // The tables the lookups built are records too, so they stay.
          const result = await recordsAnswer({ steps: [...steps], allowance: before, ...(found.length ? { blocks: chosenBlocks() } : {}) });
          if (events.replace) { events.replace(result.source, result.text); for (const block of result.blocks || []) events.block?.(block); return { ...result, replaced: true }; }
          throw new InterruptedAnswer('The answer stopped because part of it could not be confirmed. Try again.');
        }
        if (started) throw new InterruptedAnswer('The answer stopped partway. Try again.');
        references.length = 0;
      } finally { attempt.done(); }
    }
    // Every model failed: the records answer, with any tables the lookups already built. The steps were shown live.
    return emit(events, await recordsAnswer({ allowance: before, ...(found.length ? { blocks: chosenBlocks() } : {}) }));
  }

  return { answer };
}
