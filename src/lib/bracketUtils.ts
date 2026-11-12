import { BracketDraft, Match, Team, MatchFormat, ExtractedTeam } from './types';
import { INITIAL_TEAMS } from './mockData';
import { doubleElimination, resolveTournamentGraph, roundRobin } from './tournamentFormats';

export type { ExtractedTeam } from './types';

export const MAX_BRACKET_TEAMS = 256;

const INSTRUCTION_KEYWORDS = [
  'bracket format',
  'match format',
  'seeding method',
  'keep same-college',
  'same-college',
  'same college',
  'college apart',
  'additional instructions',
  'instructions',
  'avoid matching',
  'maintain fair',
  'generate a',
  'tournament format',
  'single elimination',
  'double elimination',
  'best-of',
  'best of',
  'win rate',
  'skill rating',
  'random draw',
  'grand final',
  'semifinal',
  'quarterfinal',
];

export function isInstructionLine(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length > 55) return true;
  return INSTRUCTION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Detects the tournament team count from user prompt or team count.
 * Accommodates ANY number of teams (e.g. 3, 5, 6, 7, 8, 10, 12, 16, etc.)
 */
export function detectTournamentSizeFromPrompt(
  promptText: string,
  teamCount?: number
): number {
  const p = promptText.toLowerCase();

  // Explicit number pattern: "6 teams", "5-team", "10 teams", etc.
  const numMatch = p.match(/(\d+)\s*(?:-| )*(?:team|teams|player|players|college|colleges|squad|squads)/);
  if (numMatch && numMatch[1]) {
    const val = parseInt(numMatch[1], 10);
    if (!isNaN(val) && val >= 2) {
      return val;
    }
  }

  // Explicit words
  if (p.includes('32 team') || p.includes('32-team') || p.includes('thirty-two') || p.includes('32 teams')) return 32;
  if (p.includes('16 team') || p.includes('16-team') || p.includes('sixteen team') || p.includes('16 teams')) return 16;
  if (p.includes('12 team') || p.includes('12-team') || p.includes('twelve team') || p.includes('12 teams')) return 12;
  if (p.includes('10 team') || p.includes('10-team') || p.includes('ten team') || p.includes('10 teams')) return 10;
  if (p.includes('8 team') || p.includes('8-team') || p.includes('eight team') || p.includes('8 teams') || p.includes('top 8')) return 8;
  if (p.includes('7 team') || p.includes('7-team') || p.includes('seven team') || p.includes('7 teams')) return 7;
  if (p.includes('6 team') || p.includes('6-team') || p.includes('six team') || p.includes('6 teams')) return 6;
  if (p.includes('5 team') || p.includes('5-team') || p.includes('five team') || p.includes('5 teams')) return 5;
  if (p.includes('4 team') || p.includes('4-team') || p.includes('four team') || p.includes('4 teams') || p.includes('final four') || p.includes('top 4')) return 4;
  if (p.includes('3 team') || p.includes('3-team') || p.includes('three team') || p.includes('3 teams')) return 3;

  if (teamCount && teamCount >= 2) return Math.floor(teamCount);

  return 8;
}

/**
 * Standard tournament bracket pairing order for any power of 2 size.
 * e.g., size 4: [1, 4, 2, 3] -> (1 vs 4), (2 vs 3)
 * e.g., size 8: [1, 8, 4, 5, 2, 7, 3, 6] -> (1 vs 8), (4 vs 5), (2 vs 7), (3 vs 6)
 */
export function getStandardSeedOrder(size: number): number[] {
  if (size <= 2) return [1, 2];
  const rounds = Math.log2(size) - 1;
  let order = [1, 2];
  for (let i = 0; i < rounds; i++) {
    const nextOrder: number[] = [];
    const currentSum = order.length * 2 + 1;
    for (const seed of order) {
      nextOrder.push(seed);
      nextOrder.push(currentSum - seed);
    }
    order = nextOrder;
  }
  return order;
}

/**
 * Returns the destination slot for a match winner based on the order of the
 * two feeder matches. This keeps advancement deterministic even when one
 * feeder (such as an earned BYE) was populated before the other.
 */
