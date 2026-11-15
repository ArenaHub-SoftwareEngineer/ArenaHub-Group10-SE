// server/auth.ts and server/data.ts through firebase-admin, against the Auth and Firestore emulators.
// The REST fallback (no service account) is covered by tests/fair-play-api.test.ts with a mocked fetch.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { callerVerifier, AuthError } from '../server/auth.ts';
import { publishedReader } from '../server/data.ts';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9098';
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
const env = { VITE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'demo-arenahub', VITE_FIREBASE_API_KEY: 'demo-key' };
const app = getApps().find(a => a.name === '[DEFAULT]') || initializeApp({ projectId: 'demo-arenahub' });
const auth = getAuth(app), db = getFirestore(app);
const verify = callerVerifier(env);
const run = Date.now();
const password = 'ArenaHub-QA-Only-27!';

async function account(label: string, email: string, options: { verified?: boolean; status?: string; claims?: object } = {}) {
  const user = await auth.createUser({ email, password, emailVerified: options.verified ?? true });
  if (options.claims) await auth.setCustomUserClaims(user.uid, options.claims);
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, name: label, email, role: 'user', status: options.status ?? 'active' });
  return user.uid;
}
async function token(email: string) {
  const response = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const body = await response.json() as { idToken?: string };
  assert.ok(body.idToken, 'emulator sign-in');
  return body.idToken!;
}
const rejects = async (promise: Promise<unknown>, status: number) => {
  await assert.rejects(promise, (error: unknown) => error instanceof AuthError && error.status === status);
};

const mail = (name: string, domain = 'wmsu.edu.ph') => `${name}-${run}@${domain}`;
let spectatorUid = '';
before(async () => {
  await account('Organizer', mail('organizer'), { claims: { role: 'organizer' } });
  await account('Student', mail('student'));
  spectatorUid = await account('Spectator', mail('spectator', 'example.com'));
  await account('Unverified', mail('unverified'), { verified: false });
  await account('Banned', mail('banned'), { status: 'banned' });
  await account('Outside staff', mail('outsider', 'example.com'), { claims: { role: 'organizer' } });
});

test('staff, students and admitted spectators are told apart as the rules do', async () => {
  const organizer = await verify(await token(mail('organizer')));
  assert.deepEqual([organizer.staff, organizer.campus, organizer.admitted, organizer.role], [true, true, true, 'organizer']);
  const student = await verify(await token(mail('student')));
  assert.deepEqual([student.staff, student.campus, student.admitted], [false, true, true]);

  // A personal account is admitted only after redeeming a campus invite (spectatorAdmissions/{uid}).
  assert.equal((await verify(await token(mail('spectator', 'example.com')))).admitted, false);
  await db.doc(`spectatorAdmissions/${spectatorUid}`).set({ email: mail('spectator', 'example.com'), invite: 'x', admittedAt: new Date() });
  const spectator = await verify(await token(mail('spectator', 'example.com')));
  assert.deepEqual([spectator.admitted, spectator.campus, spectator.staff], [true, false, false]);

  // A staff claim on a non-campus account is not staff (activeStaff requires a campus account).
  assert.equal((await verify(await token(mail('outsider', 'example.com')))).staff, false);
});

test('unverified, banned, disabled, revoked and forged tokens are rejected', async () => {
  await rejects(verify(await token(mail('unverified'))), 401);
  await rejects(verify(await token(mail('banned'))), 403);
  await rejects(verify(undefined), 401);
  await rejects(verify('local-dev-token'), 401);
  await rejects(verify('header.e30.signature'), 401);

  const email = mail('revoked');
  const uid = await account('Revoked', email);
  const old = await token(email);
  assert.equal((await verify(old)).uid, uid);
  // Revocation is recorded to the second, so the token must be at least a second old.
  await new Promise(resolve => setTimeout(resolve, 1100));
  await auth.revokeRefreshTokens(uid);
  await rejects(verify(old), 401);

  const disabledEmail = mail('disabled');
  const disabledUid = await account('Disabled', disabledEmail);
  const before = await token(disabledEmail);
  await auth.updateUser(disabledUid, { disabled: true });
  await rejects(verify(before), 401);
});

