// Bracket from a prompt, step one: turn the organizer's words into parameters, or ask what is missing.
// The model (server/ai/bracketDraft.ts) and the offline parser below both feed resolveBracketRequest,
// so the same checks apply either way: a game must be named (no silent default), the teams or a team
// count must be given, and team names must come from the prompt itself. The organizer confirms the
// result before createBracketFromTeams builds anything. Pure: shared by the browser and the server.
import type { ExtractedTeam, MatchFormat } from './types';
import { detectTournamentSizeFromPrompt, extractTeamsFromPrompt, extractTournamentTitle, MAX_BRACKET_TEAMS } from './bracketUtils';

export const BRACKET_GAMES = ['Mobile Legends: Bang Bang', 'Dota 2', 'Call of Duty: Mobile Multiplayer'] as const;
export const BR_GAME = 'Call of Duty: Mobile Battle Royale';
export const BRACKET_FORMATS = ['Single elimination', 'Double elimination', 'Round robin'] as const;
export const SERIES = ['Bo1', 'Bo3', 'Bo5', 'Bo7'] as const;
export const SEEDING = ['Win rate', 'Skill rating', 'Random draw'] as const;

/** What a parser (model or offline) read from the prompt. null means "not stated". */
export interface ParsedRequest {
  title: string | null;
  game: string | null;
  format: string | null;
  matchFormat: string | null;
  finalMatchFormat: string | null;
  teams: Array<{ name: string; college?: string | null }>;
  seeding: string | null;
  constraints: string[];
}

export interface BracketRequest {
  title: string;
  game: typeof BRACKET_GAMES[number];
  format: typeof BRACKET_FORMATS[number];
  matchFormat: MatchFormat;
  finalMatchFormat: MatchFormat;
  teams: ExtractedTeam[];
  teamsCount: number;
  seeding: typeof SEEDING[number];
  /** Read from the prompt and shown to the organizer; the builder does not apply them automatically. */
  constraints: string[];
  /** Fields filled with a default because the prompt did not say. Shown to the organizer. */
  defaults: Array<'format' | 'matchFormat' | 'finalMatchFormat' | 'seeding' | 'title' | 'team names'>;
}

export type Resolution =
  | { kind: 'ready'; request: BracketRequest }
  | { kind: 'question'; text: string; missing: Array<'game' | 'teams'> }
  | { kind: 'battle-royale'; text: string };

/** The team count the prompt actually states, or null. (detectTournamentSizeFromPrompt falls back to 8.) */
export function statedTeamCount(prompt: string): number | null {
  const n = detectTournamentSizeFromPrompt(prompt, 0);
  if (n !== 8) return n;
  return /\b(?:8|eight)\s*-?\s*(?:teams?|squads?|colleges?|players?)\b|\btop 8\b/i.test(prompt) ? 8 : null;
}

const GAME_WORDS = /^(?:mlbb|mobile legends(?::? bang bang)?|dota ?2?|codm|call of duty(?::? mobile)?(?: multiplayer| mp| battle royale| br)?|multiplayer|battle royale)$/i;
const pick = <T extends readonly string[]>(options: T, value: string | null | undefined) =>
  options.find(o => o.toLowerCase() === String(value ?? '').toLowerCase()) as T[number] | undefined;

/** Offline parser: keyword rules only. Says null for anything the prompt does not state. */
export function parseBracketPromptLocally(prompt: string): ParsedRequest {
  const p = prompt.toLowerCase();
  const br = /\b(?:codm|call of duty)\b/.test(p) && /battle royale|\bbr\b/.test(p);
  const game = br ? BR_GAME
    : /\bmlbb\b|mobile legends/.test(p) ? 'Mobile Legends: Bang Bang'
    : /\bdota\s*2?\b/.test(p) ? 'Dota 2'
    : /\bcodm\b|call of duty/.test(p) ? 'Call of Duty: Mobile Multiplayer'
    : null;
  const format = /double[- ]?elim/.test(p) ? 'Double elimination' : /round[- ]robin|\bgroups?\b/.test(p) ? 'Round robin' : /single[- ]?elim|knockout/.test(p) ? 'Single elimination' : null;
  const final = p.match(/\b(?:grand )?finals?(?: (?:is|as|to|uses))?\s+(?:bo|best[- ]of[- ]?)([1357])\b|\b(?:bo|best[- ]of[- ]?)([1357])\s+(?:grand )?finals?\b/);
  const series = (final ? p.replace(final[0], '') : p).match(/\b(?:bo|best[- ]of[- ]?)([1357])\b/);
  const seeding = /skill rating|\brating\b|\belo\b/.test(p) ? 'Skill rating' : /random|\bdraw\b/.test(p) ? 'Random draw' : /win rate|seeded/.test(p) ? 'Win rate' : null;
  const title = extractTournamentTitle(prompt, '');
  return {
    title: title || null, game, format,
    matchFormat: series ? `Bo${series[1]}` : null,
    finalMatchFormat: final ? `Bo${final[1] || final[2]}` : null,
    teams: extractTeamsFromPrompt(prompt).map(t => ({ name: t.name, college: t.college || null })),
    seeding,
    constraints: /same[- ]college|college apart/.test(p) ? ['same-college squads apart in round 1'] : [],
  };
}