export function getAdvancementSlot(matches: Match[], sourceMatch: Match): 1 | 2 | undefined {
  if (!sourceMatch.nextMatchId) return undefined;

  const feederIndex = matches
    .filter((match) => match.nextMatchId === sourceMatch.nextMatchId)
    .findIndex((match) => match.id === sourceMatch.id);

  if (feederIndex === 0) return 1;
  if (feederIndex === 1) return 2;
  return undefined;
}

/**
 * Replaces a match and synchronizes its winner into the correct next-round
 * slot. If a result is changed, dependent results are cleared recursively so
 * an old winner can never remain in a later round.
 */
export function updateMatchAndAdvance(matches: Match[], updatedMatch: Match): Match[] {
  if (matches.some(match => match.sources)) return resolveTournamentGraph(matches, updatedMatch);
  const previousMatch = matches.find((match) => match.id === updatedMatch.id);
  if (!previousMatch) return matches;

  let updatedMatches = matches.map((match) =>
    match.id === updatedMatch.id ? updatedMatch : match
  );

  if (!updatedMatch.nextMatchId) return updatedMatches;

  const nextMatch = updatedMatches.find((match) => match.id === updatedMatch.nextMatchId);
  const destinationSlot = getAdvancementSlot(updatedMatches, updatedMatch);
  if (!nextMatch || !destinationSlot) return updatedMatches;

  const winningTeam = updatedMatch.winnerId === updatedMatch.team1?.id
    ? updatedMatch.team1
    : updatedMatch.winnerId === updatedMatch.team2?.id
    ? updatedMatch.team2
    : undefined;
  const currentTeam = destinationSlot === 1 ? nextMatch.team1 : nextMatch.team2;

  if (currentTeam?.id === winningTeam?.id) return updatedMatches;

  const nextMatchWithParticipant: Match = {
    ...nextMatch,
    ...(destinationSlot === 1 ? { team1: winningTeam } : { team2: winningTeam }),
    score: { team1Score: 0, team2Score: 0 },
    status: 'upcoming',
    winnerId: undefined,
  };

  // Recursion also removes a now-invalid winner from every later round.
  updatedMatches = updateMatchAndAdvance(updatedMatches, nextMatchWithParticipant);
  return updatedMatches;
}

/**
 * Robust extractor for teams from user prompt text.
 * Strictly ignores instructions, formats, and constraint lines.
 */
