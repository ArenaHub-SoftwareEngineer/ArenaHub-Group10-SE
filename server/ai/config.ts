// Arena AI settings. Limits and model names come from the environment, never from code paths, so an
// organizer can tighten them for finals week without a release. See docs/ENV_CHECKLIST.md.
type Env = Record<string, string | undefined>;

/** What a viewer picks in Arena AI. Each mode has its own models and thinking budget. */
export const AI_MODES = ['quick', 'think', 'deep'] as const;
export type AiMode = typeof AI_MODES[number];
export interface ModeConfig {
  /** Gemini models tried in order. Groq (when configured) is the last backup. */
  models: string[];
  /** Thinking tokens per model call. 0 turns thinking off. */
  thinkingBudget: number;
  /** Quick answers factual questions straight from the live records; the others always reason with a model. */
  recordsFirst: boolean;
}
const list = (value: string | undefined, fallback: string) => [...new Set((value || fallback).split(',').map(item => item.trim()).filter(Boolean))];

const whole = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export interface AiConfig {
  /** Tried in order: GEMINI_MODEL, then GEMINI_FALLBACK_MODEL. */
  gemini?: { key: string; models: string[] };
  /** A model that has not written any text within this time is abandoned for the next one. */
  firstTokenMs: number;
  groq?: { key: string; model: string };
  /** Model answers per signed-in user per minute (assistant page). Over the limit, live records answer. */
  userPerMinute: number;
  /** Model answers per minute for the whole server, across all users. */
  globalPerMinute: number;
  /** Requests of any kind per user per minute before the server answers 429. */
  burstPerMinute: number;
  /** Live chat: seconds between one viewer's questions, and model replies per match per minute. */
  chatUserIntervalSec: number;
  chatMatchPerMinute: number;
  /** Test-only scripted provider, honoured only against the demo-arenahub emulators. */
  fake: boolean;
  modes: Record<AiMode, ModeConfig>;
  /** Per-person allowance: model tokens per window, the window length, and the staff multiplier. */
  usage: { tokensPerWindow: number; windowHours: number; staffMultiplier: number };
}

export function aiConfig(env: Env): AiConfig {
  const emulators = env.VITE_FIREBASE_EMULATORS === 'true' && env.VITE_FIREBASE_PROJECT_ID === 'demo-arenahub';
  // Measured 15 Nov 2026 on the project's free-tier key: gemini-3.5-flash-lite answered in about 1 s and
  // gemini-3.6-flash in 1.5 to 3 s, while gemini-3.8-flash, gemini-3.7-flash and gemini-flash-latest
  // timed out (504) on every request. Re-measured 18 Nov 2026: gemini-3.6-flash, gemini-3.5-flash and
  // gemini-flash-latest now time out too, gemini-2.5-flash is retired (404), and gemini-3.1-flash-lite
  // answers in about 2 s with thought summaries. Availability changes; every name can be overridden.
  const fallback = env.GEMINI_FALLBACK_MODEL === 'none' ? '' : env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';
  const models = [...new Set([env.GEMINI_MODEL || 'gemini-3.5-flash-lite', fallback].filter(Boolean))];
  return {
    ...(env.GEMINI_API_KEY ? { gemini: { key: env.GEMINI_API_KEY, models } } : {}),
    firstTokenMs: whole(env.AI_FIRST_TOKEN_MS, 12_000, 2_000, 60_000),
    ...(env.GROQ_API_KEY ? { groq: { key: env.GROQ_API_KEY, model: env.GROQ_MODEL || 'openai/gpt-oss-20b' } } : {}),
    userPerMinute: whole(env.AI_USER_PER_MINUTE, 5, 1, 60),
    globalPerMinute: whole(env.AI_GLOBAL_PER_MINUTE, 12, 1, 1000),
    burstPerMinute: whole(env.AI_BURST_PER_MINUTE, 30, 5, 600),
    chatUserIntervalSec: whole(env.AI_CHAT_USER_INTERVAL_SEC, 30, 5, 600),
    chatMatchPerMinute: whole(env.AI_CHAT_MATCH_PER_MINUTE, 6, 1, 60),
    fake: emulators && env.ARENA_AI_PROVIDER === 'fake',
    modes: {
      quick: { models: list(env.AI_QUICK_MODELS, models.join(',')), thinkingBudget: 0, recordsFirst: true },
      // Both lite models think when given a budget (measured 18 Nov 2026: about 2 s and 7 s for a short question).
      think: { models: list(env.AI_THINK_MODELS, 'gemini-3.1-flash-lite,gemini-3.5-flash-lite'), thinkingBudget: whole(env.AI_THINK_BUDGET, 2048, 128, 24_576), recordsFirst: false },
      deep: { models: list(env.AI_DEEP_MODELS, 'gemini-3.5-flash-lite,gemini-3.1-flash-lite'), thinkingBudget: whole(env.AI_DEEP_BUDGET, 8192, 128, 24_576), recordsFirst: false },
    },
    usage: {
      tokensPerWindow: whole(env.AI_WINDOW_TOKENS, 400_000, 1_000, 50_000_000),
      windowHours: whole(env.AI_WINDOW_HOURS, 5, 1, 48),
      staffMultiplier: whole(env.AI_STAFF_MULTIPLIER, 2, 1, 20),
    },
  };
}
