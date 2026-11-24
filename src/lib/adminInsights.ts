// What the admin Overview, the Logs page and the Users page derive from shared state:
// - one system log built from staff audit events, new sign-ups and community reports, each with a category and a colour tone;
// - account totals by status, role and college;
// - the match map drawn by the Overview's 3D scene (one lane per published bracket, one tile per match).
// Pure functions only (types imported, no Firebase), so they are unit-tested in tests/admin-insights.test.ts.
import type { AuditLogItem, BracketDraft, ContentReport, Match, User, UserRole } from './types';

/** Colour family of an entry. Maps to the design tokens: --success, --warning, --danger, --info, --brand, --violet, --live. */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'violet' | 'live' | 'neutral';
export type LogCategory = 'matches' | 'brackets' | 'broadcast' | 'accounts' | 'moderation' | 'content' | 'system';

export const LOG_CATEGORIES: { id: LogCategory; label: string }[] = [
  { id: 'matches', label: 'Matches' },
  { id: 'brackets', label: 'Brackets' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'content', label: 'Content' },
  { id: 'system', label: 'Other' },
];

export interface LogEntry {
  id: string;
  category: LogCategory;
  tone: Tone;
  actor: string;
  text: string;
  /** Milliseconds; entries without a time sort last. */
  at?: number;
  /** Where "Open" goes: an admin tab id. */
  tab?: string;
}

// Order matters: the first rule that matches wins ("Unpublished bracket" before "Published bracket").
const RULES: [RegExp, LogCategory, Tone][] = [
  [/community report .*: ?remove_and_ban/i, 'moderation', 'danger'],
  [/community report .*: ?remove/i, 'moderation', 'warning'],
  [/community report/i, 'moderation', 'neutral'],
  [/marked as banned/i, 'accounts', 'danger'],
  [/marked as suspended/i, 'accounts', 'warning'],
  [/marked as active/i, 'accounts', 'success'],
  [/stream disconnected/i, 'broadcast', 'warning'],
  [/stream|broadcast/i, 'broadcast', 'violet'],
  [/unpublished bracket|deleted saved bracket/i, 'brackets', 'danger'],
  [/published bracket|restored bracket/i, 'brackets', 'success'],
  [/bracket/i, 'brackets', 'brand'],
  [/status updated to live/i, 'matches', 'live'],
  [/status updated to completed/i, 'matches', 'success'],
  [/status updated to alert/i, 'matches', 'warning'],
  [/score|status updated|stats saved|timeline|schedule|mvp/i, 'matches', 'info'],
  [/removed (game|spotlight)/i, 'content', 'danger'],
  [/game title|spotlight|highlight|tournament|added /i, 'content', 'info'],
];

const TAB_FOR: Record<LogCategory, string | undefined> = {
  matches: 'bracket-studio', brackets: 'bracket-studio', broadcast: 'live-stream', accounts: 'users',
  moderation: 'reports', content: undefined, system: undefined,
};

export function classify(action: string): { category: LogCategory; tone: Tone } {
  const rule = RULES.find(([pattern]) => pattern.test(action));
  return rule ? { category: rule[1], tone: rule[2] } : { category: 'system', tone: 'neutral' };
}

const REPORT_ACTIONS: Record<string, string> = {
  remove_and_ban: 'content removed and the author banned',
  remove: 'content removed',
  dismiss: 'dismissed',
};

/** Readable text: match ids become "Team A vs Team B", report actions become words. */
export function humanize(action: string, matchNames: Map<string, string>): string {
  const report = action.match(/^Community report \S+: ?(\w+)$/i);
  if (report) return `Resolved a chat report: ${REPORT_ACTIONS[report[1]] || report[1]}`;
  const marked = action.match(/^(.+) marked as (\w+)$/);
  if (marked) return `changed ${marked[1]}'s status to ${marked[2]}`;
  const status = action.match(/^Match (\S+) status updated to (\S+)$/);
  if (status && matchNames.has(status[1])) return `${matchNames.get(status[1])} is now ${status[2].replace('-', ' ')}`;
  return action.replace(/\b(match) (\S+)$/i, (all, word: string, id: string) => matchNames.has(id) ? `${word} ${matchNames.get(id)}` : all);
}

