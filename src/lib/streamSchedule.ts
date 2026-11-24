import type { Match } from './types';
import { matchName } from './matchName';
import { manilaToday, scheduleDate } from './calendar';
import { parseClock } from './matchTiming';

export interface MatchScheduleUpdate {
  id: string;
  scheduledDate: string;
  scheduledTime: string;
  /** Planned end ("HH:MM"), set by the organizer. '' when none was given; a new start time clears an old end. */
  scheduledEndTime: string;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export const isScheduleMatch = (match: Match) => !match.inactive && !match.lobby
  && ![match.team1, match.team2].some(team => team?.isBye || /^bye$/i.test(team?.name ?? ''));

function validDay(raw: string, today: string): string | null {
  const date = raw.trim().replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const iso = /^tomorrow$/i.test(date) ? next.toISOString().slice(0, 10) : scheduleDate(date, today);
  if (!iso) return null;
  const day = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === iso ? iso : null;
}

export const hasMatchSchedule = (match: Match, today = manilaToday()) =>
  Boolean(validDay(match.scheduledDate || '', today)) && parseClock(match.scheduledTime || '') !== null;

export const missingMatchSchedules = (matches: Match[]) => {
  const today = manilaToday();
  return matches.filter(match => isScheduleMatch(match) && !hasMatchSchedule(match, today));
};

export const canEditMatchSchedule = (match: Match, includeStarted = false) => isScheduleMatch(match)
  && (includeStarted || (match.status !== 'live' && match.status !== 'completed'));

export function applyMatchSchedules(matches: Match[], updates: MatchScheduleUpdate[], includeStarted = false): Match[] {
  const byId = new Map(updates.map(update => [update.id, update]));
  return matches.map(match => {
    const update = byId.get(match.id);
    if (!update || !canEditMatchSchedule(match, includeStarted)) return match;
    const { scheduledDate, scheduledTime, scheduledEndTime } = update;
    return { ...match, scheduledDate, scheduledTime, scheduledEndTime };
  });
}

export function splitBracketSchedule(prompt: string) {
  const lines = prompt.split(/\r?\n|;\s*(?=(?:and\s+)?(?:schedule\s|(?:lower\s+)?match\s+\d+|grand\s+final)\b)|[.!?,]\s+(?=(?:and\s+)?schedule\s)|\s+(?=and\s+schedule\s)/i);
  const bracket: string[] = [], schedule: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim().replace(/^and\s+(?=schedule\s)/i, '');
    if (/^schedule\s+(?:all\b|(?:remaining\s+|unscheduled\s+)?match(?:es)?\b|round\s+\d|lower match|grand final)/i.test(trimmed)
      || (schedule.length && /^(?:match\s+\d+|lower match\s+\d+|grand final)\b.*\bat\s/i.test(trimmed))) schedule.push(trimmed);
    else bracket.push(line);
  }
  return { bracket: bracket.join('\n').trim(), schedule: schedule.join('\n') };
}

export function parseStreamSchedule(source: string, matches: Match[], today = manilaToday(), includeStarted = false): MatchScheduleUpdate[] {
  const lines = source.trim().split(/\r?\n|;|,\s+(?=(?:and\s+)?(?:schedule\s+)?match\s+\d+\s)/i)
    .map(line => line.trim().replace(/[.!]$/, '')).filter(Boolean);
  if (/^"?match(?:_id|_number)"?\s*,\s*"?date"?\s*,\s*"?(?:start_)?time"?(?:\s*,\s*"?end(?:_time)?"?)?$/i.test(lines[0] ?? '')) lines.shift();
  if (!lines.length || lines.length > 1100) throw new Error('Enter between 1 and 1,100 match schedule rows.');
  const seen = new Set<string>();
  let previousDate: string | null = null;

  return lines.flatMap((line, index) => {
    const fail = (message: string): never => { throw new Error(`Row ${index + 1}: ${message}`); };
    const remember = (match: Match) => {
      if (!isScheduleMatch(match)) return fail('Choose a playable match.');
      if (!canEditMatchSchedule(match, includeStarted)) return fail('Only matches that have yet to start can be scheduled.');
      if (seen.has(match.id)) return fail('This match is listed more than once.');
      seen.add(match.id);
    };
    const sequence = line.match(/^(?:schedule\s+)?(?:(?:all\s+)?(?:remaining\s+|unscheduled\s+)?matches|round\s+(\d+)(?:\s+matches)?)\s+(?:on\s+)?(.+?)\s+start(?:ing)?\s+(?:at\s+)?(.+?)[, ]*\s+every\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)$/i);
    if (sequence) {
      const [, round, rawDate, rawStart, count, unit] = sequence;
      const date = validDay(rawDate, today) ?? fail('Enter a valid calendar date.');
      const start = parseClock(rawStart) ?? fail('Enter a valid time, such as 19:30 or 7:30 PM.');
      const interval = Number(count) * (/^h/i.test(unit) ? 60 : 1);
      if (interval < 1 || interval >= 1440) return fail('Enter a match interval under 24 hours.');
      const available = matches.filter(match => canEditMatchSchedule(match, includeStarted) && !hasMatchSchedule(match, today) && !seen.has(match.id)
        && (!round || match.round === Number(round)));
      if (!available.length) return fail('There are no unscheduled matches for this selection.');
      if (start + (available.length - 1) * interval >= 1440) return fail('These matches run past midnight. Split them across dates or schedule one round at a time.');
      previousDate = date;
      return available.map((match, i) => {
        remember(match);
        return { id: match.id, scheduledDate: date, scheduledTime: hhmm(start + i * interval), scheduledEndTime: '' };
      });
    }

    const row = line.match(/^"?([^",]+)"?\s*,\s*"?(\d{4}-\d{2}-\d{2})"?\s*,\s*"?([^",]+)"?(?:\s*,\s*"?([^",]*)"?)?$/)
      ?? line.match(/^(?:and\s+)?(?:schedule\s+)?(?:match\s+)?(.+?)(?:\s+on\s+(.+?))?\s+at\s+(.+?)(?:\s+(?:to|until)\s+(.+))?$/i);
    if (!row) return fail('Try “Match 1 on Dec 4 at 7:30 PM” or “Schedule all matches on Dec 4 starting at 8 AM every 90 minutes”.');
    const [, rawId, rawDate, rawTime, rawEnd = ''] = row;
    const id = rawId.trim().replace(/^#/, '').toLowerCase();
    const found = matches.filter(match =>
      [match.id, match.matchNumber, matchName(match), matchName(match).replace(/^match\s+/i, '')].some(key => key.replace(/^#/, '').toLowerCase() === id)
    );
    if (found.length !== 1) return fail(found.length ? 'This match number is ambiguous. Use the full match ID.' : 'This match is outside the selected bracket or game.');
    const match = found[0];
    remember(match);
    const date = (rawDate ? validDay(rawDate, today) : previousDate) ?? fail('Enter a valid calendar date.');
    previousDate = date;
    const start = parseClock(rawTime) ?? fail('Enter a valid time, such as 19:30 or 7:30 PM.');
    let end = '';
    if (rawEnd.trim()) {
      const minutes = parseClock(rawEnd) ?? fail('Use an end time such as 21:00 or 9:00 PM.');
      if (minutes <= start) return fail('The end time must be later than the start time.');
      end = hhmm(minutes);
    }
    return [{ id: match.id, scheduledDate: date, scheduledTime: hhmm(start), scheduledEndTime: end }];
  });
}
