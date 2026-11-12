import type { Match } from './types';

export interface MatchScheduleUpdate {
  id: string;
  scheduledDate: string;
  scheduledTime: string;
}

export function parseStreamSchedule(source: string, matches: Match[]): MatchScheduleUpdate[] {
  const lines = source.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (/^"?match(?:_id|_number)"?\s*,\s*"?date"?\s*,\s*"?time"?$/i.test(lines[0] ?? '')) lines.shift();
  if (!lines.length || lines.length > 256) throw new Error('Enter between 1 and 256 match schedule rows.');
  const seen = new Set<string>();

  return lines.map((line, index) => {
    const row = line.match(/^"?([^",]+)"?\s*,\s*"?(\d{4}-\d{2}-\d{2})"?\s*,\s*"?([^",]+)"?$/)
      ?? line.match(/^(?:schedule\s+)?(?:match\s+)?(.+?)\s+on\s+(\d{4}-\d{2}-\d{2})\s+at\s+(.+)$/i);
    const fail = (message: string): never => { throw new Error(`Row ${index + 1}: ${message}`); };
    if (!row) return fail('Use a match ID, date (YYYY-MM-DD), and time.');
    const [, rawId, date, rawTime] = row;
    const id = rawId.trim().replace(/^#/, '').toLowerCase();
    const found = matches.filter(match =>
      [match.id, match.matchNumber].some(key => key.replace(/^#/, '').toLowerCase() === id)
    );
    if (found.length !== 1) return fail(found.length ? 'This match number is ambiguous. Use the full match ID.' : 'This match is outside the selected bracket or game.');
    const match = found[0];
    if (match.status === 'completed' || match.status === 'live') return fail('Only matches that have yet to start can be scheduled.');
    if (seen.has(match.id)) return fail('This match is listed more than once.');
    seen.add(match.id);

    const day = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return fail('Enter a valid calendar date.');
    const time = rawTime.trim().match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)?$/i);
    if (!time) return fail('Use a time such as 19:30 or 7:30 PM.');
    const hours = Number(time[1]);
    const suffix = time[3]?.toUpperCase();
    if (suffix ? hours < 1 || hours > 12 : hours > 23) return fail('Enter a valid time.');
    const hour24 = suffix ? hours % 12 + (suffix === 'PM' ? 12 : 0) : hours;
    return { id: match.id, scheduledDate: date, scheduledTime: `${String(hour24).padStart(2, '0')}:${time[2]}` };
  });
}
