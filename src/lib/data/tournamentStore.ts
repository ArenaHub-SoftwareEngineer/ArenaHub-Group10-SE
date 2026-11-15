/**
 * Firestore access for published tournaments. See tournamentDocs.ts for the document layout.
 * Every write is a transaction with an optimistic revision check, so two organizers editing
 * different games never block each other and two editing the same game cannot overwrite each other.
 */
import { collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, where, type Transaction } from 'firebase/firestore';
import { db } from '../firebase';
import type { BracketDraft } from '../types';
import { publicationGameKey } from '../bracketPublication';
import { notificationRecord } from '../notificationService';
import {
  announcementChanges, assertDocSize, contentFingerprint, fromDocs, toRosterDoc, toTournamentDoc,
  type RosterDoc, type TournamentDoc,
} from './tournamentDocs';

export const tournamentRef = (id: string) => doc(db, 'tournaments', id);
export const rosterRef = (id: string) => doc(db, 'tournaments', id, 'public', 'rosters');
export const privateRosterRef = (id: string) => doc(db, 'tournaments', id, 'private', 'roster');
export const publicationRef = (key: string) => doc(db, 'publications', key);
const previousRef = (key: string, part: 'tournament' | 'rosters') => doc(db, 'publications', key, 'previous', part);

export interface LiveTournament { bracket: BracketDraft; revision: number; featured: boolean; fingerprint: string }

/**
 * Listens to published tournaments and their public rosters.
 * Cost per viewer: one read per published tournament and roster on load, then one read
 * whenever a single tournament changes.
 */
export function watchPublishedTournaments(receive: (items: LiveTournament[]) => void, fail: (error: unknown) => void) {
  const tournaments = new Map<string, TournamentDoc>();
  const rosters = new Map<string, RosterDoc | null>();
  const rosterStops = new Map<string, () => void>();
  let ready = false;
  const emit = () => {
    if (!ready) return;
    receive([...tournaments.values()].map(t => ({
      bracket: fromDocs(t, rosters.get(t.id)), revision: t.revision, featured: t.featured === true,
      fingerprint: contentFingerprint(t),
    })));
  };
  const stopTournaments = onSnapshot(query(collection(db, 'tournaments'), where('status', '==', 'published')), snapshot => {
    tournaments.clear();
    snapshot.docs.forEach(item => tournaments.set(item.id, { ...(item.data() as TournamentDoc), id: item.id }));
    for (const [id, stop] of rosterStops) if (!tournaments.has(id)) { stop(); rosterStops.delete(id); rosters.delete(id); }
    for (const id of tournaments.keys()) if (!rosterStops.has(id)) {
      rosterStops.set(id, onSnapshot(rosterRef(id), roster => { rosters.set(id, roster.exists() ? roster.data() as RosterDoc : null); emit(); }, fail));
    }
    ready = true;
    emit();
  }, fail);
  return () => { stopTournaments(); rosterStops.forEach(stop => stop()); rosterStops.clear(); };
}

/** Staff only: the restorable previous version for each game. */
export function watchPreviousVersions(receive: (items: BracketDraft[]) => void, fail: (error: unknown) => void) {
  return onSnapshot(collection(db, 'publications'), async snapshot => {
    try {
      const keys = snapshot.docs.filter(item => item.data().hasPrevious === true).map(item => item.id);
      const loaded = await Promise.all(keys.map(async key => {
        const [t, r] = await Promise.all([getDoc(previousRef(key, 'tournament')), getDoc(previousRef(key, 'rosters'))]);
        return t.exists() ? fromDocs(t.data() as TournamentDoc, r.exists() ? r.data() as RosterDoc : null) : null;
      }));
      receive(loaded.filter((item): item is BracketDraft => !!item));
    } catch (error) { fail(error); }
  }, fail);
}

function announce(tx: Transaction, kind: Parameters<typeof notificationRecord>[0], title: string, body: string, tab: string, entityId: string) {
  tx.set(doc(collection(db, 'arenaAnnouncements')), notificationRecord(kind, title, body, tab, entityId));
}

