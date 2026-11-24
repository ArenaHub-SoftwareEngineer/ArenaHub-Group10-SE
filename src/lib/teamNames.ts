// Team names in one bracket must be unique (case, spacing and surrounding spaces ignored), so spectators, standings
// and "Winner of" slots never point at two different teams with the same name. BYE and placeholder slots are skipped.
import type { BracketDraft, Team } from './types';

const PLACEHOLDER = /^(?:bye|tbd|to be decided|awaiting team)$/i;
export const teamNameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export interface DuplicateTeamName { name: string; count: number; ids: string[] }

/** Groups names that appear for more than one entry. `entries` are { id, name }; the same id counted once. */
export function duplicateNames(entries: Array<{ id: string; name: string }>): DuplicateTeamName[] {
  const groups = new Map<string, { name: string; ids: Set<string> }>();
  for (const { id, name } of entries) {
    const key = teamNameKey(name || '');
    if (!key || PLACEHOLDER.test(key)) continue;
    const group = groups.get(key) ?? { name: name.trim().replace(/\s+/g, ' '), ids: new Set<string>() };
    group.ids.add(id);
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.ids.size > 1).map(group => ({ name: group.name, count: group.ids.size, ids: [...group.ids] }));
}

type DraftTeams = Pick<BracketDraft, 'matches' | 'teams'> & Partial<Pick<BracketDraft, 'rosterTeams'>>;

/** Every real team in a draft, one entry per team id (a team that advances appears in several matches). */
export function draftTeamEntries(draft: DraftTeams): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  const add = (team?: Team | null) => { if (team && !team.isBye && team.id) byId.set(team.id, team.name || ''); };
  for (const match of draft.matches || []) { add(match.team1); add(match.team2); match.lobby?.teams?.forEach(add); }
  draft.rosterTeams?.forEach(add);
  if (byId.size) return [...byId].map(([id, name]) => ({ id, name }));
  return (draft.teams || []).map((team, index) => ({ id: `team-${index}`, name: team.name || '' }));
}

export const duplicateTeamNames = (draft: DraftTeams) => duplicateNames(draftTeamEntries(draft));

/** The message to show, or null when every team has a unique, non-empty name. */
export function teamNameProblem(draft: DraftTeams): string | null {
  const entries = draftTeamEntries(draft);
  const blank = entries.filter(entry => !entry.name.trim()).length;
  if (blank) return `${blank === 1 ? 'A team has' : `${blank} teams have`} no name. Give every team a name.`;
  return duplicateMessage(duplicateNames(entries));
}

export function duplicateMessage(duplicates: DuplicateTeamName[]): string | null {
  if (!duplicates.length) return null;
  const list = duplicates.slice(0, 3).map(item => `"${item.name}" (${item.count} teams)`).join(', ');
  const more = duplicates.length > 3 ? ` and ${duplicates.length - 3} more` : '';
  return `Team names must be unique. ${list}${more} ${duplicates.length === 1 ? 'is' : 'are'} used more than once. Rename them before continuing.`;
}

/** Throws with a readable message when names are missing or repeated. */
export function assertUniqueTeamNames(draft: DraftTeams): void {
  const problem = teamNameProblem(draft);
  if (problem) throw new Error(problem);
}