export function extractTeamsFromPrompt(promptText: string): ExtractedTeam[] {
  if (!promptText || !promptText.trim()) return [];

  // 1. Try parsing JSON if present
  const jsonMatch = promptText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const list = Array.isArray(parsed) ? parsed : parsed.teams || parsed.roster;
      if (Array.isArray(list) && list.length >= 2) {
        return list
          .filter((item) => {
            const name = typeof item === 'string' ? item : item?.name;
            return name && !isInstructionLine(name);
          })
          .map((item, idx) => {
            if (typeof item === 'string') return { name: item.trim(), seed: idx + 1 };
            return {
              name: item.name || `Team ${idx + 1}`,
              college: item.college || item.school || undefined,
              seed: item.seed ?? idx + 1,
            };
          });
      }
    } catch {
      // Continue to line-by-line parsing
    }
  }

  // 2. Line by line parsing
  const lines = promptText.split(/\r?\n/);
  const detectedTeams: ExtractedTeam[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip section headers or instruction lines
    if (isInstructionLine(line)) {
      continue;
    }

    // Numbered or bulleted line: "1. Team Name" or "1) Team Name" or "- Team Name" or "• Team Name"
    const bulletMatch = line.match(/^(?:\[?\d+\]?[\.\)]|[-*•])\s+(.+)$/);

    if (bulletMatch) {
      let content = bulletMatch[1].trim().replace(/^["']|["']$/g, '');
      if (isInstructionLine(content)) {
        continue;
      }

      let name = content;
      let college: string | undefined;

      // Format: "Team Name - College Name"
      if (content.includes(' - ')) {
        const parts = content.split(' - ');
        name = parts[0].trim();
        college = parts.slice(1).join(' - ').trim();
      } else if (content.includes('(') && content.endsWith(')')) {
        const match = content.match(/^(.+?)\s*\((.+?)\)$/);
        if (match) {
          name = match[1].trim();
          college = match[2].trim();
        }
      }

      if (name.length > 0 && !isInstructionLine(name) && !name.toLowerCase().startsWith('team:')) {
        detectedTeams.push({
          name,
          college,
          seed: detectedTeams.length + 1,
        });
      }
    }
  }

  if (detectedTeams.length >= 2) {
    return detectedTeams;
  }

  // 3. Look for comma-separated teams after "teams:"
  const afterTeamsMatch = promptText.match(/(?:teams|roster|participants)\s*:\s*([^.\n]+)/i);
  if (afterTeamsMatch) {
    const rawList = afterTeamsMatch[1].split(/,|;/);
    const commaTeams = rawList
      .map((t) => t.trim().replace(/^["']|["']$/g, ''))
      .filter((t) => t.length > 1 && !isInstructionLine(t) && !/^(and|or)$/i.test(t));
    if (commaTeams.length >= 2) {
      return commaTeams.map((name, idx) => ({ name, seed: idx + 1 }));
    }
  }

  return [];
}

/**
 * Extracts tournament title from the prompt if user included one on first line
 */
export function extractTournamentTitle(promptText: string, fallback: string): string {
  const lines = promptText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    const firstLine = lines[0];
    if (
      !isInstructionLine(firstLine) &&
      !firstLine.toLowerCase().startsWith('teams') &&
      !firstLine.toLowerCase().startsWith('"teams') &&
      firstLine.length < 50
    ) {
      return firstLine.replace(/^["']|["']$/g, '');
    }
  }
  return fallback;
}

/**
 * Builds a tournament bracket that accommodates ANY arbitrary number of teams (e.g. 3, 5, 6, 7, 8, 10, 12, 16, etc.)
 * Uses standard competitive seeding: when team count is not a power of 2, the highest seeds
 * receive automatic BYEs to Round 2 and advance immediately.
 */
export function createBracketFromTeams({
  title,
  teams,
  gameName = 'Mobile Legends',
  format = 'Single Elimination',
  matchFormat = 'Bo3',
  finalMatchFormat = 'Bo5',
  seedingRule = 'Win Rate',
  explicitBracketSize,
}: {
  title: string;
  teams: ExtractedTeam[];
  gameName?: string;
  format?: string;
  matchFormat?: MatchFormat;
  finalMatchFormat?: MatchFormat;
  seedingRule?: string;
  explicitBracketSize?: number;
}): BracketDraft {
  const normalizedFormat = format.toLowerCase().replace(/[-_]/g, ' ');
  if (!['single elimination', 'double elimination', 'round robin'].includes(normalizedFormat)) throw new Error('Choose single elimination, double elimination, or round robin.');
  // Determine actual team count (supports ANY arbitrary number >= 2)
  const teamCount = explicitBracketSize ?? (teams.length >= 2 ? teams.length : detectTournamentSizeFromPrompt(title, teams.length));
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > MAX_BRACKET_TEAMS) {
    throw new Error(`Enter a whole number of teams from 2 to ${MAX_BRACKET_TEAMS}.`);
  }
  const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Next power of 2 for tree structure: 2, 4, 8, 16, 32, 64
  const bracketSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(teamCount))));

  // Prepare the effective teams list
  const effectiveTeams: ExtractedTeam[] = [...teams].slice(0, teamCount);

  // Leave unnamed slots neutral so the organizer always controls the roster.
  while (effectiveTeams.length < teamCount) {
    const idx = effectiveTeams.length;
    effectiveTeams.push({
      name: `Team ${idx + 1}`,
      seed: idx + 1,
    });
  }

  // Seeded teams array
  const seededTeams: Team[] = effectiveTeams.map((et, i) => ({
    id: `team-draft-${i + 1}`,
    name: et.name,
    collegeId: `col-${i + 1}`,
    collegeCode: et.college || `C${i + 1}`,
    gameId: 'game-1',
    seed: et.seed ?? i + 1,
    winRate: 0,
    record: '0W-0L',
    players: [],
  }));

  const matches: Match[] = [];
  const numRounds = Math.log2(bracketSize);

  const getRoundName = (roundIdx: number, totalRounds: number) => {
    const dist = totalRounds - 1 - roundIdx;
    if (dist === 0) return 'Grand Final';
    if (dist === 1) return 'Semifinals';
    if (dist === 2) return 'Quarterfinals';
    if (dist === 3) return 'Round of 16';
    if (dist === 4) return 'Round of 32';
    return `Round of ${Math.pow(2, dist + 1)}`;
  };

  let matchCounter = 1;
  const roundMatchIds: string[][] = [];

  for (let r = 0; r < numRounds; r++) {
    const matchesInRound = bracketSize / Math.pow(2, r + 1);
    const currentRoundIds: string[] = [];

    for (let m = 0; m < matchesInRound; m++) {
      const matchId = `${draftId}-M${matchCounter++}`;
      currentRoundIds.push(matchId);
    }
    roundMatchIds.push(currentRoundIds);
  }

  // Standard seeding pairing order for Round 1
  const seedOrder = getStandardSeedOrder(bracketSize);

  // Generate match nodes
  for (let r = 0; r < numRounds; r++) {
    const matchesInRound = roundMatchIds[r].length;
    const isGrandFinal = r === numRounds - 1;
    const rName = getRoundName(r, numRounds);
    const currentFmt: MatchFormat = isGrandFinal ? finalMatchFormat : matchFormat;

    for (let m = 0; m < matchesInRound; m++) {
      const matchId = roundMatchIds[r][m];
      const nextMatchId = !isGrandFinal ? roundMatchIds[r + 1][Math.floor(m / 2)] : undefined;

      let team1: Team | undefined = undefined;
      let team2: Team | undefined = undefined;
      let isByeMatch = false;
      let winnerId: string | undefined = undefined;
      let status: Match['status'] = 'upcoming';
      let score = { team1Score: 0, team2Score: 0 };

      if (r === 0) {
        const seed1 = seedOrder[m * 2];
        const seed2 = seedOrder[m * 2 + 1];

        if (seed1 <= teamCount) {
          team1 = seededTeams[seed1 - 1];
        }
        if (seed2 <= teamCount) {
          team2 = seededTeams[seed2 - 1];
        } else {
          // seed2 is an earned BYE for team1
          isByeMatch = true;
          team2 = {
            id: `bye-${matchId}`,
            name: 'BYE',
            collegeId: 'bye',
            collegeCode: 'BYE',
            gameId: 'game-1',
            seed: seed2,
            winRate: 0,
            record: '0W-0L',
            players: [],
            isBye: true,
          };
          if (team1) {
            winnerId = team1.id;
            status = 'completed';
            score = { team1Score: 1, team2Score: 0 };
          }
        }
      }

      matches.push({
        id: matchId,
        matchNumber: `#M${matchId.match(/-M(\d+)$/)?.[1]}`,
        tournamentId: draftId,
        gameId: 'game-draft',
        round: r + 1,
        roundName: rName,
        bracketType: isGrandFinal ? 'final' : 'upper',
        team1,
        team2,
        score,
        status,
        winnerId,
        matchFormat: currentFmt,
        scheduledTime: isByeMatch
          ? 'Automatic Advance'
          : isGrandFinal
          ? 'Grand Final'
          : `Round ${r + 1}`,
        scheduledDate: 'Day 1',
        organizerName: 'Tournament Admin',
        nextMatchId,
      });
    }
  }

  // Pre-seed Round 1 BYE winners directly into their Round 2 parent matches
  if (numRounds > 1) {
    const round1Matches = matches.filter((m) => m.round === 1);
    round1Matches.forEach((m) => {
      if (m.winnerId && m.nextMatchId) {
        const nextMatch = matches.find((nm) => nm.id === m.nextMatchId);
        if (nextMatch) {
          const winningTeam = m.winnerId === m.team1?.id ? m.team1 : m.team2;
          const destinationSlot = getAdvancementSlot(matches, m);
          if (destinationSlot === 1) {
            nextMatch.team1 = winningTeam;
          } else if (destinationSlot === 2) {
            nextMatch.team2 = winningTeam;
          }
        }
      }
    });
  }

  return {
    id: draftId,
    title,
    gameName,
    format,
    teamsCount: teamCount,
    matchFormat,
    seedingRule,
    matches: normalizedFormat === 'double elimination' ? doubleElimination(matches, finalMatchFormat) : normalizedFormat === 'round robin' ? roundRobin(seededTeams, matches[0], matchFormat) : matches,
    teams: effectiveTeams,
    parsedParams: {
      game: gameName,
      format,
      seeding: seedingRule,
      constraint: 'Keep same-college teams apart',
      teamsCount: teamCount,
      matchFormat,
    },
    rawPrompt: title,
    createdAt: 'Just now',
    status: 'draft',
  };
}