/** Saves edits (scores, schedules, streams) to one published tournament. Returns the new revision. */
export async function saveTournament(bracket: BracketDraft, expectedRevision: number): Promise<number> {
  return runTransaction(db, async tx => {
    const ref = tournamentRef(bracket.id), snapshot = await tx.get(ref);
    if (!snapshot.exists() || snapshot.data().status !== 'published') throw new Error('This bracket is no longer published. Reload before editing.');
    const current = snapshot.data() as TournamentDoc;
    if (current.revision !== expectedRevision) throw new Error('A newer version of this bracket was saved. Reload before applying this change.');
    // Rosters change only at publish time or through roster approval, never through score or schedule edits.
    const next = toTournamentDoc(bracket, expectedRevision + 1, { featured: current.featured });
    assertDocSize(next, 'This bracket');
    tx.set(ref, { ...next, updatedAt: serverTimestamp() });
    for (const { match, kind } of announcementChanges(current.matches, next.matches)) {
      const names = `${match.team1?.name || 'TBD'} vs ${match.team2?.name || 'TBD'}`;
      if (kind === 'schedule') announce(tx, 'schedule', 'Match schedule updated', `${names} · ${match.scheduledDate}, ${match.scheduledTime}`, 'schedule', match.id);
      else if (kind === 'result') announce(tx, 'result', 'Match result published', `${names} · ${match.score.team1Score}–${match.score.team2Score}`, 'schedule', match.id);
      else announce(tx, 'live', 'A match is live', `${names} · ${match.roundName}`, 'current-live', match.id);
    }
    return expectedRevision + 1;
  });
}

/** Publishes a bracket as the current one for its game; the outgoing bracket becomes the restorable previous version. */
export async function publishTournament(bracket: BracketDraft): Promise<void> {
  const key = publicationGameKey(bracket);
  const tournament = toTournamentDoc(bracket, 0), roster = toRosterDoc(bracket);
  assertDocSize(tournament, 'This bracket'); assertDocSize(roster, 'This roster');
  await runTransaction(db, async tx => {
    const pubSnap = await tx.get(publicationRef(key));
    const currentId: string | null = pubSnap.exists() ? pubSnap.data().currentId ?? null : null;
    const incomingSnap = await tx.get(tournamentRef(bracket.id));
    if (incomingSnap.exists() && incomingSnap.data().gameKey !== key) throw new Error('This bracket is already published under another game. Create a separate bracket for this game.');
    const currentSnap = currentId ? await tx.get(tournamentRef(currentId)) : null;
    const currentRoster = currentId ? await tx.get(rosterRef(currentId)) : null;
    if (currentSnap?.exists()) {
      tx.set(previousRef(key, 'tournament'), currentSnap.data());
      tx.set(previousRef(key, 'rosters'), currentRoster?.exists() ? currentRoster.data() : { teams: [] });
      if (currentId !== bracket.id) tx.update(tournamentRef(currentId!), { status: 'archived', revision: Number(currentSnap.data().revision || 0) + 1, updatedAt: serverTimestamp() });
    }
    const revision = Number(incomingSnap.data()?.revision || 0) + 1;
    tx.set(tournamentRef(bracket.id), { ...tournament, revision, featured: incomingSnap.data()?.featured === true, updatedAt: serverTimestamp() });
    tx.set(rosterRef(bracket.id), roster);
    tx.set(publicationRef(key), { gameKey: key, currentId: bracket.id, hasPrevious: currentSnap?.exists() === true || (pubSnap.data()?.hasPrevious === true), revision: Number(pubSnap.data()?.revision || 0) + 1, updatedAt: serverTimestamp() });
    announce(tx, 'bracket', 'Tournament bracket published', `${bracket.gameName} · ${bracket.title}`, 'brackets', bracket.id);
  });
}

