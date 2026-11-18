// Match timeline and MVP, entered by organizers after (or during) a match. Pure functions only.
// Nothing here is generated: every event and the MVP come from what an organizer recorded.
import type { Match, MatchMVP, MatchTimelineEvent } from './types';
import { seriesPlayerStats } from './matchStats';

export const TIMELINE_TYPES = [
  { id: 'first-blood', label: 'First blood' },
  { id: 'tower', label: 'Tower or turret' },
  { id: 'lord', label: 'Lord, Roshan or boss' },
  { id: 'objective', label: 'Objective (Turtle, Tormentor, hardpoint)' },
  { id: 'ace', label: 'Ace or team wipe' },
  { id: 'other', label: 'Other' },
] as const;
export type TimelineType = typeof TIMELINE_TYPES[number]['id'];
export const MAX_TIMELINE_EVENTS = 60;

/** "12:35" → 755 seconds. Accepts up to 999 minutes. */
export function clockSeconds(time: string): number | null {
  const m = time.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const typeLabel = (type: string) => TIMELINE_TYPES.find(t => t.id === type)?.label || 'Event';
const teamCodes = (match: Match) => [match.team1?.collegeCode, match.team2?.collegeCode].filter((c): c is string => !!c);

/** One event as an organizer enters it. Returns the stored form or throws a readable error. */
export function timelineEvent(match: Match, input: { time: string; type: string; team: string; text: string }): MatchTimelineEvent {
  if (clockSeconds(input.time) === null) throw new Error('Enter the game time as minutes:seconds, for example 12:35.');
  if (!TIMELINE_TYPES.some(t => t.id === input.type)) throw new Error('Choose what happened.');
  if (input.team && !teamCodes(match).includes(input.team)) throw new Error('Choose one of the two teams in this match.');
  const text = input.text.trim();
  if (text.length < 3 || text.length > 200) throw new Error('Describe the event in 3 to 200 characters.');
  return { time: input.time.trim(), type: input.type, title: typeLabel(input.type), text, ...(input.team ? { team: input.team } : {}) };
}

/** Events in game-time order, at most MAX_TIMELINE_EVENTS. */
export function sortedTimeline(events: MatchTimelineEvent[]): MatchTimelineEvent[] {
  if (events.length > MAX_TIMELINE_EVENTS) throw new Error(`A match timeline holds up to ${MAX_TIMELINE_EVENTS} events.`);
  return [...events].sort((a, b) => (clockSeconds(a.time) ?? 0) - (clockSeconds(b.time) ?? 0));
}

export interface MvpCandidate { ign: string; role: string; teamCode: string; kda?: string }

/** Players who can be named MVP: the two published rosters, with series K/D/A when stats were entered. */
export function mvpCandidates(match: Match): MvpCandidate[] {
  const stats = seriesPlayerStats(match);
  return [match.team1, match.team2].flatMap(team => (team?.players || []).filter(p => p.ign).map(player => {
    const stat = stats[player.id];
    return {
      ign: player.ign, role: player.role || '', teamCode: team?.collegeCode || '',
      ...(stat ? { kda: `${stat.kills}/${stat.deaths}/${stat.assists}` } : {}),
    };
  }));
}

/** The public MVP record: in-game name only, never a real name (see tournamentDocs.publicMatch). */
export function matchMvp(match: Match, ign: string, highlight = ''): MatchMVP | undefined {
  if (!ign) return undefined;
  const candidate = mvpCandidates(match).find(c => c.ign === ign);
  if (!candidate) throw new Error('Choose the MVP from the two rosters in this match.');
  const note = highlight.trim();
  if (note.length > 120) throw new Error('Keep the MVP highlight under 120 characters.');
  return {
    playerName: candidate.ign, ign: candidate.ign, role: candidate.role, teamCode: candidate.teamCode,
    ...(candidate.kda ? { kda: candidate.kda } : {}), ...(note ? { statsHighlight: note } : {}),
  };
}
