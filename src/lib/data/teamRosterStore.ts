/**
 * Staff writes from the admin Teams page: one team's players in one published tournament.
 * The public roster (IGN, role, photo) and the staff-only roster (full name, school email) change together in
 * one transaction. Viewers already listen to the public roster, so the new players show up without a reload.
 */
import { getDoc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import type { Team } from '../types';
import { splitRoster, type RosterRow } from '../teamRoster';
import { assertDocSize, type PrivateRosterDoc, type PublicRosterTeam, type RosterDoc } from './tournamentDocs';
import { privateRosterRef, rosterRef } from './tournamentStore';

export async function readPrivateRoster(tournamentId: string): Promise<PrivateRosterDoc> {
  const snapshot = await getDoc(privateRosterRef(tournamentId));
  return snapshot.exists() ? snapshot.data() as PrivateRosterDoc : { teams: {} };
}

export async function saveTeamRoster(tournamentId: string, team: Pick<Team, 'id' | 'name' | 'collegeId' | 'collegeCode' | 'gameId' | 'gameMode'>, rows: RosterRow[]): Promise<void> {
  const { publicPlayers, privatePlayers } = splitRoster(rows);
  const entry: PublicRosterTeam = JSON.parse(JSON.stringify({
    id: team.id, name: team.name, collegeId: team.collegeId || '', collegeCode: team.collegeCode || '', gameId: team.gameId || '',
    gameMode: team.gameMode, players: publicPlayers,
  }));
  await runTransaction(db, async tx => {
    const snapshot = await tx.get(rosterRef(tournamentId));
    const teams = snapshot.exists() ? (snapshot.data() as RosterDoc).teams || [] : [];
    const next: RosterDoc = { teams: teams.some(t => t.id === team.id) ? teams.map(t => t.id === team.id ? entry : t) : [...teams, entry] };
    assertDocSize(next, 'This game’s rosters');
    tx.set(rosterRef(tournamentId), next);
    tx.set(privateRosterRef(tournamentId), { teams: { [team.id]: { teamName: team.name, collegeCode: team.collegeCode || '', players: privatePlayers } } }, { merge: true });
  });
}
