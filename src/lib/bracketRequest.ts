// Bracket from a prompt, step one: turn the organizer's words into parameters, or ask what is missing.
// The model (server/ai/bracketDraft.ts) and the offline parser below both feed resolveBracketRequest,
// so the same checks apply either way. A named roster can start a draft before the game is selected.
// Count-only prompts need a game, and invented names are accepted only when requested. The organizer confirms the
// result before createBracketFromTeams builds anything. Pure: shared by the browser and the server.
import type { ExtractedTeam, MatchFormat } from './types';
import { detectTournamentSizeFromPrompt, extractTeamsFromPrompt, extractTournamentTitle, MAX_BRACKET_TEAMS } from './bracketUtils';
import { SWISS_MAX_TEAMS } from './formats/swiss';
import { readBracketPromptDetails, type OpeningMatch } from './bracketPromptDetails';
import type { BracketAppearance, TeamBadgeStyle } from './bracketAppearance';
import { teamNameKey } from './teamNames';

export const BRACKET_GAMES = ['Mobile Legends: Bang Bang', 'Dota 2', 'Call of Duty: Mobile Multiplayer'] as const;
export const BR_GAME = 'Call of Duty: Mobile Battle Royale';
export const UNASSIGNED_BRACKET_GAME = 'Esports Tournament';
export const BRACKET_FORMATS = ['Single elimination', 'Double elimination', 'Round robin', 'Swiss'] as const;
export const SERIES = ['Bo1', 'Bo3', 'Bo5', 'Bo7'] as const;
export const SEEDING = ['Win rate', 'Skill rating', 'Random draw'] as const;

/** What a parser (model or offline) read from the prompt. null means "not stated". */
export interface ParsedRequest {
  title: string | null;
  game: string | null;
  format: string | null;
  matchFormat: string | null;
  finalMatchFormat: string | null;
  teamCount?: number | null;
  teams: Array<{ name: string; college?: string | null }>;
  generatedTeams?: Array<{ name: string; theme?: string }>;
  seeding: string | null;
  constraints: string[];
}

export interface BracketRequest {
  title: string;
  game: typeof BRACKET_GAMES[number] | typeof UNASSIGNED_BRACKET_GAME;
  format: typeof BRACKET_FORMATS[number];
  matchFormat: MatchFormat;
  finalMatchFormat: MatchFormat;
  teams: ExtractedTeam[];
  teamsCount: number;
  generatedNames?: true;
  seeding: typeof SEEDING[number] | 'Listed matchups';
  openingMatches?: OpeningMatch[];
  teamStyles?: Record<string, TeamBadgeStyle>;
  appearance?: Omit<BracketAppearance, 'teams'>;
  /** Read from the prompt and shown to the organizer; the builder does not apply them automatically. */
  constraints: string[];
  /** Fields filled with a default because the prompt did not say. Shown to the organizer. */
  defaults: Array<'format' | 'matchFormat' | 'finalMatchFormat' | 'seeding' | 'title' | 'team names'>;
}

export type Resolution =
  | { kind: 'ready'; request: BracketRequest }
  | { kind: 'question'; text: string; missing: Array<'game' | 'teams'>; editPrompt?: boolean }
  | { kind: 'generation-unavailable'; text: string }
  | { kind: 'battle-royale'; text: string };

/** The team count the prompt actually states, or null. (detectTournamentSizeFromPrompt falls back to 8.) */
export function statedTeamCount(prompt: string): number | null {
  const n = detectTournamentSizeFromPrompt(prompt, 0);
  if (n !== 8) return n;
  return /\b(?:8|eight)\s*-?\s*(?:teams?|squads?|colleges?|players?)\b|\btop 8\b/i.test(prompt) ? 8 : null;
}

