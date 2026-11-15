// Arena AI settings. Limits and model names come from the environment, never from code paths, so an
// organizer can tighten them for finals week without a release. See docs/ENV_CHECKLIST.md.
type Env = Record<string, string | undefined>;

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
}

export function aiConfig(env: Env): AiConfig {
  const emulators = env.VITE_FIREBASE_EMULATORS === 'true' && env.VITE_FIREBASE_PROJECT_ID === 'demo-arenahub';
  // Measured 15 Nov 2026 on the project's free-tier key: gemini-3.5-flash-lite answered in about 1 s and
  // gemini-3.6-flash in 1.5 to 3 s, while gemini-3.8-flash, gemini-3.7-flash and gemini-flash-latest
  // timed out (504) on every request. Availability changes; both names can be overridden.
  const fallback = env.GEMINI_FALLBACK_MODEL === 'none' ? '' : env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';
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
  };
}
