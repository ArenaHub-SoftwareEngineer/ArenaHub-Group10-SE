import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp, collection, getDocs, query, where, Timestamp, deleteField } from 'firebase/firestore';

let env;
const projectId = 'demo-arenahub';
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').at(-1)) || 8085, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const uid of ['reporter', 'other', 'staff', 'unverified', 'banned']) await setDoc(doc(ctx.firestore(), 'users', uid), { uid, email: `${uid}@arena.test`, role: 'user', status: uid === 'banned' ? 'banned' : 'active', emailVerified: uid !== 'unverified' });
  });
});
after(async () => { await env?.cleanup(); });
const db = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore();
const report = (uid, overrides = {}) => ({ reporterId: uid, matchId: 'match-1', reason: 'Score dispute', details: 'At timestamp 12:35 the series scoreboard appears incorrect.', evidenceUrl: 'https://youtu.be/example', status: 'open', reviewerId: '', resolution: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides });
const submit = (database, uid, id, overrides = {}) => {
  const batch = writeBatch(database);
  batch.set(doc(database, 'integrityCases', id), report(uid, overrides));
  batch.set(doc(database, 'integrityRateLimits', uid), { submittedAt: serverTimestamp(), caseId: id });
  return batch.commit();
};
test('verified active account can atomically submit evidence', async () => { await assertSucceeds(submit(db('reporter'), 'reporter', 'case-1')); });
test('reporter can read own case; strangers and anonymous visitors cannot', async () => {
  await assertSucceeds(getDoc(doc(db('reporter'), 'integrityCases', 'case-1')));
  await assertFails(getDoc(doc(db('other'), 'integrityCases', 'case-1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'integrityCases', 'case-1')));
});
test('reporter can query only their own reports', async () => {
  await assertSucceeds(getDocs(query(collection(db('reporter'), 'integrityCases'), where('reporterId', '==', 'reporter'))));
  await assertFails(getDocs(collection(db('reporter'), 'integrityCases')));
});
test('unverified and banned accounts cannot submit', async () => {
  await assertFails(submit(db('unverified', { email_verified: false }), 'unverified', 'unverified-case'));
  await assertFails(submit(db('banned'), 'banned', 'banned-case'));
});
test('spoofed identities, unsafe links, and malformed reports are rejected', async () => {
  await assertFails(submit(db('other'), 'reporter', 'spoofed-case'));
  await assertFails(submit(db('other'), 'other', 'bad-url', { evidenceUrl: 'https://youtube.com.evil.test/clip' }));
  await assertFails(submit(db('other'), 'other', 'bad-detail', { details: 'cheater' }));
  await assertFails(submit(db('other'), 'other', 'fake-status', { status: 'resolved' }));
});
test('rate limit cannot be bypassed by skipping or resetting the limit record', async () => {
  await assertFails(submit(db('reporter'), 'reporter', 'too-fast'));
  await assertFails(setDoc(doc(db('other'), 'integrityCases', 'no-limit'), report('other')));
  await assertFails(setDoc(doc(db('reporter'), 'integrityRateLimits', 'reporter'), { submittedAt: Timestamp.fromMillis(0), caseId: 'case-1' }));
});
test('ordinary users cannot grant themselves staff or review privileges', async () => {
  await assertFails(updateDoc(doc(db('reporter'), 'users', 'reporter'), { role: 'admin' }));
  await assertFails(updateDoc(doc(db('reporter'), 'integrityCases', 'case-1'), { status: 'resolved', resolution: 'I approve my own report.', reviewerId: 'reporter', updatedAt: serverTimestamp() }));
});
test('trusted staff may review but cannot alter evidence, forge reviewer, or reopen a closed case', async () => {
  const staff = db('staff', { role: 'moderator' });
  await assertSucceeds(getDocs(collection(staff, 'integrityCases')));
  await assertFails(updateDoc(doc(staff, 'integrityCases', 'case-1'), { details: 'A replacement allegation that must never be permitted.' }));
  await assertFails(updateDoc(doc(staff, 'integrityCases', 'case-1'), { status: 'resolved', resolution: 'Reviewed the supplied replay.', reviewerId: 'someone-else', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(staff, 'integrityCases', 'case-1'), { status: 'reviewing', resolution: 'Reviewing the supplied replay.', reviewerId: 'staff', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(staff, 'integrityCases', 'case-1'), { status: 'resolved', resolution: 'Reviewed replay and corrected the score.', reviewerId: 'staff', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(staff, 'integrityCases', 'case-1'), { status: 'reviewing', resolution: 'Trying to reopen the closed case.', reviewerId: 'staff', updatedAt: serverTimestamp() }));
});
test('profile verification must match the authentication token', async () => {
  await assertFails(updateDoc(doc(db('unverified', { email_verified: false }), 'users', 'unverified'), { emailVerified: true }));
  await assertSucceeds(updateDoc(doc(db('unverified'), 'users', 'unverified'), { emailVerified: true }));
});

test('profile edits persist for the owner and cannot alter account identity or privileges', async () => {
  const owner = db('other', { email: 'other@arena.test' });
  await assertSucceeds(updateDoc(doc(owner, 'users', 'other'), { name: 'Updated Player', collegeName: 'Updated Campus', avatarInitials: 'UP' }));
  const updated = await getDoc(doc(owner, 'users', 'other'));
  if (updated.data().name !== 'Updated Player' || updated.data().collegeName !== 'Updated Campus') throw new Error('Profile edits were not persisted.');
  await assertFails(updateDoc(doc(db('reporter'), 'users', 'other'), { name: 'Impersonation' }));
  await assertFails(updateDoc(doc(owner, 'users', 'other'), { status: 'banned' }));
  await assertFails(updateDoc(doc(owner, 'users', 'other'), { uid: 'reporter' }));
  await assertFails(updateDoc(doc(owner, 'users', 'other'), { email: 'arbitrary@arena.test' }));
  const verifiedChange = db('other', { email: 'verified-new@arena.test' });
  await assertSucceeds(updateDoc(doc(verifiedChange, 'users', 'other'), { email: 'verified-new@arena.test' }));
});

test('tournament publishing requires verified active staff; the legacy bracket document is read-only', async () => {
  const tournament = (id, overrides = {}) => ({ id, title: 'QA Cup', gameId: 'game-dota2', gameName: 'Dota 2', gameKey: 'game-dota2', format: 'Single Elimination', matchFormat: 'Bo3', teamsCount: 2, seedingRule: 'Seed', createdAt: '1/1/2026', status: 'published', revision: 1, featured: false, matches: [], updatedAt: serverTimestamp(), ...overrides });
  await assertFails(setDoc(doc(db('other'), 'tournaments', 'rules-t1'), tournament('rules-t1')));
  await assertFails(setDoc(doc(db('unverified', { role: 'organizer', email_verified: false }), 'tournaments', 'rules-t1'), tournament('rules-t1')));
  await assertFails(setDoc(doc(db('banned', { role: 'organizer', email: 'staff@wmsu.edu.ph' }), 'tournaments', 'rules-t1'), tournament('rules-t1')));
  await assertSucceeds(setDoc(doc(db('staff', { role: 'organizer', email: 'staff@wmsu.edu.ph' }), 'tournaments', 'rules-t1'), tournament('rules-t1')));
  await assertSucceeds(getDoc(doc(db('other', { email: 'other@wmsu.edu.ph' }), 'tournaments', 'rules-t1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'tournaments', 'rules-t1')));
  await assertFails(setDoc(doc(db('staff', { role: 'organizer', email: 'staff@wmsu.edu.ph' }), 'arenahub', 'brackets'), { publishedBrackets: [] }));
  await assertSucceeds(getDoc(doc(db('other', { email: 'other@wmsu.edu.ph' }), 'arenahub', 'brackets')));
});

test('verified campus students issue QR invitations without admin approval for password spectators; external Google accounts stay blocked', async () => {
  const student = db('other', { email: 'other@wmsu.edu.ph' });
  const personal = db('reporter', { email: 'reporter@example.com', firebase: { sign_in_provider: 'google.com' } });
  const password = db('reporter', { email: 'reporter@example.com', firebase: { sign_in_provider: 'password' } });
  const unverified = db('reporter', { email: 'reporter@example.com', email_verified: false, firebase: { sign_in_provider: 'google.com' } });
  const anonymous = env.unauthenticatedContext().firestore();
  const token = 'a'.repeat(48);
  const expired = 'c'.repeat(48);
  const issue = (database, uid, value) => {
    const batch = writeBatch(database);
    batch.set(doc(database, 'studentInviteSlots', uid), { token: value, createdAt: serverTimestamp() });
    batch.set(doc(database, 'campusInvites', value), { issuer: uid, createdAt: serverTimestamp() });
    return batch.commit();
  };
  const redeem = (database, invite) => setDoc(doc(database, 'spectatorAdmissions', 'reporter'), {
    email: 'reporter@example.com', invite, admittedAt: serverTimestamp(),
  });

  await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'users', 'other'), { spectatorInviteApproved: false }));
  await assertFails(issue(student, 'other', token));
  await assertFails(updateDoc(doc(student, 'users', 'other'), { spectatorInviteApproved: true }));
  await assertFails(issue(personal, 'reporter', token));
  await assertFails(getDoc(doc(personal, 'tournaments', 'rules-t1')));
  await env.withSecurityRulesDisabled(async context => {
    const store = context.firestore();
    await updateDoc(doc(store, 'users', 'other'), { spectatorInviteApproved: deleteField(), email: 'other@wmsu.edu.ph', emailVerified: true, name: 'Test Student' });
    const createdAt = Timestamp.fromMillis(Date.now() - 21 * 60 * 1000);
    await setDoc(doc(store, 'studentInviteSlots', 'other'), { token: expired, createdAt });
    await setDoc(doc(store, 'campusInvites', expired), { issuer: 'other', createdAt });
  });
  await assertFails(getDoc(doc(anonymous, 'campusInvites', expired)));
  await assertFails(redeem(personal, expired));
  await assertSucceeds(issue(student, 'other', token));
  await assertFails(issue(student, 'other', 'b'.repeat(48)));
  await assertSucceeds(getDoc(doc(anonymous, 'campusInvites', token)));
  await assertFails(getDocs(collection(anonymous, 'campusInvites')));
  await assertFails(getDoc(doc(personal, 'studentInviteSlots', 'other')));
  await assertFails(redeem(unverified, token));
  await assertFails(getDoc(doc(password, 'tournaments', 'rules-t1')));
  await assertFails(redeem(personal, 'd'.repeat(48)));
  await assertFails(redeem(personal, token));
  await assertSucceeds(redeem(password, token));
  await assertFails(getDoc(doc(personal, 'tournaments', 'rules-t1')));
  await assertSucceeds(getDoc(doc(password, 'tournaments', 'rules-t1')));
  const message = async (database, uid, id, author, extra = {}) => {
    // Clear the pace record so the 2 second chat floor does not interfere; tests/chat.rules.test.mjs covers pacing.
    await env.withSecurityRulesDisabled(async context => { const { deleteDoc } = await import('firebase/firestore'); await deleteDoc(doc(context.firestore(), 'matchChat', 'test-match', 'pace', uid)); });
    const batch = writeBatch(database);
    batch.set(doc(database, 'matchChat', 'test-match', 'messages', id), { author, text: 'Go team!', createdAt: serverTimestamp(), ...extra });
    batch.set(doc(database, 'matchChat', 'test-match', 'authors', id), { uid, createdAt: serverTimestamp() });
    batch.set(doc(database, 'matchChat', 'test-match', 'pace', uid), { lastMessageAt: serverTimestamp(), messageId: id });
    return batch.commit();
  };
  await assertSucceeds(message(student, 'other', 'named', 'Test Student'));
  await assertSucceeds(message(student, 'other', 'anonymous', 'Anonymous'));
  await assertFails(message(student, 'other', 'spoofed', 'Someone Else'));
  await assertFails(message(student, 'other', 'email-exposed', 'Anonymous', { email: 'other@wmsu.edu.ph' }));
  await assertFails(message(personal, 'reporter', 'spectator', 'Anonymous'));
  // A guest admitted with a student invite can comment.
  await assertSucceeds(message(password, 'reporter', 'guest-comment', 'Anonymous'));
  await assertFails(getDoc(doc(personal, 'matchChat', 'test-match', 'messages', 'anonymous')));
  await assertFails(getDoc(doc(personal, 'matchChat', 'test-match', 'authors', 'anonymous')));
  await assertSucceeds(getDoc(doc(password, 'matchChat', 'test-match', 'messages', 'anonymous')));
  await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'users', 'other'), { spectatorInviteApproved: false }));
  await assertFails(getDoc(doc(anonymous, 'campusInvites', token)));
  // Short 10-character codes work like the old tokens; letters that look alike (I, L, O) are never used.
  await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'users', 'other'), { spectatorInviteApproved: deleteField() }));
  await env.withSecurityRulesDisabled(async context => { const { deleteDoc } = await import('firebase/firestore'); await deleteDoc(doc(context.firestore(), 'studentInviteSlots', 'other')); });
  await assertFails(issue(student, 'other', '7K3QMX9PRI'));
  await assertSucceeds(issue(student, 'other', '7K3QMX9PRT'));
  await assertSucceeds(getDoc(doc(anonymous, 'campusInvites', '7K3QMX9PRT')));
  await assertFails(getDoc(doc(personal, 'tournaments', 'rules-t1')));
});
