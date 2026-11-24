// Bracket from a prompt (staff only): the model reads the request into JSON, zod validates it, and
// resolveBracketRequest applies the same checks as the offline parser. Name generation is enabled
// for explicit requests only. Nothing is built here; the organizer confirms first.
import { z } from 'zod';
import { BR_GAME, BRACKET_FORMATS, BRACKET_GAMES, readTeamNameRequest, resolveBracketRequest, SEEDING, SERIES, type Resolution } from '../../src/lib/bracketRequest.ts';
import { MAX_BRACKET_TEAMS } from '../../src/lib/bracketUtils.ts';
import { fairShuffle } from '../../src/lib/fairDraw.ts';
import { BRACKET_PROMPT } from './prompt.ts';
import { attemptSignal, type Provider } from './provider.ts';

const nullableEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).nullable().catch(null);
export const parsedSchema = z.object({
  title: z.string().trim().max(160).nullable().catch(null),
  game: nullableEnum([...BRACKET_GAMES, BR_GAME] as [string, ...string[]]),
  format: nullableEnum(BRACKET_FORMATS as unknown as [string, ...string[]]),
  matchFormat: nullableEnum(SERIES as unknown as [string, ...string[]]),
  finalMatchFormat: nullableEnum(SERIES as unknown as [string, ...string[]]),
  teamCount: z.number().int().nullable().optional().catch(undefined),
  teams: z.array(z.object({ name: z.string().trim().min(1).max(80), college: z.string().trim().max(30).nullable().optional() })).max(256).catch([]),
  generatedTeams: z.array(z.object({ name: z.string().trim().min(1).max(80), theme: z.string().trim().max(80).optional() })).max(MAX_BRACKET_TEAMS).optional().catch(undefined),
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
    teamCount: nullable({ type: 'integer' }),
    teams: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, college: nullable({ type: 'string' }) }, required: ['name'] } },
    seeding: oneOf(SEEDING),
    constraints: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'game', 'format', 'matchFormat', 'finalMatchFormat', 'teamCount', 'teams', 'seeding', 'constraints'],
};

export type DraftResult = Resolution & { source: 'Arena AI' | 'Arena AI (backup model)' };

const generationPrompt = [
  'The organizer explicitly asked for original team names. Generate those names in generatedTeams and include any explicitly supplied roster only in teams.',
  'Follow the naming brief, including word lengths, style, themes, variety and requested exclusions. Numbering and prose belong outside the JSON values. Each name must contain just the name, with no list number or explanation.',
  'If the brief asks for balanced one-, two-, and three-word names, keep the counts for the three lengths within one of each other.',
  'Use a specific, genuinely distinct theme for each name when requested. Report that theme in the theme field. Use the game context to avoid known esports organizations and in-game characters when requested.',
  'Put only bracket placement requirements in constraints. Do not put any naming rules in constraints.',
].join('\n');

/** Tries each provider in turn. The browser falls back to the offline parser if they all fail. */
export async function draftBracket(providers: Provider[], prompt: string, signal: AbortSignal): Promise<DraftResult> {
  const generation = readTeamNameRequest(prompt);
  const count = generation?.count ?? 0;
  const generate = count >= 2 && count <= MAX_BRACKET_TEAMS;
  const schema = generate ? {
    ...parsedJsonSchema,
    properties: {
      ...parsedJsonSchema.properties,
      generatedTeams: { type: 'array', minItems: count, maxItems: count, items: {
        type: 'object', properties: { name: { type: 'string' }, theme: { type: 'string' } },
        required: generation?.uniqueThemes ? ['name', 'theme'] : ['name'],
      } },
    },
    required: [...parsedJsonSchema.required, 'generatedTeams'],
  } : parsedJsonSchema;
  let lastError: unknown = new Error('No model is configured.');
  let question: DraftResult | undefined;
  for (const [index, provider] of providers.entries()) {
    const attempt = attemptSignal(signal, generate || prompt.length > 2200 ? 24_000 : 12_000);
    try {
      const raw = await provider.json({
        system: generate ? `${BRACKET_PROMPT}\n${generationPrompt}\nGenerate exactly ${count} names.` : BRACKET_PROMPT,
        prompt, schema, signal: attempt.signal, thinkingBudget: 2048,
        maxOutputTokens: generate ? Math.max(4096, count * 36) : Math.max(2000, prompt.length),
        ...(generate && { temperature: 0.95 }),
      });
      const parsed = parsedSchema.safeParse(raw);
      if (!parsed.success) throw new Error('The model returned an invalid draft.');
      if (parsed.data.generatedTeams && /\brandom\b|\bshuffle\b/i.test(prompt)) {
        parsed.data.generatedTeams = fairShuffle(parsed.data.generatedTeams);
      }
      const resolution = resolveBracketRequest(prompt, parsed.data);
      if (resolution.kind === 'generation-unavailable') throw new Error(resolution.text);
      const source = index > 0 || provider.id === 'groq' ? 'Arena AI (backup model)' : 'Arena AI';
      const result = { ...resolution, source } satisfies DraftResult;
      // Another model can recover a roster that the first one failed to extract.
      if (result.kind === 'question' && result.missing.includes('teams')) question ??= result;
      else return result;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    } finally {
      attempt.done();
    }
  }
  if (question) return question;
  throw lastError;
}