/** Firebase uids are 28 characters with no spaces; anything that looks like one is not shown as a name. */
const looksLikeId = (value: string) => /^[A-Za-z0-9_-]{20,}$/.test(value);

export function buildSystemLog(input: {
  auditLogs: AuditLogItem[];
  users: User[];
  reports: ContentReport[];
  brackets?: BracketDraft[];
}): LogEntry[] {
  const names = new Map(input.users.map(user => [user.id, user.name]));
  const matchNames = new Map((input.brackets || []).flatMap(bracket => bracket.matches.map(match => [match.id, matchup(match)] as const)));
  const fixtureTitles = new Set(input.brackets?.filter(bracket => bracket.demo).map(bracket => bracket.title));
  const audit = input.auditLogs.map<LogEntry>(log => {
    const { category, tone } = classify(log.action);
    const actor = names.get(log.actor) || (looksLikeId(log.actor) ? 'Staff member' : log.actor || 'Staff member');
    const action = log.action.replace(/(\bbracket ")DEMO\s+([^"]+)"/gi, (original, prefix: string, title: string) =>
      fixtureTitles.has(title) ? `${prefix}${title}"` : original);
    return { id: log.id, category, tone, actor, text: humanize(action, matchNames), at: log.at, tab: TAB_FOR[category] };
  });
  const signups = input.users.filter(user => user.joinedAt).map<LogEntry>(user => ({
    id: `joined-${user.id}`, category: 'accounts', tone: 'success', actor: user.name,
    text: `created an account${user.collegeName ? ` · ${user.collegeName}` : ''}`, at: user.joinedAt, tab: 'users',
  }));
  const reports = input.reports.filter(report => report.createdAt).map<LogEntry>(report => ({
    id: `report-${report.id}`, category: 'moderation', tone: report.status === 'open' ? 'danger' : 'neutral', actor: 'A viewer',
    text: `reported a chat message by ${report.postedBy}${report.status === 'open' ? '' : ' (resolved)'}`, at: report.createdAt, tab: 'reports',
  }));
  return [...audit, ...signups, ...reports].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

const MANILA = 'Asia/Manila';
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: MANILA });

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "Nov 18". */
export function relativeTime(at: number | undefined, now: number): string {
  if (!at) return 'Earlier';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (dayKey(at) === dayKey(now)) return `${Math.floor(seconds / 3600)} h ago`;
  if (dayKey(at) === dayKey(now - 86_400_000)) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-PH', { timeZone: MANILA, month: 'short', day: 'numeric' });
}

export function clockTime(at: number | undefined): string {
  return at ? new Date(at).toLocaleTimeString('en-PH', { timeZone: MANILA, hour: 'numeric', minute: '2-digit' }) : '';
}