/** Restores the previous version for a game, after confirming it is the version the organizer reviewed. */
export async function restoreTournament(expected: BracketDraft): Promise<BracketDraft> {
  const key = publicationGameKey(expected);
  return runTransaction(db, async tx => {
    const pubSnap = await tx.get(publicationRef(key));
    const prevT = await tx.get(previousRef(key, 'tournament')), prevR = await tx.get(previousRef(key, 'rosters'));
    if (!prevT.exists()) throw new Error('There is no previous published version for this game.');
    const previous = prevT.data() as TournamentDoc;
    if (previous.id !== expected.id || contentFingerprint(previous) !== contentFingerprint(toTournamentDoc(expected, 0))) {
      throw new Error('The previous version changed. Reopen Bracket Studio before restoring.');
    }
    const currentId: string | null = pubSnap.data()?.currentId ?? null;
    const currentSnap = currentId ? await tx.get(tournamentRef(currentId)) : null;
    const currentRoster = currentId ? await tx.get(rosterRef(currentId)) : null;
    const targetSnap = await tx.get(tournamentRef(previous.id));
    if (currentSnap?.exists()) {
      tx.set(previousRef(key, 'tournament'), currentSnap.data());
      tx.set(previousRef(key, 'rosters'), currentRoster?.exists() ? currentRoster.data() : { teams: [] });
      if (currentId !== previous.id) tx.update(tournamentRef(currentId!), { status: 'archived', revision: Number(currentSnap.data().revision || 0) + 1, updatedAt: serverTimestamp() });
    } else {
      tx.delete(previousRef(key, 'tournament')); tx.delete(previousRef(key, 'rosters'));
    }
    const revision = Math.max(Number(targetSnap.data()?.revision || 0), Number(previous.revision || 0)) + 1;
    tx.set(tournamentRef(previous.id), { ...previous, status: 'published', revision, updatedAt: serverTimestamp() });
    tx.set(rosterRef(previous.id), prevR.exists() ? prevR.data() : { teams: [] });
    tx.set(publicationRef(key), { gameKey: key, currentId: previous.id, hasPrevious: currentSnap?.exists() === true, revision: Number(pubSnap.data()?.revision || 0) + 1, updatedAt: serverTimestamp() });
    announce(tx, 'bracket', 'Tournament bracket restored', `${previous.gameName} · ${previous.title}`, 'brackets', previous.id);
    return fromDocs(previous, prevR.exists() ? prevR.data() as RosterDoc : null);
  });
}

/** Takes a bracket off the public pages. The document stays for the audit trail. */
export async function unpublishTournament(id: string, expectedRevision: number): Promise<void> {
  await runTransaction(db, async tx => {
    const snapshot = await tx.get(tournamentRef(id));
    if (!snapshot.exists()) return;
    const data = snapshot.data() as TournamentDoc;
    if (data.revision !== expectedRevision) throw new Error('A newer version of this bracket was saved. Reload before unpublishing.');
    const pubSnap = await tx.get(publicationRef(data.gameKey));
    tx.update(tournamentRef(id), { status: 'unpublished', revision: data.revision + 1, updatedAt: serverTimestamp() });
    if (pubSnap.exists() && pubSnap.data().currentId === id) tx.update(publicationRef(data.gameKey), { currentId: null, revision: Number(pubSnap.data().revision || 0) + 1, updatedAt: serverTimestamp() });
  });
}

/** Toggles the home-page spotlight for one tournament. */
export async function setTournamentFeatured(id: string, featured: boolean): Promise<void> {
  await runTransaction(db, async tx => {
    const snapshot = await tx.get(tournamentRef(id));
    if (!snapshot.exists()) throw new Error('This tournament no longer exists.');
    tx.update(tournamentRef(id), { featured, revision: Number(snapshot.data().revision || 0) + 1, updatedAt: serverTimestamp() });
  });
}

/** Reads one published tournament inside a transaction (used by operations and broadcast edits). */
export async function readTournamentInTx(tx: Transaction, id: string): Promise<TournamentDoc | null> {
  const snapshot = await tx.get(tournamentRef(id));
  return snapshot.exists() ? { ...(snapshot.data() as TournamentDoc), id } : null;
}
