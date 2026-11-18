import { collection, doc, onSnapshot, query, where, runTransaction, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
import { duplicateRosterKeys, inspectCheckIn, matchTeamIds, validateRoster, type Registration, type RosterPlayer, type TournamentPolicy, type CheckIn, type MatchWindow } from './tournamentOperations';
import { notificationRecord, notificationRef } from './notificationService';
import { validateEvidenceUrl } from './integrityChecks';
import { readTournamentInTx, rosterRef, privateRosterRef } from './data/tournamentStore';
import { fromDocs, type RosterDoc } from './data/tournamentDocs';
import { MAX_LOBBY_TEAMS, scheduleMatches } from './formats/placement';

function account() { const user = auth.currentUser; if (!user?.emailVerified || user.isAnonymous) throw new Error('Sign in with a verified campus account.'); return user; }
export function subscribeOperations(staff: boolean, receive: (items: Registration[]) => void, fail: (message: string) => void) {
  const uid = auth.currentUser?.uid; if (!uid) return () => {};
  return onSnapshot(staff ? collection(db, 'tournamentRegistrations') : query(collection(db, 'tournamentRegistrations'), where('ownerId', '==', uid)), snap => receive(snap.docs.map(d => ({ ...d.data(), id: d.id } as Registration))), () => fail('Registrations could not load. Check your connection and database permissions.'));
}
export function subscribeOperationCollection<T>(name: 'tournamentPolicies' | 'matchWindows' | 'matchCheckIns', staff: boolean, receive: (items: T[]) => void, fail: (message: string) => void) {
  const uid = auth.currentUser?.uid; if (!uid) return () => {};
  const source = name === 'matchCheckIns' && !staff ? query(collection(db, name), where('ownerId', '==', uid)) : collection(db, name);
  return onSnapshot(source, snap => receive(snap.docs.map(d => ({ ...d.data(), id: d.id } as T))), () => fail('Tournament operations could not load. Check your connection and database permissions.'));
}
export async function saveTournamentPolicy(policy: TournamentPolicy) {
  account();
  if (!Number.isInteger(policy.playersRequired) || policy.playersRequired < 1 || policy.playersRequired > 8 || !Number.isInteger(policy.maxSubstitutes) || policy.maxSubstitutes < 0 || policy.maxSubstitutes > 2 || policy.playersRequired + policy.maxSubstitutes > 8) throw new Error('Use 1–8 starters and up to 2 substitutes, with at most 8 registered players.');
  const batch = writeBatch(db);
  batch.set(doc(db, 'tournamentPolicies', policy.tournamentId), { ...policy, updatedAt: serverTimestamp() });
  batch.set(doc(collection(db, 'auditEvents')), { actorId: account().uid, action: `Updated registration policy for ${policy.tournamentId}`, createdAt: serverTimestamp() });
  await batch.commit();
}
export async function submitRegistration(input: Pick<Registration, 'tournamentId' | 'teamId' | 'teamName' | 'gameId' | 'college'> & { players: RosterPlayer[] }) {
  const user = account(), id = `${input.tournamentId}__${input.teamId}`;
  const ref = doc(db, 'tournamentRegistrations', id);
  await runTransaction(db, async tx => {
    const policy = (await tx.get(doc(db, 'tournamentPolicies', input.tournamentId))).data() as TournamentPolicy | undefined;
    const existing = await tx.get(ref);
    if (!policy?.registrationOpen) throw new Error('Registration is not open for this tournament.');
    validateRoster(input.players, policy);
    if (input.gameId !== policy.gameId) throw new Error('The selected game does not match this tournament.');
    if (existing.exists() && (existing.data().ownerId !== user.uid || !['submitted', 'rejected'].includes(existing.data().status))) throw new Error('This team already has an approved roster or another captain.');
    const revision = Number(existing.data()?.revision || 0) + 1;
    tx.set(ref, { ...input, ownerId: user.uid, status: 'submitted', revision, reviewNote: '', sanction: 'none', createdAt: existing.data()?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(notificationRef(user.uid, `registration-${id}-${revision}`), notificationRecord('registration', 'Roster submitted', `${input.teamName} is awaiting organizer approval.`, 'operations', id));
    tx.set(doc(db, 'staffInbox', `registration-${id}-${revision}`), { ...notificationRecord('registration', 'Roster awaiting review', `${input.teamName} submitted a roster.`, 'operations', id), actorId: user.uid, sourceId: id });
  });
  return id;
}
export async function reviewRegistration(id: string, status: 'approved' | 'rejected' | 'locked', note: string) {
  const user = account();
  if (note.trim().length < 10 || note.length > 1000) throw new Error('Record a review note of 10–1,000 characters.');
  await runTransaction(db, async tx => {
    const ref = doc(db, 'tournamentRegistrations', id), snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Registration no longer exists.');
    const registration = snap.data() as Registration;
    const policy = (await tx.get(doc(db, 'tournamentPolicies', registration.tournamentId))).data() as TournamentPolicy;
    const registryRef = doc(db, 'rosterRegistries', registration.tournamentId), registry = (await tx.get(registryRef)).data()?.keys || {};
    const tournament = await readTournamentInTx(tx, registration.tournamentId);
    const publicRoster = await tx.get(rosterRef(registration.tournamentId));
    if (tournament?.status !== 'published' || !(tournament.matches.some(m => [m.team1?.id, m.team2?.id].includes(registration.teamId)) || tournament.placement?.teams.some(team => team.id === registration.teamId))) throw new Error('This team is no longer in the published tournament.');
    if (status === 'locked' ? registration.status !== 'approved' : !['submitted', 'rejected'].includes(registration.status)) throw new Error('The roster changed. Refresh before reviewing.');
    if (status === 'approved' || status === 'locked') {
      validateRoster(registration.players, policy);
      const keys = duplicateRosterKeys(registration.players);
      if (keys.some(key => registry[key] && registry[key] !== id)) throw new Error('Duplicate registration detected: a student or game account is already approved for another team in this tournament.');
      keys.forEach(key => { registry[key] = id; });
      tx.set(registryRef, { keys: registry, updatedAt: serverTimestamp() });
    }
    tx.update(ref, { status, reviewNote: note.trim(), updatedAt: serverTimestamp() });
    if (status === 'approved' || status === 'locked') {
      // Public roster: IGN and role only. Names, student IDs and game-account IDs go to the staff-only roster.
      const squad = tournament.placement?.teams.find(team => team.id === registration.teamId);
      const team = tournament.matches.flatMap(m => [m.team1, m.team2]).find(t => t?.id === registration.teamId) || (squad ? { id: squad.id, name: squad.name, collegeId: '', collegeCode: squad.collegeCode, gameId: registration.gameId } : undefined)!;
      const players = registration.players.map((p, i) => ({ id: `${id}-player-${i}`, ign: p.ign, role: p.substitute ? 'Substitute' : 'Player', isVerified: true }));
      const teams = ((publicRoster.data() as RosterDoc | undefined)?.teams || []).filter(t => t.id !== registration.teamId);
      tx.set(rosterRef(registration.tournamentId), { teams: [...teams, { id: team.id, name: team.name, collegeId: team.collegeId, collegeCode: team.collegeCode, gameId: team.gameId, players }] });
      tx.set(privateRosterRef(registration.tournamentId), { teams: { [registration.teamId]: { teamName: registration.teamName, collegeCode: registration.college, players: registration.players.map(p => ({ fullName: p.name, studentId: p.studentId, schoolEmail: '', section: '', ign: p.ign, role: p.substitute ? 'Substitute' : 'Player', substitute: p.substitute, gameAccountId: p.accountId })) } } }, { merge: true });
    }
    tx.set(notificationRef(registration.ownerId, `roster-${id}-${status}-${registration.revision}`), notificationRecord('registration', `Roster ${status}`, `${registration.teamName}: ${note.trim()}`, 'operations', id));
    tx.set(doc(collection(db, 'auditEvents')), { actorId: user.uid, action: `Roster ${id}: ${status}. ${note.trim()}`, createdAt: serverTimestamp() });
  });
}
export async function saveMatchWindow(matchId: string, tournamentId: string, registrationIds: string[], opens: string, closes: string) {
  account();
  const opensAt = Timestamp.fromDate(new Date(opens)), closesAt = Timestamp.fromDate(new Date(closes));
  if (opensAt.toMillis() >= closesAt.toMillis()) throw new Error('Check-in must open before its deadline.');
  if (registrationIds.length < 2 || registrationIds.length > MAX_LOBBY_TEAMS || new Set(registrationIds).size !== registrationIds.length) throw new Error('Assign one locked roster for every participating team.');
  await runTransaction(db, async tx => {
    const registrations = [];
    for (const id of registrationIds) registrations.push((await tx.get(doc(db, 'tournamentRegistrations', id))).data());
    const tournament = await readTournamentInTx(tx, tournamentId);
    const match = tournament?.status === 'published' ? scheduleMatches(fromDocs(tournament, null)).find(m => m.id === matchId) : undefined;
    const teams = matchTeamIds(match);
    if (!match || !['upcoming', 'pre-match'].includes(match.status) || teams.length !== registrations.length
      || new Set(registrations.map(r => r?.teamId)).size !== teams.length
      || registrations.some(r => !r || r.status !== 'locked' || r.tournamentId !== tournamentId || r.sanction === 'disqualified' || !teams.includes(r.teamId))) throw new Error('Choose an upcoming match and an eligible locked roster for every participating team.');
    tx.set(doc(db, 'matchWindows', matchId), { matchId, tournamentId, registrationIds, opensAt, closesAt, updatedAt: serverTimestamp() });
    registrations.forEach((r, i) => tx.set(notificationRef(r!.ownerId, `checkin-window-${matchId}-${i}-${Date.now()}`), notificationRecord('check-in', 'Match check-in scheduled', `${r!.teamName}: check the readiness window and confirm your lineup.`, 'operations', matchId)));
  });
}
export async function submitCheckIn(registration: Registration, window: MatchWindow, lineup: CheckIn['lineup'], evidenceUrl: string) {
  const user = account(), id = `${window.matchId}__${registration.id}`;
  const evidence = validateEvidenceUrl(evidenceUrl);
  if (lineup.length < 1 || lineup.length > 8) throw new Error('Enter 1–8 players.');
  await runTransaction(db, async tx => {
    const roster = (await tx.get(doc(db, 'tournamentRegistrations', registration.id))).data();
    const freshWindow = (await tx.get(doc(db, 'matchWindows', window.matchId))).data();
    const now = Date.now();
    if (roster?.ownerId !== user.uid || roster.status !== 'locked' || roster.sanction === 'disqualified' || !freshWindow?.registrationIds.includes(registration.id) || now < freshWindow.opensAt.toMillis() || now > freshWindow.closesAt.toMillis()) throw new Error('Check-in requires your locked eligible roster and an open readiness window.');
    const ref = doc(db, 'matchCheckIns', id), prior = await tx.get(ref);
    if (prior.exists() && prior.data().status !== 'disputed') throw new Error('This check-in is already submitted. A referee must request a correction before you resubmit.');
    const revision = prior.exists() ? Number(prior.data().submissionRevision || 1) + 1 : 1;
    if (prior.exists()) tx.set(doc(ref, 'submissions', String(revision - 1)), { previous: prior.data(), actorId: user.uid, savedAt: serverTimestamp() });
    tx.set(ref, { ownerId: user.uid, registrationId: registration.id, tournamentId: registration.tournamentId, matchId: window.matchId, rosterRevision: roster.revision, submissionRevision: revision, lineup, evidenceUrl: evidence, status: 'pending', refereeNote: '', createdAt: prior.data()?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(notificationRef(user.uid, `checkin-${id}-${revision}`), notificationRecord('check-in', 'Lineup received', 'Your check-in is awaiting referee confirmation.', 'operations', window.matchId));
    tx.set(doc(db, 'staffInbox', `checkin-${id}-${revision}`), { ...notificationRecord('check-in', 'Lineup awaiting confirmation', `${registration.teamName} checked in. Review the submitted evidence.`, 'operations', window.matchId), actorId: user.uid, sourceId: id });
  });
}
export function subscribeCheckInHistory(id: string, receive: (history: any[]) => void, fail: (message: string) => void) {
  return onSnapshot(collection(db, 'matchCheckIns', id, 'submissions'), snap => receive(snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => Number(a.id) - Number(b.id))), () => fail('Earlier check-in submissions could not load.'));
}
export async function reviewCheckIn(id: string, status: 'confirmed' | 'disputed' | 'no-show', note: string) {
  const user = account(); if (note.trim().length < 10 || note.length > 1000) throw new Error('Record what you verified in 10–1,000 characters.');
  await runTransaction(db, async tx => {
    const ref = doc(db, 'matchCheckIns', id), snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Check-in no longer exists.');
    const data = snap.data();
    if (status === 'confirmed') {
      const registration = (await tx.get(doc(db, 'tournamentRegistrations', data.registrationId))).data() as Registration;
      const policy = (await tx.get(doc(db, 'tournamentPolicies', data.tournamentId))).data() as TournamentPolicy;
      const tournament = await readTournamentInTx(tx, data.tournamentId);
      const match = tournament?.status === 'published' ? scheduleMatches(fromDocs(tournament, null)).find(m => m.id === data.matchId) : undefined;
      if (!registration || !policy || !match || inspectCheckIn(registration, data as CheckIn, policy, match).length) throw new Error('Resolve the recorded roster discrepancies before confirming the players.');
    }
    tx.update(ref, { status, refereeNote: note.trim(), updatedAt: serverTimestamp() });
    tx.set(notificationRef(data.ownerId, `checkin-review-${id}-${Date.now()}`), notificationRecord('check-in', `Check-in ${status}`, note.trim(), 'operations', data.matchId));
    tx.set(doc(collection(db, 'auditEvents')), { actorId: user.uid, action: `Check-in ${id}: ${status}. ${note.trim()}`, createdAt: serverTimestamp() });
  });
}
export async function recordNoShow(registration: Registration, window: MatchWindow, note: string) {
  const user = account(); if (note.trim().length < 10 || note.length > 1000) throw new Error('Explain the no-show decision in 10–1,000 characters.');
  const ref = doc(db, 'matchCheckIns', `${window.matchId}__${registration.id}`);
  await runTransaction(db, async tx => {
    const existing = await tx.get(ref), freshWindow = (await tx.get(doc(db, 'matchWindows', window.matchId))).data();
    if (existing.exists() || !freshWindow?.registrationIds.includes(registration.id) || Date.now() <= freshWindow.closesAt.toMillis()) throw new Error('Record a no-show only after the deadline when no check-in exists.');
    tx.set(ref, { ownerId: registration.ownerId, registrationId: registration.id, tournamentId: registration.tournamentId, matchId: window.matchId, rosterRevision: registration.revision, lineup: [], evidenceUrl: '', status: 'no-show', refereeNote: note.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(notificationRef(registration.ownerId, `no-show-${window.matchId}`), notificationRecord('check-in', 'No-show recorded', note.trim(), 'operations', window.matchId));
    tx.set(doc(collection(db, 'auditEvents')), { actorId: user.uid, action: `No-show ${registration.id} at ${window.matchId}: ${note.trim()}`, createdAt: serverTimestamp() });
  });
}
export async function recordSanction(registration: Registration, sanction: Registration['sanction'], caseId: string, note: string) {
  const user = account(); if (note.trim().length < 10 || note.length > 1000 || !caseId.trim()) throw new Error('Provide a resolved case reference and a 10–1,000 character decision note.');
  await runTransaction(db, async tx => {
    const report = (await tx.get(doc(db, 'integrityCases', caseId.trim()))).data();
    const tournament = await readTournamentInTx(tx, registration.tournamentId);
    const match = tournament ? scheduleMatches(fromDocs(tournament, null)).find(m => m.id === report?.matchId) : undefined;
    if (!report || report.status !== 'resolved' || !match || !matchTeamIds(match).includes(registration.teamId)) throw new Error('Use a resolved case involving this team in this tournament.');
    tx.update(doc(db, 'tournamentRegistrations', registration.id), { sanction, updatedAt: serverTimestamp() });
    tx.set(doc(collection(db, 'tournamentSanctions')), { registrationId: registration.id, tournamentId: registration.tournamentId, ownerId: registration.ownerId, caseId: caseId.trim(), sanction, note: note.trim(), actorId: user.uid, createdAt: serverTimestamp() });
    tx.set(notificationRef(registration.ownerId, `sanction-${registration.id}-${Date.now()}`), notificationRecord('fair-play', 'Tournament eligibility updated', `${registration.teamName}: ${sanction}. ${note.trim()}`, 'operations', registration.id));
    tx.set(doc(collection(db, 'auditEvents')), { actorId: user.uid, action: `Tournament decision for ${registration.id}: ${sanction}. Case ${caseId}. ${note.trim()}`, createdAt: serverTimestamp() });
  });
}
