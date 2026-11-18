import type { Match } from './types';

export interface RosterPlayer { name: string; ign: string; studentId: string; accountId: string; substitute: boolean }
export interface Registration {
  id: string; ownerId: string; tournamentId: string; teamId: string; teamName: string; gameId: string;
  college: string; players: RosterPlayer[]; status: 'submitted' | 'approved' | 'rejected' | 'locked';
  revision: number; reviewNote: string; sanction: 'none' | 'warning' | 'disqualified'; updatedAt: any; createdAt: any;
}
export interface TournamentPolicy { tournamentId: string; gameId: string; playersRequired: number; maxSubstitutes: number; registrationOpen: boolean }
export interface MatchWindow { matchId: string; tournamentId: string; registrationIds: string[]; opensAt: any; closesAt: any }
export interface CheckIn {
  id: string; ownerId: string; registrationId: string; tournamentId: string; matchId: string;
  rosterRevision: number; lineup: { studentId: string; accountId: string }[]; evidenceUrl: string;
  status: 'pending' | 'confirmed' | 'disputed' | 'no-show'; refereeNote: string; updatedAt: any; createdAt: any;
  submissionRevision?: number;
}
export interface IntegrityFlag { code: string; message: string }
export const normalizeIdentifier = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '');
export function matchTeamIds(match?: Match): string[] {
  const teams = match?.lobby ? match.lobby.teams || [] : [match?.team1, match?.team2];
  return [...new Set(teams.filter(team => team && !team.isBye).map(team => team!.id))];
}
export function parseRoster(text: string): RosterPlayer[] {
  const players = text.split(/\r?\n/).filter(row => row.trim()).map(row => {
    const [name = '', ign = '', studentId = '', accountId = '', role = 'starter'] = row.split('|').map(v => v.trim());
    if (![name, ign, studentId, accountId].every(v => v.length > 0 && v.length <= 100) || !['starter', 'sub'].includes(role.toLowerCase())) {
      throw new Error('Use Name | IGN | Student ID | Game account ID | starter or sub on every line. Each field needs 1–100 characters.');
    }
    return { name, ign, studentId: normalizeIdentifier(studentId), accountId: normalizeIdentifier(accountId), substitute: role.toLowerCase() === 'sub' };
  });
  if (!players.length || players.length > 8) throw new Error('Enter between 1 and 8 players.');
  for (const field of ['studentId', 'accountId'] as const) if (new Set(players.map(p => p[field])).size !== players.length) throw new Error(`This roster contains a duplicate ${field === 'studentId' ? 'student identifier' : 'game account ID'}.`);
  return players;
}
export function validateRoster(players: RosterPlayer[], policy: TournamentPolicy) {
  if (players.filter(p => !p.substitute).length !== policy.playersRequired) throw new Error(`Register exactly ${policy.playersRequired} starters.`);
  if (players.filter(p => p.substitute).length > policy.maxSubstitutes) throw new Error(`This tournament allows ${policy.maxSubstitutes} substitutes.`);
}
/** These are explainable registration discrepancies, never a software-cheating verdict. */
export function inspectCheckIn(registration: Registration, checkIn: CheckIn, policy: TournamentPolicy, match?: Match): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];
  const add = (code: string, message: string) => flags.push({ code, message });
  if (registration.status !== 'locked') add('ROSTER_UNLOCKED', 'The approved roster is not locked.');
  if (registration.sanction === 'disqualified') add('INELIGIBLE_TEAM', 'A referee has disqualified this team from this tournament.');
  if (registration.revision !== checkIn.rosterRevision) add('STALE_ROSTER', 'The check-in refers to a different roster revision.');
  if (checkIn.lineup.length !== policy.playersRequired) add('LINEUP_SIZE', `Expected ${policy.playersRequired} players; received ${checkIn.lineup.length}.`);
  if (match && !matchTeamIds(match).includes(registration.teamId)) add('WRONG_MATCH', 'The registered team is not a participant in this match.');
  const students = new Set<string>(), accounts = new Set<string>();
  for (const row of checkIn.lineup) {
    const student = normalizeIdentifier(row.studentId), account = normalizeIdentifier(row.accountId);
    const approved = registration.players.find(p => normalizeIdentifier(p.studentId) === student);
    if (students.has(student) || accounts.has(account)) add('DUPLICATE_PLAYER', 'A student or game account appears more than once in this lineup.');
    if (!approved) add('UNAPPROVED_PLAYER', 'A submitted student identifier is absent from the locked roster.');
    else if (normalizeIdentifier(approved.accountId) !== account) add('ACCOUNT_MISMATCH', `${approved.ign}: submitted game account differs from the approved account.`);
    students.add(student); accounts.add(account);
  }
  return flags.filter((flag, i, all) => all.findIndex(other => other.code === flag.code && other.message === flag.message) === i);
}
export function duplicateRosterKeys(players: RosterPlayer[]) {
  return players.flatMap(p => [`student:${normalizeIdentifier(p.studentId)}`, `account:${normalizeIdentifier(p.accountId)}`]);
}
export function parseLineup(text: string): CheckIn['lineup'] {
  const rows = text.split(/\r?\n/).filter(s => s.trim()).map(row => {
    const [studentId = '', accountId = ''] = row.split('|').map(normalizeIdentifier);
    if (!studentId || !accountId || studentId.length > 100 || accountId.length > 100) throw new Error('Use Student ID | Game account ID for each checked-in player.');
    return { studentId, accountId };
  });
  if (rows.length < 1 || rows.length > 8) throw new Error('Enter 1–8 checked-in players.');
  return rows;
}