/** Entries grouped under "Today", "Yesterday" or a date, newest group first. */
export function groupByDay(entries: LogEntry[], now: number): { key: string; label: string; entries: LogEntry[] }[] {
  const groups = new Map<string, { key: string; label: string; entries: LogEntry[] }>();
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  for (const entry of entries) {
    const key = entry.at ? dayKey(entry.at) : 'earlier';
    let group = groups.get(key);
    if (!group) {
      const label = !entry.at ? 'Date unavailable' : key === today ? 'Today' : key === yesterday ? 'Yesterday'
        : new Date(entry.at).toLocaleDateString('en-PH', { timeZone: MANILA, month: 'short', day: 'numeric', year: 'numeric' });
      group = { key, label, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

// ---------- Accounts ----------

export const STAFF_ROLES: UserRole[] = ['admin', 'organizer', 'moderator', 'school-admin'];
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin', organizer: 'Organizer', moderator: 'Moderator', 'school-admin': 'School admin',
  player: 'Player', spectator: 'Spectator', user: 'Member',
};

export interface UserSummary {
  total: number;
  active: number;
  suspended: number;
  banned: number;
  staff: number;
  newThisWeek: number;
  roles: { role: UserRole; count: number }[];
  colleges: { name: string; count: number }[];
  newest: User[];
}

export function summarizeUsers(users: User[], now: number): UserSummary {
  const count = (fn: (user: User) => boolean) => users.filter(fn).length;
  const roles = new Map<UserRole, number>();
  const colleges = new Map<string, number>();
  for (const user of users) {
    roles.set(user.role, (roles.get(user.role) || 0) + 1);
    const college = user.collegeName.replace(/^College of /, '').trim() || 'No college';
    colleges.set(college, (colleges.get(college) || 0) + 1);
  }
  return {
    total: users.length,
    active: count(user => user.status === 'active'),
    suspended: count(user => user.status === 'suspended'),
    banned: count(user => user.status === 'banned'),
    staff: count(user => STAFF_ROLES.includes(user.role)),
    newThisWeek: count(user => Boolean(user.joinedAt && now - user.joinedAt < 7 * 86_400_000)),
    roles: [...roles].map(([role, total]) => ({ role, count: total })).sort((a, b) => b.count - a.count),
    colleges: [...colleges].map(([name, total]) => ({ name, count: total })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    newest: [...users].filter(user => user.joinedAt).sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0)).slice(0, 5),
  };
}

// ---------- Match map (3D scene on the Overview) ----------

export type TileState = 'done' | 'live' | 'alert' | 'scheduled' | 'pending';
export interface MapTile { id: string; state: TileState; label: string; detail: string }
export interface MapLane { id: string; label: string; tiles: MapTile[] }

export const isBye = (match: Match) => [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE');
export const matchup = (match: Match) => `${match.team1?.name || 'Awaiting team'} vs ${match.team2?.name || 'Awaiting team'}`;

export function tileState(match: Match): TileState {
  if (match.status === 'completed') return 'done';
  if (match.status === 'live') return 'live';
  if (match.status === 'alert') return 'alert';
  return match.scheduledDate && match.scheduledTime ? 'scheduled' : 'pending';
}

const STATE_WORD: Record<TileState, string> = { done: 'Played', live: 'Live', alert: 'Needs attention', scheduled: 'Scheduled', pending: 'Time not set' };

/** Short names that fit on the 3D map lanes. */
export function shortGame(name: string): string {
  const short = name.replace(/mobile legends(: bang bang)?/i, 'MLBB').replace(/call of duty:? mobile/i, 'CODM')
    .replace(/multiplayer/i, 'MP').replace(/battle royale/i, 'BR').trim();
  return short.length > 16 ? `${short.slice(0, 15)}…` : short;
}

export function matchMap(brackets: BracketDraft[]): MapLane[] {
  return brackets.map(bracket => ({
    id: bracket.id,
    label: shortGame(bracket.gameName || bracket.title),
    tiles: bracket.matches.filter(match => !isBye(match))
      .sort((a, b) => a.round - b.round || String(a.matchNumber).localeCompare(String(b.matchNumber), undefined, { numeric: true }))
      .map(match => ({
        id: match.id,
        state: tileState(match),
        label: matchup(match),
        detail: `${STATE_WORD[tileState(match)]}${match.status === 'live' || match.status === 'completed' ? ` · ${match.score.team1Score}–${match.score.team2Score}` : ''} · ${match.roundName}`,
      })),
  }));
}

export function mapTotals(lanes: MapLane[]): Record<TileState, number> {
  const totals: Record<TileState, number> = { done: 0, live: 0, alert: 0, scheduled: 0, pending: 0 };
  for (const lane of lanes) for (const tile of lane.tiles) totals[tile.state] += 1;
  return totals;
}
