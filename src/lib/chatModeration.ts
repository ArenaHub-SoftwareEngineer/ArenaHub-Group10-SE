// Pure chat-moderation helpers. No Firebase imports, so unit tests run without an emulator.
// The same limits are enforced in firestore.rules; these helpers only drive the UI.

/** Staff mute presets in minutes. 20 is the proposal's default. */
export const MUTE_PRESETS = [5, 10, 20, 60] as const;
export const DEFAULT_MUTE_MINUTES = 20;
/** A kick removes the viewer's recent messages and blocks posting for the rest of the event day. */
export const KICK_HOURS = 6;
/** Slow-mode choices in seconds. 0 means off; the rules still keep a 2 second floor between messages. */
export const SLOW_MODE_OPTIONS = [0, 10, 30, 60, 120] as const;
export const MIN_MESSAGE_GAP_SEC = 2;

export const STAFF_ROLES = ['admin', 'organizer', 'school-admin', 'moderator'] as const;
export const isStaffRole = (role: string | undefined) => !!role && (STAFF_ROLES as readonly string[]).includes(role);

/** Matches the rules' reserved-name check: "Arena AI", "arena-ai", "[ArenaAI]" and similar. */
export function isReservedChatName(name: string) {
  return /^[^a-z0-9]*arena[^a-z0-9]*ai[^a-z0-9]*$/.test(name.toLowerCase());
}

/** Seconds left on a mute, or 0 when it has expired. */
export function muteSecondsLeft(untilMs: number | undefined, nowMs: number) {
  if (!untilMs) return 0;
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

/** Seconds until this viewer may post again under the current slow mode. Staff are exempt. */
export function slowModeSecondsLeft(lastMessageMs: number | undefined, slowModeSec: number, nowMs: number, staff = false) {
  if (staff || !lastMessageMs) return 0;
  const gap = Math.max(slowModeSec, MIN_MESSAGE_GAP_SEC) * 1000;
  return Math.max(0, Math.ceil((lastMessageMs + gap - nowMs) / 1000));
}

/** "19:42" for a countdown, "1:05:00" past an hour. */
export function formatCountdown(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Message time shown in the chat log, in Philippine time. */
export function formatChatTime(ms: number | undefined) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
}

export function slowModeLabel(sec: number) {
  if (!sec) return 'Off';
  return sec < 60 ? `${sec} seconds` : `${sec / 60} minute${sec === 60 ? '' : 's'}`;
}

/** "@Arena what's the score" -> "what's the score". Null when the message is not a question for Arena AI. */
export function arenaQuestion(text: string): string | null {
  const match = text.trim().match(/^@arena(?:[\s_-]*ai)?(?![a-z0-9])[\s,:-]*(.*)$/is);
  const question = match?.[1].trim();
  return question ? question.slice(0, 500) : null;
}

export type ModerationAction =
  | { kind: 'mute'; minutes: number }
  | { kind: 'kick' }
  | { kind: 'unmute' }
  | { kind: 'delete' }
  | { kind: 'pin' }
  | { kind: 'unpin' }
  | { kind: 'slow-mode'; seconds: number }
  | { kind: 'ai'; enabled: boolean };

/** Audit line written with every moderation action. Uses ids, never names or emails. */
export function auditLine(matchId: string, action: ModerationAction, target = '') {
  const detail = action.kind === 'mute' ? ` ${action.minutes} min`
    : action.kind === 'kick' ? ` ${KICK_HOURS} h`
    : action.kind === 'slow-mode' ? ` ${action.seconds} s`
    : action.kind === 'ai' ? (action.enabled ? ' on' : ' off') : '';
  return `Chat ${action.kind}${detail} in match ${matchId}${target ? ` (target ${target})` : ''}`.slice(0, 1500);
}