export function readTeamNameRequest(prompt: string) {
  const request = prompt.match(/\b(?:generate|invent|create|suggest|come up with|make up)\s+(?:(?:a list of|a set of)\s+)?(?:(\d+)\s+)?(?:(?!(?:a|an|the|brackets?|tournaments?|with|using|from|for|and)\b)[a-z-]+\s+){0,5}?(?:team\s+names|names\s+for\s+(?:the\s+)?teams)\b/i);
  if (!request) return null;
  if (/(?:\bdo not|\bdon['’]t|\bnever|\bwithout)\s+(?:automatically\s+)?$/i.test(prompt.slice(0, request.index))) return null;
  return {
    count: request[1] ? Number(request[1]) : statedTeamCount(prompt),
    shortNames: /\b(?:1|one)\s*(?:to|[-–—])\s*(?:3|three)\s+words\b/i.test(prompt),
    balanced: /\bbalanced (?:spread|mix)\b/i.test(prompt) && /\b1[- ]word\b/i.test(prompt) && /\b3[- ]word\b/i.test(prompt),
    uniqueFirstWords: /\b(?:same|unique|different|repeat(?:ed)?)\s+first word/i.test(prompt),
    uniqueThemes: /\b(?:same|unique|different|repeat(?:ed)?)\s+themes?\b/i.test(prompt),
  };
}

function readGeneratedRoster(parsed: ParsedRequest, request: NonNullable<ReturnType<typeof readTeamNameRequest>>): ExtractedTeam[] {
  const candidates = parsed.generatedTeams ?? [];
  if (candidates.length !== request.count) return [];
  const names = candidates.map(team => team.name.trim());
  const keys = names.map(teamNameKey);
  const words = keys.map(key => key.split(' '));
  if (names.some(name => !/^[\p{L}\p{N}][\p{L}\p{M}\p{N}’' -]*$/u.test(name) || /^(?:bye|tbd|to be decided|awaiting team|team \d+)$/i.test(name))) return [];
  if (new Set(keys).size !== names.length) return [];
  if ((request.shortNames || request.balanced) && words.some(parts => parts.length > 3)) return [];
  if (request.balanced) {
    const counts = [1, 2, 3].map(length => words.filter(parts => parts.length === length).length);
    if (Math.max(...counts) - Math.min(...counts) > 1) return [];
  }
  if (request.uniqueFirstWords && new Set(words.map(parts => parts[0])).size !== names.length) return [];
  if (request.uniqueThemes) {
    const themes = candidates.map(team => teamNameKey(team.theme ?? ''));
    if (themes.includes('') || new Set(themes).size !== names.length) return [];
  }
  return names.map((name, index) => ({ name, seed: index + 1 }));
}

const GAME_WORDS = /^(?:mlbb|mobile legends(?::? bang bang)?|dota ?2?|codm|call of duty(?::? mobile)?(?: multiplayer| mp| battle royale| br)?|multiplayer|battle royale)$/i;
const pick = <T extends readonly string[]>(options: T, value: string | null | undefined) =>
  options.find(o => o.toLowerCase() === String(value ?? '').toLowerCase()) as T[number] | undefined;

/** Offline parser: keyword rules only. Says null for anything the prompt does not state. */
export function parseBracketPromptLocally(prompt: string, details = readBracketPromptDetails(prompt)): ParsedRequest {
  const p = prompt.toLowerCase();
  const br = /\b(?:codm|call of duty)\b/.test(p) && /battle royale|\bbr\b/.test(p);
  const game = br ? BR_GAME
    : /\bmlbb\b|mobile legends/.test(p) ? 'Mobile Legends: Bang Bang'
    : /\bdota\s*2?\b/.test(p) ? 'Dota 2'
    : /\bcodm\b|call of duty/.test(p) ? 'Call of Duty: Mobile Multiplayer'
    : null;
  const format = /double[- ]?elim/.test(p) ? 'Double elimination' : /single[- ]?elim|knockout/.test(p) ? 'Single elimination' : /round[- ]robin|everyone plays everyone/.test(p) ? 'Round robin' : /\bswiss\b/.test(p) ? 'Swiss' : null;
  const final = p.match(/\b(?:grand )?finals?(?: (?:is|as|to|uses))?\s+(?:bo\s*|best[- ]of[- ]*)([1357])\b|\b(?:bo\s*|best[- ]of[- ]*)([1357])\s+(?:grand )?finals?\b/);
  const series = (final ? p.replace(final[0], '') : p).match(/\b(?:bo\s*|best[- ]of[- ]*)([1357])\b/);
  const seeding = /\b(?:random(?:ize|ized|ly)?|shuffle|mix up|draw lots)\b/.test(p) ? 'Random draw' : /skill rating|\brating\b|\belo\b/.test(p) ? 'Skill rating' : /win rate|seeding order|in (?:this|that|the listed) order|listed order/.test(p) ? 'Win rate' : null;
  const generation = readTeamNameRequest(prompt);
  const teams = details.openingMatches.length
    ? details.openingMatches.flatMap(match => match.teams.map(name => ({ name })))
    : generation ? [] : extractTeamsFromPrompt(prompt).map(t => ({ name: t.name, college: t.college || null }));
  const heading = !generation && prompt.includes('\n') ? extractTournamentTitle(prompt, '') : '';
  const title = details.title || (heading && !GAME_WORDS.test(heading) && !teams.some(team => teamNameKey(team.name) === teamNameKey(heading)) ? heading : '');
  return {
    title: title || null, game, format,
    matchFormat: series ? `Bo${series[1]}` : null,
    finalMatchFormat: final ? `Bo${final[1] || final[2]}` : null,
    teamCount: statedTeamCount(prompt),
    teams,
    seeding,
    constraints: /same[- ]college|college apart/.test(p) ? ['same-college squads apart in round 1'] : [],
  };
}

/** Applies the checks every parser's output must pass. */
export function resolveBracketRequest(prompt: string, parsed: ParsedRequest): Resolution {
  const details = readBracketPromptDetails(prompt);
  const local = parseBracketPromptLocally(prompt, details);
  const gameRead = parsed.game ?? local.game;
  if (gameRead === BR_GAME) return { kind: 'battle-royale', text: 'Choose Mobile Legends, Dota 2, or CODM Multiplayer to build a bracket.' };
  const game = pick(BRACKET_GAMES, gameRead);
  const askTeams = (text: string): Resolution => ({ kind: 'question', text, missing: ['teams'], editPrompt: true });
  if (details.problem) return askTeams(details.problem);
  const generation = details.openingMatches.length ? null : readTeamNameRequest(prompt);
  // Roster extraction requires a name written in the prompt. Generated names use their own field.
  const words = (text: string) => ` ${teamNameKey(text).replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()} `;
  const wordsInPrompt = words(prompt);
  const seen = new Set<string>();
  const fromPairings = details.openingMatches.flatMap(match => match.teams.map(name => ({ name })));
  const candidates = parsed.teams
    .map(t => ({ name: t.name.trim().slice(0, 80), college: t.college?.trim().toUpperCase().slice(0, 30) || undefined }))
    // A line that only names the game (an answer such as "MLBB") is not a team.
    .map(team => ({ ...team, span: words(team.name) }))
    .filter(t => t.span.length > 2 && !GAME_WORDS.test(t.name) && wordsInPrompt.includes(t.span) && !seen.has(teamNameKey(t.name)) && seen.add(teamNameKey(t.name)));
  const fromModel: ExtractedTeam[] = candidates
    .filter(team => candidates.reduce((text, other) => other.span.length > team.span.length && other.span.includes(team.span)
      ? text.replaceAll(other.span, '  ') : text, wordsInPrompt).includes(team.span))
    .map((team, i) => ({ name: team.name, college: team.college, seed: i + 1 }));
  // One name is a misread line, not a team list.
  const seenLocal = new Set<string>();
  const localNames = local.teams.filter(team => {
    const key = teamNameKey(team.name);
    return key && team.name.length <= 80 && !GAME_WORDS.test(key) && !seenLocal.has(key) && seenLocal.add(key);
  });
  const stated = generation ? generation.count : parsed.teamCount === undefined ? local.teamCount ?? null : parsed.teamCount;
  const localCompletesRoster = stated === localNames.length && fromModel.length < localNames.length
    && fromModel.every(team => localNames.some(localTeam => teamNameKey(localTeam.name) === teamNameKey(team.name)));
  const hasModelRoster = fromModel.length >= 2 || fromModel.length >= localNames.length;
  const roster = hasModelRoster && !localCompletesRoster ? fromModel : localNames;
  const teams = generation ? readGeneratedRoster(parsed, generation)
    : fromPairings.length ? fromPairings.map((team, i) => ({ ...team, seed: i + 1 }))
    : roster.length >= 2 ? roster.map((team, i) => ({ name: team.name, college: team.college || undefined, seed: i + 1 })) : [];
  const teamsCount = teams.length ? Math.max(teams.length, stated ?? 0) : stated;
  if (details.openingMatches.length && stated !== null && stated !== teams.length) {
    return askTeams(`The prompt says ${stated} teams but the opening matchups name ${teams.length}. List the missing teams and matchups or correct the team count.`);
  }
  if (!generation && !teams.length && /(?:^|\n)\s*(?:teams|roster|participants|[^\n:]*matchups)\s*:/i.test(prompt)) {
    return askTeams('I found a roster or matchups section but could not read the team names. List one team per line or use “Match 1: Team A vs Team B”.');
  }
  if (!generation && !fromPairings.length && stated !== null && roster.length && stated !== roster.length) {
    return askTeams(`I read ${roster.length} ${roster.length === 1 ? 'name' : 'names'}, but the prompt says ${stated} teams. Check the roster and team count before building.`);
  }

  const missing: Array<'game' | 'teams'> = [];
  if (!game && (generation || teams.length < 2)) missing.push('game');
  if (teamsCount === null) missing.push('teams');
  if (missing.length) {
    const ask = [
      ...(missing.includes('game') ? [`Which game is this bracket for: ${BRACKET_GAMES.join(', ')}?`] : []),
      ...(missing.includes('teams') ? [generation ? 'How many team names should Arena AI generate?' : 'Which teams are playing? List one per line, or give the number of teams.'] : []),
    ];
    return { kind: 'question', text: ask.join(' '), missing };
  }
  if (teamsCount! < 2 || teamsCount! > MAX_BRACKET_TEAMS) return { kind: 'question', text: `A bracket needs 2 to ${MAX_BRACKET_TEAMS} teams. How many teams are playing?`, missing: ['teams'] };

  const defaults: BracketRequest['defaults'] = [];
  const format = pick(BRACKET_FORMATS, parsed.format ?? local.format) ?? (defaults.push('format'), 'Single elimination');
  const limit = format === 'Swiss' ? SWISS_MAX_TEAMS : format === 'Round robin' ? 32 : MAX_BRACKET_TEAMS;
  if (teamsCount! > limit) return { kind: 'question', text: `${format} supports 2 to ${limit} teams. How many teams are playing?`, missing: ['teams'] };
  if (generation && !teams.length) return { kind: 'generation-unavailable', text: 'Arena AI could not generate a full roster that matched your naming rules. Try again or enter a list of team names.' };
  const openingMatches = details.openingMatches;
  if (openingMatches.length) {
    if (format === 'Swiss' || format === 'Round robin') return askTeams('Fixed opening matchups are available for elimination brackets. To use Swiss or round robin, give the roster as a list.');
    const openingSlots = 2 ** Math.ceil(Math.log2(teamsCount!)) / 2;
    if (openingMatches.at(-1)!.number > openingSlots) return askTeams(`A ${teamsCount}-team bracket has ${openingSlots} opening matches. Check the match numbers in the prompt.`);
    if (teamsCount! - openingMatches.length < openingSlots) return askTeams('These pairings leave too few teams for the other opening matches. List more teams or leave some matchups open for automatic seeding.');
  }
  const uniform = prompt.match(/\b(?:all|every|each)\s+match(?:es)?\s+(?:(?:is|are|will be|use|uses)\s+)?(?:bo\s*|best[- ]of[- ]*)([1357])\b/i);
  const matchFormat = (pick(SERIES, uniform ? `Bo${uniform[1]}` : parsed.matchFormat ?? local.matchFormat) ?? (defaults.push('matchFormat'), 'Bo3')) as MatchFormat;
  // The builder plays the final as Bo5 unless told otherwise; say so instead of doing it silently.
  const finalMatchFormat = (format === 'Swiss' || format === 'Round robin' ? matchFormat : pick(SERIES, local.finalMatchFormat ?? (uniform ? matchFormat : parsed.finalMatchFormat)) ?? (defaults.push('finalMatchFormat'), matchFormat === 'Bo7' ? 'Bo7' : 'Bo5')) as MatchFormat;
  const seeding = openingMatches.length ? 'Listed matchups' : pick(SEEDING, parsed.seeding ?? local.seeding) ?? (defaults.push('seeding'), 'Random draw');
  const title = (details.title || parsed.title || '').trim().slice(0, 160) || (defaults.push('title'), game ? `${game} ${format}` : `${format} bracket`);
  if (teams.length < teamsCount!) defaults.push('team names');
  return {
    kind: 'ready',
    request: {
      title, game: game ?? UNASSIGNED_BRACKET_GAME, format, matchFormat, finalMatchFormat, teams, teamsCount: teamsCount!, seeding,
      ...(generation && { generatedNames: true }),
      ...(openingMatches.length && { openingMatches }),
      ...(details.styles.size && { teamStyles: Object.fromEntries(details.styles) }),
      ...(Object.keys(details.appearance).length && { appearance: details.appearance }),
      constraints: parsed.constraints.map(c => c.trim().slice(0, 120)).filter(Boolean).slice(0, 8),
      defaults,
    },
  };
}
