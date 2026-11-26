/**
 * Team roster editing for the admin Teams page. Pure functions only (no Firebase), so everything here is unit-tested.
 *
 * One form row per player: photo, full name, in-game name, role and (optional) school email.
 * The row is split on save:
 *   public roster  -> id, IGN, role, photo        (everyone admitted can read it)
 *   private roster -> full name, school email, ... (staff only; check-in matches the school email)
 */
import type { PrivateRosterPlayer, PublicPlayer } from './data/tournamentDocs';
import { publicationGameKey } from './bracketPublication';
import { CAMPUS_DOMAIN, hasCampusEmail } from './institution';

export interface RosterRow {
  id: string;
  photo?: string;
  fullName: string;
  ign: string;
  role: string;
  schoolEmail: string;
  /** Kept from the private roster so an edit never drops data this form does not show. */
  studentId?: string;
  section?: string;
  gameAccountId?: string;
}

export const SUBSTITUTE = 'Substitute';
export const MAX_SUBSTITUTES = 2;
export const MAX_PHOTO_LENGTH = 7000;

const ROLES: Record<string, string[]> = {
  'game-mlbb': ['Gold Lane', 'EXP Lane', 'Mid Lane', 'Jungler', 'Roamer'],
  'game-dota2': ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'],
  'game-codm-mp': ['Slayer', 'Objective', 'Anchor', 'Flex', 'Support'],
  'game-codm-br': ['Squad Leader', 'Fragger', 'Support', 'Scout'],
};

type GameRef = { gameName: string; gameId?: string };

export function gameRoles(game: GameRef): string[] {
  return [...(ROLES[publicationGameKey({ gameName: game.gameName, gameId: game.gameId })] || ['Player']), SUBSTITUTE];
}

/** Players who start a match: 4 for a Battle Royale squad, otherwise 5. */
export function startersFor(game: GameRef): number {
  return publicationGameKey({ gameName: game.gameName, gameId: game.gameId }) === 'game-codm-br' ? 4 : 5;
}

export const maxPlayersFor = (game: GameRef) => startersFor(game) + MAX_SUBSTITUTES;

export function safePhoto(value?: string): string | undefined {
  return typeof value === 'string' && value.length <= MAX_PHOTO_LENGTH
    && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : undefined;
}

/** A blank form with one row per starting position, roles pre-filled in order. */
export function blankRows(teamId: string, game: GameRef): RosterRow[] {
  const roles = gameRoles(game);
  const rows: RosterRow[] = [];
  for (let i = 0; i < startersFor(game); i++) rows.push(emptyRow(teamId, rows, roles[i] && roles[i] !== SUBSTITUTE ? roles[i] : roles[0]));
  return rows;
}

export function emptyRow(teamId: string, existing: RosterRow[], role: string): RosterRow {
  const used = new Set(existing.map(row => row.id));
  let n = existing.length + 1;
  while (used.has(`${teamId}-p${n}`)) n++;
  return { id: `${teamId}-p${n}`, fullName: '', ign: '', role, schoolEmail: '' };
}

/** The next role nobody has yet, or Substitute once every position is filled. */
export function nextRole(rows: RosterRow[], game: GameRef): string {
  const taken = new Set(rows.map(row => row.role));
  return gameRoles(game).find(role => role !== SUBSTITUTE && !taken.has(role)) || SUBSTITUTE;
}

const key = (value: string) => value.trim().toLowerCase();

/** Joins the public roster (ids, photos) with the staff-only one (names, emails). Private rows pair up by IGN. */
export function rowsFromRosters(publicPlayers: PublicPlayer[], privatePlayers: PrivateRosterPlayer[] = []): RosterRow[] {
  const byIgn = new Map(privatePlayers.map(p => [key(p.ign || ''), p]));
  return publicPlayers.map((player, index) => {
    const secret = byIgn.get(key(player.ign || '')) || (privatePlayers.length === publicPlayers.length ? privatePlayers[index] : undefined);
    const substitute = secret?.substitute === true || player.role === SUBSTITUTE;
    return {
      id: player.id, photo: safePhoto(player.avatarUrl), fullName: secret?.fullName || '', ign: player.ign || '',
      role: substitute ? SUBSTITUTE : player.role || 'Player', schoolEmail: secret?.schoolEmail || '',
      ...(secret?.studentId ? { studentId: secret.studentId } : {}),
      ...(secret?.section ? { section: secret.section } : {}),
      ...(secret?.gameAccountId ? { gameAccountId: secret.gameAccountId } : {}),
    };
  });
}

/** The first problem with this roster, phrased as what to fix, or '' when it can be saved. */
export function rosterProblem(rows: RosterRow[], game: GameRef): string {
  if (!rows.length) return 'Add at least one player.';
  if (rows.length > maxPlayersFor(game)) return `A team has at most ${maxPlayersFor(game)} players.`;
  for (const [index, row] of rows.entries()) {
    const who = row.ign.trim() || `Player ${index + 1}`;
    if (!row.fullName.trim()) return `Add the full name of ${who}.`;
    if (!row.ign.trim()) return `Add the in-game name of player ${index + 1}.`;
    if (row.fullName.trim().length > 100 || row.ign.trim().length > 40) return `Shorten the name of ${who}.`;
    if (row.schoolEmail.trim() && !hasCampusEmail(row.schoolEmail.trim())) return `Use a @${CAMPUS_DOMAIN} email for ${who}, or leave it blank.`;
  }
  const igns = rows.map(row => key(row.ign));
  const twice = igns.find((ign, i) => igns.indexOf(ign) !== i);
  if (twice) return `Two players use the in-game name "${rows[igns.indexOf(twice)].ign.trim()}".`;
  const emails = rows.map(row => key(row.schoolEmail)).filter(Boolean);
  if (new Set(emails).size !== emails.length) return 'Two players use the same school email.';
  if (rows.filter(row => row.role === SUBSTITUTE).length > MAX_SUBSTITUTES) return `A team has at most ${MAX_SUBSTITUTES} substitutes.`;
  return '';
}

/** Splits saved rows into the public and the staff-only roster entries. */
export function splitRoster(rows: RosterRow[]): { publicPlayers: PublicPlayer[]; privatePlayers: PrivateRosterPlayer[] } {
  const publicPlayers = rows.map(row => {
    const photo = safePhoto(row.photo);
    return { id: row.id, ign: row.ign.trim(), role: row.role, isVerified: true, ...(photo ? { avatarUrl: photo } : {}) };
  });
  const privatePlayers = rows.map(row => ({
    fullName: row.fullName.trim(), schoolEmail: row.schoolEmail.trim().toLowerCase(), studentId: row.studentId || '', section: row.section || '',
    ign: row.ign.trim(), role: row.role, substitute: row.role === SUBSTITUTE,
    ...(row.gameAccountId ? { gameAccountId: row.gameAccountId } : {}),
  }));
  return { publicPlayers, privatePlayers };
}

/** How complete a roster is, for the team list. */
export function rosterStatus(players: number, game: GameRef): 'empty' | 'partial' | 'ready' {
  return players === 0 ? 'empty' : players >= startersFor(game) ? 'ready' : 'partial';
}
