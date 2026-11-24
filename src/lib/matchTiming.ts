/**
 * Time-of-day helpers for match scheduling, plus an estimate of when a match ends.
 * Times are minutes after midnight (Manila time, like the rest of the schedule).
 */

export type TimingGame = 'mlbb' | 'dota2' | 'codm-mp' | 'codm-br';

/** Typical length of one game including picks and setup. Real games vary; the UI says "about". */
export const TYPICAL_GAME_MINUTES: Record<TimingGame, number> = { mlbb: 20, dota2: 45, 'codm-mp': 15, 'codm-br': 25 };
export const UNKNOWN_GAME_MINUTES = 30;
/** Rest, side swap and lobby setup between games of the same match. */
export const BREAK_MINUTES = 10;
const DAY = 24 * 60;

export const GAME_TIMING_LABEL: Record<TimingGame, string> = { mlbb: 'Mobile Legends', dota2: 'Dota 2', 'codm-mp': 'CODM Multiplayer', 'codm-br': 'CODM Battle Royale' };

/** Works out the game from any mix of ids and names ("game-dota2", "CODM Battle Royale", a match's gameMode "br"). */
export function timingGame(...hints: Array<string | undefined | null>): TimingGame | undefined {
  const text = hints.filter(Boolean).join(' ').toLowerCase();
  if (/dota/.test(text)) return 'dota2';
  if (/mlbb|mobile legends/.test(text)) return 'mlbb';
  if (/codm|call of duty/.test(text)) return /battle royale|codm-br|\bbr\b/.test(text) ? 'codm-br' : 'codm-mp';
  if (/\bbr\b|battle royale/.test(text)) return 'codm-br';
  return undefined;
}

/** "Bo3" -> 3. Anything unreadable counts as a single game. */
export function gamesInFormat(format: string | undefined) {
  const n = Number(String(format || '').match(/^bo(\d+)$/i)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export type MatchEstimate = {
  start: number;
  /** End if one team wins every game it needs straight away. */
  earliestEnd: number;
  /** End if every game of the series is played. */
  latestEnd: number;
  gamesMin: number;
  gamesMax: number;
  gameMinutes: number;
  game?: TimingGame;
};

export function estimateMatch(start: number, matchFormat: string | undefined, game?: TimingGame): MatchEstimate {
  const gamesMax = gamesInFormat(matchFormat), gamesMin = Math.ceil(gamesMax / 2);
  const gameMinutes = game ? TYPICAL_GAME_MINUTES[game] : UNKNOWN_GAME_MINUTES;
  const length = (games: number) => games * gameMinutes + (games - 1) * BREAK_MINUTES;
  return { start, earliestEnd: start + length(gamesMin), latestEnd: start + length(gamesMax), gamesMin, gamesMax, gameMinutes, game };
}

/**
 * Reads what people type: "8pm", "8:30 pm", "8.30PM", "830pm", "20:30", "2030", "7:05 a.m.".
 * Without AM/PM it is read as a 24-hour time, so "8" is 8:00 AM and "20" is 8:00 PM.
 */
export function parseClock(raw: string): number | null {
  let text = raw.trim().toLowerCase();
  const half = text.match(/\s*([ap])\.?\s*(?:m\.?)?$/);
  const suffix = half ? (half[1] === 'p' ? 'pm' : 'am') : undefined;
  if (half) text = text.slice(0, half.index).trim();
  // "8", "8:30", "8.30", or the compact "830" / "2030" where the last two digits are minutes.
  const m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?$/) ?? text.match(/^(\d{1,2})(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2] || 0);
  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    return (hour % 12 + (suffix === 'pm' ? 12 : 0)) * 60 + minute;
  }
  return hour > 23 ? null : hour * 60 + minute;
}

/** 1230 -> "8:30 PM". Times past midnight say "next day". */
export function clockLabel(minutes: number) {
  const day = Math.floor(minutes / DAY), inDay = ((minutes % DAY) + DAY) % DAY;
  const hour = Math.floor(inDay / 60), minute = inDay % 60;
  const label = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
  return day > 0 ? `${label} next day` : label;
}

/** 1230 -> "20:30", the stored form. */
export function clock24(minutes: number) {
  const inDay = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`;
}

/** Every `step` minutes across the day, for the time list. */
export function clockOptions(step = 30) {
  return Array.from({ length: DAY / step }, (_, i) => i * step);
}

/** Does a list time fit what was typed so far? "7" fits 7:00 AM and 7:30 PM; "7:30 p" fits 7:30 PM; "19" fits 7:00 PM. */
export function timeMatchesTyped(minutes: number, typed: string) {
  const text = typed.trim().toLowerCase();
  if (!text) return true;
  const half = /p/.test(text) ? 'pm' : /a/.test(text) ? 'am' : '';
  const hour = Math.floor(minutes / 60), mm = String(minutes % 60).padStart(2, '0');
  if (half && (hour < 12 ? 'am' : 'pm') !== half) return false;
  const digits = text.replace(/\D/g, '');
  return [`${hour % 12 || 12}${mm}`, `${hour}${mm}`, `${String(hour).padStart(2, '0')}${mm}`].some(form => form.startsWith(digits));
}

/** "8:50 PM" or "8:50 to 9:30 PM" (the AM/PM is said once when both ends share it). */
export function endRangeLabel(estimate: Pick<MatchEstimate, 'earliestEnd' | 'latestEnd'>) {
  const early = clockLabel(estimate.earliestEnd), late = clockLabel(estimate.latestEnd);
  if (early === late) return late;
  const [earlyTime, ...earlyRest] = early.split(' '), lateRest = late.split(' ').slice(1);
  return `${earlyRest.join(' ') === lateRest.join(' ') ? earlyTime : early} to ${late}`;
}

/** "8:00 to 9:20 PM", or "11:30 AM to 12:40 PM" when the halves differ. */
export function rangeLabel(from: number, to: number) {
  return endRangeLabel({ earliestEnd: from, latestEnd: to });
}

/** 50 -> "50 min", 80 -> "1 h 20 min", 120 -> "2 h". */
export function durationLabel(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

export type MatchSlot = { start: number; end: number; endSet: boolean };

/** A scheduled match's time slot: the organizer's end time when set, otherwise the longest typical length. */
export function matchSlot(match: { scheduledTime?: string; scheduledEndTime?: string; matchFormat?: string }, game?: TimingGame): MatchSlot | null {
  const start = parseClock(match.scheduledTime || '');
  if (start === null) return null;
  const end = parseClock(match.scheduledEndTime || '');
  if (end !== null && end > start) return { start, end, endSet: true };
  return { start, end: estimateMatch(start, match.matchFormat, game).latestEnd, endSet: false };
}

/** "8:00 to 9:30 PM" for a set end, "8:00 PM to about 9:20 PM" for an estimate. */
export function slotLabel(slot: MatchSlot) {
  return slot.endSet ? rangeLabel(slot.start, slot.end) : `${clockLabel(slot.start)} to about ${clockLabel(slot.end)}`;
}

/** For schedules people read: "7:30 to 9:00 PM" when the organizer set an end, "7:30 PM" when not. Never shows an estimate. */
export function scheduleTimeLabel(match: { scheduledTime?: string; scheduledEndTime?: string }) {
  const slot = matchSlot(match);
  if (!slot) return match.scheduledTime || '';
  return slot.endSet ? rangeLabel(slot.start, slot.end) : clockLabel(slot.start);
}

/** Two matches overlap when one starts before the other could have ended. */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}
