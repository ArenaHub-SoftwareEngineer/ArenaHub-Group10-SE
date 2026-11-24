import type { BracketAppearance, TeamBadgeStyle } from './bracketAppearance';
import { teamBadgeColor } from './bracketAppearance';

export interface OpeningMatch {
  number: number;
  teams: [string, string];
}

const COLORS: Record<string, string> = {
  'electric blue': '#51a5ff', green: '#69c850', 'forest green': '#3c9d6c', orange: '#ff9a40',
  silver: '#aebcd0', 'black and red': '#e34d60', purple: '#bf80fb', teal: '#39bcbd',
  yellow: '#f6d653', 'hot pink': '#ff60b3', 'light gray': '#ced4df', 'light grey': '#ced4df',
  crimson: '#ef6260', 'bone white': '#f3e1c9', mint: '#72e4b1', 'flame orange': '#ff744a',
  indigo: '#9490ff', blue: '#81adff', red: '#ff7474', gold: '#edc16c', white: '#f1f2fa',
};

const ROW_PREFIX = /^(?:(?:[-*•]|\\-)\s+)?(?:\*\*)?(?:match\s*#?\s*|#m)(\d+)\s*[:.)-]\s*(?:\*\*)?\s*(.*)$/i;

function versus(text: string): [string, string] | undefined {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') depth--;
    if (depth !== 0 || !/\s/.test(text[i])) continue;
    const separator = text.slice(i).match(/^\s+(?:vs\.?|versus)\s+/i)?.[0];
    if (separator) return [text.slice(0, i), text.slice(i + separator.length)];
  }
}

function readSide(text: string): { name: string; style?: TeamBadgeStyle } {
  const value = text.trim().replace(/\*\*$/g, '');
  const details = value.match(/\s+\(([^()]*)\)\s*$/);
  const name = (details ? value.slice(0, details.index) : value).trim().replace(/^(?:["“]|\*\*)|(?:["”]|\*\*)$/g, '').trim();
  if (!details) return { name };
  const parts = details[1].split(',').map(part => part.trim()).filter(Boolean);
  const last = parts.at(-1)?.toLowerCase() || '';
  const color = COLORS[last] ?? teamBadgeColor(last);
  const motif = (color ? parts.slice(0, -1) : parts).join(', ').slice(0, 80);
  return { name, style: { ...(color && { color }), ...(motif && { motif }) } };
}

/** Numbered matchups are a direct placement instruction. Keep design notes separate from names. */
export function readBracketPromptDetails(prompt: string) {
  const openingMatches: OpeningMatch[] = [];
  const styles = new Map<string, TeamBadgeStyle>();
  const usedNumbers = new Set<number>(), usedTeams = new Set<string>();
  let problem = '', title = '';
  for (const line of prompt.split(/\r?\n/)) {
    const clean = line.trim().replace(/\\\s*$/, '');
    const label = clean.match(/^(?:(?:[-*•]|\\-)\s+)?(?:\*\*)?(?:tournament\s+)?title(?:\s+at\s+the\s+top)?\s*:\s*(?:\*\*)?\s*(.+)$/i);
    if (label && !title) title = label[1].trim().replace(/^(?:["“]|\*\*)|(?:["”]|\*\*)$/g, '').trim();
    const row = clean.match(ROW_PREFIX);
    if (!row) continue;
    const pair = versus(row[2]);
    if (!pair && !/\b(?:matchups?|pairings?)\b/i.test(prompt)) continue;
    const number = Number(row[1]);
    if (!pair || number < 1 || usedNumbers.has(number)) {
      problem ||= `Check Match ${number}. Use each match number once and write it as “Match ${number}: Team A vs Team B”.`;
      continue;
    }
    const [left, right] = pair.map(readSide);
    const keys = [left.name.toLowerCase(), right.name.toLowerCase()];
    if (keys.some(key => !key || key === 'bye') || left.name.length > 80 || right.name.length > 80) {
      problem ||= `Enter two team names of up to 80 characters for Match ${number}.`;
      continue;
    }
    if (keys[0] === keys[1] || keys.some(key => usedTeams.has(key))) {
      problem ||= `A team appears more than once in the opening matchups. Check Match ${number}.`;
      continue;
    }
    usedNumbers.add(number);
    keys.forEach(key => usedTeams.add(key));
    if (left.style) styles.set(keys[0], left.style);
    if (right.style) styles.set(keys[1], right.style);
    openingMatches.push({ number, teams: [left.name, right.name] });
  }
  openingMatches.sort((a, b) => a.number - b.number);

  const appearance: Omit<BracketAppearance, 'teams'> = {};
  if (/\bnavy\b/i.test(prompt) && /\bpurple\b/i.test(prompt) && /\bgold\b/i.test(prompt)) appearance.theme = 'navy-gold';
  if (/\b16\s*[:x×]\s*9\b/i.test(prompt)) appearance.wideImage = true;
  if (/\bfooter\b/i.test(prompt) && /\b(?:date|prize|sponsors?)\b/i.test(prompt)) appearance.exportFooter = true;
  return { openingMatches, styles, problem, title, appearance };
}