/** Applies the checks every parser's output must pass. */
export function resolveBracketRequest(prompt: string, parsed: ParsedRequest): Resolution {
  if (parsed.game === BR_GAME) return { kind: 'battle-royale', text: 'CODM Battle Royale is scored by lobby placement, not a bracket. Create it on the Battle Royale page.' };
  const game = pick(BRACKET_GAMES, parsed.game);
  // A team counts only if its name is in the prompt: the model may not add teams.
  const lower = prompt.toLowerCase();
  const seen = new Set<string>();
  const named: ExtractedTeam[] = parsed.teams
    .map(t => ({ name: t.name.trim().slice(0, 80), college: t.college?.trim().toUpperCase().slice(0, 30) || undefined }))
    // A line that only names the game (an answer such as "MLBB") is not a team.
    .filter(t => t.name.length > 0 && !GAME_WORDS.test(t.name) && lower.includes(t.name.toLowerCase()) && !seen.has(t.name.toLowerCase()) && seen.add(t.name.toLowerCase()))
    .map((t, i) => ({ ...t, seed: i + 1 }));
  // One name is a misread line, not a team list.
  const teams = named.length >= 2 ? named : [];
  const stated = statedTeamCount(prompt);
  const teamsCount = teams.length ? Math.max(teams.length, stated ?? 0) : stated;

  const missing: Array<'game' | 'teams'> = [];
  if (!game) missing.push('game');
  if (!teamsCount) missing.push('teams');
  if (missing.length) {
    const ask = [
      ...(missing.includes('game') ? [`Which game is this bracket for: ${BRACKET_GAMES.join(', ')}?`] : []),
      ...(missing.includes('teams') ? ['Which teams are playing? List one per line, or give the number of teams.'] : []),
    ];
    return { kind: 'question', text: ask.join(' '), missing };
  }
  if (teamsCount! < 2 || teamsCount! > MAX_BRACKET_TEAMS) return { kind: 'question', text: `A bracket needs 2 to ${MAX_BRACKET_TEAMS} teams. How many teams are playing?`, missing: ['teams'] };

  const defaults: BracketRequest['defaults'] = [];
  const format = pick(BRACKET_FORMATS, parsed.format) ?? (defaults.push('format'), 'Single elimination');
  const matchFormat = (pick(SERIES, parsed.matchFormat) ?? (defaults.push('matchFormat'), 'Bo3')) as MatchFormat;
  // The builder plays the final as Bo5 unless told otherwise; say so instead of doing it silently.
  const finalMatchFormat = (pick(SERIES, parsed.finalMatchFormat) ?? (defaults.push('finalMatchFormat'), matchFormat === 'Bo7' ? 'Bo7' : 'Bo5')) as MatchFormat;
  const seeding = pick(SEEDING, parsed.seeding) ?? (defaults.push('seeding'), 'Win rate');
  const title = parsed.title?.trim().slice(0, 160) || (defaults.push('title'), `${game} ${format}`);
  if (teams.length < teamsCount!) defaults.push('team names');
  return {
    kind: 'ready',
    request: { title, game: game!, format, matchFormat, finalMatchFormat, teams, teamsCount: teamsCount!, seeding, constraints: parsed.constraints.map(c => c.trim().slice(0, 120)).filter(Boolean).slice(0, 8), defaults },
  };
}