/**
 * Creates a clean prebuilt manual bracket with "Team 1", "Team 2", etc.
 * Accommodates ANY number of teams (e.g. 3, 5, 6, 7, 8, 10, 12, 16, etc.)
 */
export function createPrebuiltManualBracket({
  title = 'Untitled Bracket',
  teamCount = 8,
  format = 'Single Elimination',
  matchFormat = 'Bo3',
}: {
  title?: string;
  teamCount?: number;
  format?: string;
  matchFormat?: MatchFormat;
}): BracketDraft {
  const safeCount = teamCount;
  const teams: ExtractedTeam[] = [];
  for (let i = 1; i <= safeCount; i++) {
    teams.push({
      name: `Team ${i}`,
      seed: i,
    });
  }
  return createBracketFromTeams({
    title,
    teams,
    gameName: 'Esports Tournament',
    format,
    matchFormat,
    seedingRule: 'Manual Draw',
    explicitBracketSize: safeCount,
  });
}

/**
 * Parses team names and optional colleges/seeds from CSV format.
 */
export function parseTeamsFromCSV(csvText: string): ExtractedTeam[] {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const teams: ExtractedTeam[] = [];

  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if ((char === ',' || char === ';' || char === '\t') && !quoted) { cells.push(cell.trim()); cell = ''; }
      else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  };
  const firstCell = parseRow(lines[0])[0].toLowerCase();
  const hasHeader = ['team', 'team name', 'name', 'participant', 'participant name'].includes(firstCell);

  const startIndex = hasHeader ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const parts = parseRow(line);
    if (!parts[0]) continue;

    const name = parts[0];
    const college = parts[1] || undefined;
    const seed = parts[2] ? parseInt(parts[2], 10) : teams.length + 1;

    teams.push({
      name,
      college,
      seed: isNaN(seed) ? teams.length + 1 : seed,
    });
  }

  return teams;
}

