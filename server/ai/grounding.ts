// Fact check for model replies, against the published records. Sentence by sentence:
//   - a score next to a known team must be a recorded score of one of that team's matches (or its
//     game record in the standings);
//   - "X vs Y", "X beat Y" and similar must be a match that exists;
//   - a known team paired with a name that is not in the records is an invented opponent.
// General text ("a Bo3 can end 2-1") names no team and is not checked. Used by the pipeline to stop
// a model answer before an unsupported sentence reaches a viewer, and by the evals.
import type { BracketDraft, Match } from '../../src/lib/types.ts';
import { getStandings } from '../../src/lib/standings.ts';
import { bracketTeams } from '../../src/lib/data/tournamentDocs.ts';

export interface GroundingFacts {
  /** Lower-case team and squad names, longest first so "Crimson Wolves B" wins over "Crimson Wolves". */
  teams: string[];
  pairs: Set<string>;
  /** Lower-case college codes ("ccs"): "Golden Lions from CLA against ..." names a college, not a team. */
  colleges: Set<string>;
  /** Per team: scores of its matches, both orders, and its game record. */
  scores: Map<string, Set<string>>;
}

const PLACEHOLDERS = ['awaiting team', 'to be decided', 'tbd', 'bye'];
const key = (a: string, b: string) => [a, b].sort().join('|');

export function groundingFacts(brackets: BracketDraft[]): GroundingFacts {
  const teams = new Set<string>(), pairs = new Set<string>(), scores = new Map<string, Set<string>>(), colleges = new Set<string>();
  const addScore = (team: string, a: number, b: number) => {
    const set = scores.get(team) || new Set<string>();
    set.add(`${a}-${b}`); set.add(`${b}-${a}`);
    scores.set(team, set);
  };
  for (const b of brackets) {
    for (const t of b.placement?.teams || []) { teams.add(t.name.toLowerCase()); if (t.collegeCode) colleges.add(t.collegeCode.toLowerCase()); }
    for (const t of bracketTeams(b)) { teams.add(t.name.toLowerCase()); if (t.collegeCode) colleges.add(t.collegeCode.toLowerCase()); }
    for (const m of b.matches as Match[]) {
      const one = m.team1?.name?.toLowerCase(), two = m.team2?.name?.toLowerCase();
      if (one && two) pairs.add(key(one, two));
      const scored = m.status !== 'upcoming' && [m.score?.team1Score, m.score?.team2Score].every(Number.isFinite);
      if (scored) for (const t of [one, two]) if (t) addScore(t, m.score.team1Score, m.score.team2Score);
    }
    if (!b.placement) for (const row of getStandings(b.matches)) addScore(row.team.name.toLowerCase(), row.gameWins, row.gameLosses);
  }
  return { teams: [...teams].filter(t => t.length >= 3).sort((a, b) => b.length - a.length), pairs, scores, colleges };
}

const SCORE = /(?<![\d:/-])(\d{1,2})\s?[-–]\s?(\d{1,2})(?![\d:/-])/g;
const SCORE_WORDS = /(?<![\d:/-])(\d{1,2}) to (\d{1,2})(?![\d:/-])/g;
const RESULT_WORDS = /\b(score|scored|won|win|wins|beat|beats|defeated|lead|leads|leading|ended|series|final|nanalo|panalo|lamang)\b/i;
// Capitalised name (up to four words) on each side of a match-up word.
const NAME = String.raw`((?:[A-Z0-9][\w'.&]*\s){0,3}[A-Z0-9][\w'.&]*)`;
const MATCHUP = new RegExp(`${NAME}\\s+(?:vs\\.?|versus|against|beat|beats|defeated|defeats|eliminated|edged|swept|faces|face|played|plays)\\s+(?:the\\s+)?${NAME}`, 'g');

function teamsIn(sentence: string, facts: GroundingFacts) {
  let rest = sentence.toLowerCase();
  const found: string[] = [];
  for (const team of facts.teams) if (rest.includes(team)) { found.push(team); rest = rest.split(team).join(' '); }
  return found;
}
/** The known team a captured name refers to, '' for a placeholder, or null when it is not a team in the records. */
function resolve(name: string, facts: GroundingFacts): string | null {
  const lower = name.toLowerCase().replace(/^the\s+/, '').replace(/[.,;:!?'’]+$/, '').trim();
  if (PLACEHOLDERS.some(p => lower.includes(p)) || /^(?:awaiting|winner|loser|tbd|team \d+)\b/.test(lower)) return '';
  // A college code, a game or a round is not a claimed opponent.
  if (facts.colleges.has(lower) || /^(?:mlbb|dota|codm|game \d+|round \d+|semifinals?|finals?|grand final|upper|lower)\b/.test(lower)) return '';
  return facts.teams.find(t => lower === t || lower.endsWith(` ${t}`) || lower.startsWith(`${t} `)) ?? null;
}

export class UngroundedSentence extends Error {
  constructor(readonly problems: string[]) { super(`Unsupported by the records: ${problems.join('; ')}`); }
}

/**
 * Holds streamed text until a sentence ends, checks it, and only then lets it out. A sentence that
 * the records do not support throws UngroundedSentence, so it never reaches a viewer.
 */
export class SentenceGate {
  private pending = '';
  constructor(private readonly facts: GroundingFacts) {}
  push(text: string): string {
    if (!text) return '';
    this.pending += text;
    // A sentence ends at . ! ? before whitespace (not "vs."), or at a line break.
    let cut = -1;
    for (const m of this.pending.matchAll(/(?<!\bvs)[.!?](?=\s)|\n/g)) cut = m.index! + 1;
    if (cut < 0) return '';
    const ready = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
    return this.check(ready);
  }
  flush(): string {
    const rest = this.pending;
    this.pending = '';
    return rest ? this.check(rest) : '';
  }
  private check(text: string) {
    const problems = groundingProblems(text, this.facts);
    if (problems.length) throw new UngroundedSentence(problems);
    return text;
  }
}

export function groundingProblems(text: string, source: BracketDraft[] | GroundingFacts): string[] {
  const facts = Array.isArray(source) ? groundingFacts(source) : source;
  const problems: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim())) {
    const named = teamsIn(sentence, facts);
    if (named.length) {
      // "2-1", and "2 to 1" when the sentence is about a result.
      const scores = [...sentence.matchAll(SCORE)].map(m => `${m[1]}-${m[2]}`);
      if (RESULT_WORDS.test(sentence)) for (const m of sentence.matchAll(SCORE_WORDS)) scores.push(`${m[1]}-${m[2]}`);
      for (const score of scores) {
        if (!named.some(t => facts.scores.get(t)?.has(score))) problems.push(`score ${score} is not recorded for ${named.join(' or ')}`);
      }
    }
    for (const m of sentence.matchAll(MATCHUP)) {
      const a = resolve(m[1], facts), b = resolve(m[2], facts);
      if (a === '' || b === '') continue;
      if (a && b) { if (!facts.pairs.has(key(a, b))) problems.push(`no recorded match between ${a} and ${b}`); }
      else if (a || b) problems.push(`"${a ? m[2] : m[1]}" is not a team in the records`);
    }
  }
  return [...new Set(problems)];
}
