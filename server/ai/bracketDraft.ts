// Bracket from a prompt (staff only): the model reads the request into JSON, zod validates it, and
// resolveBracketRequest applies the same checks as the offline parser (game named, teams or a count
// given, team names taken from the prompt). Nothing is built here; the organizer confirms first.
import { z } from 'zod';
import { BR_GAME, BRACKET_FORMATS, BRACKET_GAMES, resolveBracketRequest, SEEDING, SERIES, type ParsedRequest, type Resolution } from '../../src/lib/bracketRequest.ts';
import { BRACKET_PROMPT } from './prompt.ts';
import type { Provider } from './provider.ts';

const nullableEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).nullable().catch(null);
export const parsedSchema = z.object({
  title: z.string().trim().max(160).nullable().catch(null),
  game: nullableEnum([...BRACKET_GAMES, BR_GAME] as [string, ...string[]]),
  format: nullableEnum(BRACKET_FORMATS as unknown as [string, ...string[]]),
  matchFormat: nullableEnum(SERIES as unknown as [string, ...string[]]),
  finalMatchFormat: nullableEnum(SERIES as unknown as [string, ...string[]]),
  teams: z.array(z.object({ name: z.string().trim().min(1).max(80), college: z.string().trim().max(30).nullable().optional() })).max(256).catch([]),
  seeding: nullableEnum(SEEDING as unknown as [string, ...string[]]),
  constraints: z.array(z.string().trim().max(120)).max(8).catch([]),
});

/** The same shape as JSON Schema, for the model's structured output. */
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const oneOf = (values: readonly string[]) => nullable({ type: 'string', enum: [...values] });
export const parsedJsonSchema = {
  type: 'object',
  properties: {
    title: nullable({ type: 'string' }),
    game: oneOf([...BRACKET_GAMES, BR_GAME]),
    format: oneOf(BRACKET_FORMATS),
    matchFormat: oneOf(SERIES),
    finalMatchFormat: oneOf(SERIES),
    teams: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, college: nullable({ type: 'string' }) }, required: ['name'] } },
    seeding: oneOf(SEEDING),
    constraints: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'game', 'format', 'matchFormat', 'finalMatchFormat', 'teams', 'seeding', 'constraints'],
};

export type DraftResult = Resolution & { source: 'Arena AI' | 'Arena AI (backup model)' };

/** Tries each provider in turn. Throws when none can read the request; the browser then parses offline. */
export async function draftBracket(providers: Provider[], prompt: string, signal: AbortSignal): Promise<DraftResult> {
  let lastError: unknown = new Error('No model is configured.');
  for (const [index, provider] of providers.entries()) {
    try {
      const raw = await provider.json({ system: BRACKET_PROMPT, prompt, schema: parsedJsonSchema, signal });
      const parsed = parsedSchema.safeParse(raw);
      if (!parsed.success) throw new Error('The model returned an invalid draft.');
      return { ...resolveBracketRequest(prompt, parsed.data as ParsedRequest), source: index > 0 || provider.id === 'groq' ? 'Arena AI (backup model)' : 'Arena AI' };
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