/**
 * Adds late-joining teams (e.g. +2 teams) to an existing draft bracket,
 * expanding it to the next valid tournament size (4 -> 8, or 8 -> 16).
 */
export function addLateTeamsToDraft(
  draft: BracketDraft,
  additionalCount: number = 2
): BracketDraft {
  const round1Matches = draft.matches.filter((m) => m.round === 1);
  const existingTeams: ExtractedTeam[] = [];

  round1Matches.forEach((m) => {
    if (m.team1 && m.team1.name !== 'BYE') {
      existingTeams.push({
        name: m.team1.name,
        college: m.team1.collegeCode !== 'BYE' ? m.team1.collegeCode : undefined,
        seed: m.team1.seed,
      });
    }
    if (m.team2 && m.team2.name !== 'BYE') {
      existingTeams.push({
        name: m.team2.name,
        college: m.team2.collegeCode !== 'BYE' ? m.team2.collegeCode : undefined,
        seed: m.team2.seed,
      });
    }
  });

  const baseCount = existingTeams.length;
  for (let i = 1; i <= additionalCount; i++) {
    existingTeams.push({
      name: `Team ${baseCount + i}`,
      seed: baseCount + i,
    });
  }

  const totalCount = existingTeams.length;

  return createBracketFromTeams({
    title: draft.title,
    teams: existingTeams,
    gameName: draft.gameName,
    format: draft.format,
    matchFormat: (draft.matchFormat as MatchFormat) || 'Bo3',
    seedingRule: draft.seedingRule,
    explicitBracketSize: totalCount,
  });
}
