import type { PublishedData } from './data.ts';
import type { MonitorStore } from './monitorStore.ts';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from '../src/lib/fairPlayGames.ts';
import { rosterPlayerKey, type MatchScanReadiness } from '../src/lib/preMatchScan.ts';
import type { MonitorGame } from '../src/lib/integrityRisk.ts';
import { scheduleMatches } from '../src/lib/formats/placement.ts';
import { createHash } from 'node:crypto';

export class ScanAdmissionError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function scanMatch(data: PublishedData, id: string) {
  const found = data.brackets.flatMap(bracket => scheduleMatches(bracket).filter(match => match.id === id).map(match => ({ match, tournamentId: bracket.id })));
  const matches = found.map(entry => entry.match);
  if (matches.length !== 1) throw new ScanAdmissionError(404, 'Choose one published match with a unique match ID.');
  const match = matches[0];
  const game = FAIR_PLAY_GAMES.find(game => belongsToFairPlayGame(match, game))?.id as MonitorGame | undefined;
  const teams = match.lobby ? match.lobby.teams || [] : [match.team1, match.team2].filter(team => !!team);
  if (!game || match.status === 'completed' || teams.length < 2 || teams.some(team => team!.isBye) || (match.lobby && teams.length !== match.lobby.squads)) throw new ScanAdmissionError(409, 'This match needs all of its published team rosters before scanning.');
  if (teams.some(team => !team!.id || !Array.isArray(team!.players) || !team!.players.length || team!.players.some(player => !player.id || typeof player.id !== 'string' || !(player.ign || player.name)?.trim()))) throw new ScanAdmissionError(409, 'Every team needs named players with stable roster IDs before scanning.');
  const players = teams.flatMap(team => team!.players.map(player => ({ playerKey: rosterPlayerKey(team!.id, player.id), playerName: player.ign || player.name, team: team!.name })));
  // Room codes also need where each player sits in the staff-only roster (team id and IGN) and their college.
  const seats = teams.flatMap(team => team!.players.map(player => ({ playerKey: rosterPlayerKey(team!.id, player.id), teamId: team!.id, ign: (player.ign || player.name || '').trim(), college: team!.collegeCode || '' })));
  if (!players.length || players.length > 200 || new Set(players.map(player => player.playerKey)).size !== players.length) throw new ScanAdmissionError(409, 'Publish a complete, unique player roster before scanning.');
  const rosterVersion = createHash('sha256').update(JSON.stringify({ game, players: [...players].sort((a, b) => a.playerKey.localeCompare(b.playerKey)) })).digest('hex');
  return { match, game, players, rosterVersion, tournamentId: found[0].tournamentId, seats };
}
/** How staff and players see a match: its number and teams, or the lobby round. */
export const scanMatchLabel = (match: ReturnType<typeof scanMatch>['match']) => match.lobby ? `${match.roundName} - ${match.lobby.squads} squads` : `${String(match.matchNumber || '').replace(/^#+/, '')} - ${match.team1!.name} vs ${match.team2!.name}`;
export async function matchScanReadiness(data: PublishedData, id: string, store: MonitorStore): Promise<MatchScanReadiness> {
  const { match, game, players, rosterVersion } = scanMatch(data, id);
  const sessions = await store.sessions(id);
  const items = await Promise.all(players.map(async player => {
    // A no-sign-in test check-in never clears a roster player: nobody verified who ran it.
    const row = sessions.find(session => session.player_key === player.playerKey && session.game === game && session.email_check !== 'unsigned');
    return { ...player, sessionId: row?.id || null, scan: row && row.roster_version === rosterVersion ? await store.scan(row) : { status: 'required' as const, label: row ? 'Roster changed: rescan' : 'Scan required', detail: row ? 'Create a new code linked to the current published lineup. Earlier roster scans cannot clear a replacement player.' : 'Create a code for this roster player and run the companion before joining.', checkedAt: null, validUntil: null, blockers: [], warnings: [] } };
  }));
  const ready = items.filter(player => player.scan.status === 'ready').length;
  return { matchId: id, matchLabel: scanMatchLabel(match), game, total: items.length, ready, canStart: items.length > 0 && ready === items.length, players: items };
}