test('the published reader returns public documents only, with a revision that tracks changes', async () => {
  const id = `server-read-${run}`;
  const team = (n: number) => ({ id: `${id}-t${n}`, name: `Reader Team ${n}`, collegeId: 'c1', collegeCode: 'CCS', gameId: 'game-mlbb', seed: n });
  const tournament = db.doc(`tournaments/${id}`);
  await tournament.set({ id, title: 'Reader Cup', gameId: 'game-mlbb', gameName: 'Mobile Legends', gameKey: 'mlbb', format: 'Single elimination', matchFormat: 'Bo3', teamsCount: 2, seedingRule: '', createdAt: '', status: 'published', revision: 3, featured: false,
    matches: [{ id: `${id}-m1`, matchNumber: 'M1', tournamentId: id, gameId: 'game-mlbb', round: 1, roundName: 'Final', status: 'live', matchFormat: 'Bo3', team1: team(1), team2: team(2), score: { team1Score: 1, team2Score: 0 }, scheduledDate: '', scheduledTime: '', organizerName: '' }] });
  await tournament.collection('public').doc('rosters').set({ teams: [{ ...team(1), players: [{ id: 'p1', ign: 'ReaderIGN', role: 'Jungler', isVerified: true }] }] });
  await tournament.collection('private').doc('roster').set({ teams: { [`${id}-t1`]: { teamName: 'Reader Team 1', collegeCode: 'CCS', players: [{ fullName: 'Private Fullname', studentId: '2026-99999', schoolEmail: 'private@wmsu.edu.ph', section: 'BSCS-3A', ign: 'ReaderIGN', role: 'Jungler', substitute: false }] } } });

  let clock = 0;
  const read = publishedReader(env, { now: () => clock });
  const first = await read('unused-with-admin');
  const mine = first.brackets.find(b => b.id === id);
  assert.ok(mine, 'published tournament is returned');
  assert.equal(mine!.matches[0].team1?.players[0].ign, 'ReaderIGN');
  assert.match(first.revision, new RegExp(`${id}:3`));
  const text = JSON.stringify(first);
  for (const secret of ['Private Fullname', '2026-99999', 'private@wmsu.edu.ph', 'BSCS-3A']) assert.ok(!text.includes(secret), `${secret} stays private`);

  await tournament.update({ revision: 4 });
  assert.equal((await read('x')).revision, first.revision, 'cached within the window');
  clock += 11_000;
  assert.match((await read('x')).revision, new RegExp(`${id}:4`));
  await tournament.update({ status: 'archived' });
  clock += 11_000;
  assert.ok(!(await read('x')).brackets.some(b => b.id === id), 'archived tournaments are not public');
});

test('my team: the captain is found by registration, a member by the school email on the private roster', async () => {
  const { firestoreMyTeams } = await import('../server/ai/myTeam.ts');
  const { adminApp } = await import('../server/firebaseAdmin.ts');
  const read = firestoreMyTeams(adminApp(env)!);
  const tid = `myteam-${run}`;
  await db.doc(`tournamentRegistrations/${tid}-reg`).set({ ownerId: `captain-${run}`, tournamentId: tid, teamId: `${tid}-t1`, teamName: 'Captain Team', status: 'approved' });
  await db.doc(`tournamentRegistrations/${tid}-rej`).set({ ownerId: `captain-${run}`, tournamentId: tid, teamId: `${tid}-t9`, teamName: 'Rejected Team', status: 'rejected' });
  await db.doc(`tournaments/${tid}/private/roster`).set({ teams: { [`${tid}-t2`]: { teamName: 'Member Team', collegeCode: 'CCS', players: [{ fullName: 'Hidden Name', studentId: '2026-00001', schoolEmail: `Member-${run}@WMSU.edu.ph`, section: 'X', ign: 'Mem', role: 'Mid', substitute: false }] } } });
  const caller = (uid: string, email: string) => ({ uid, email, campus: true, admitted: true, staff: false, role: '' });

  assert.deepEqual(await read(caller(`captain-${run}`, `captain-${run}@wmsu.edu.ph`), [tid]), [{ tournamentId: tid, teamId: `${tid}-t1`, teamName: 'Captain Team' }]);
  const member = await read(caller(`member-${run}`, `member-${run}@wmsu.edu.ph`), [tid]);
  assert.deepEqual(member, [{ tournamentId: tid, teamId: `${tid}-t2`, teamName: 'Member Team' }]);
  assert.ok(!JSON.stringify(member).includes('Hidden Name') && !JSON.stringify(member).includes('2026-00001'), 'no roster details leave the lookup');
  assert.deepEqual(await read(caller(`stranger-${run}`, `stranger-${run}@wmsu.edu.ph`), [tid]), []);
  // A personal account is never matched by roster email.
  assert.deepEqual(await read({ ...caller(`member-${run}`, `member-${run}@wmsu.edu.ph`), campus: false }, [tid]), []);
});
