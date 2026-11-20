// Live chat moderation rules: timed mute and kick, slow mode, pinned message, staff badge,
// reserved "Arena AI" name and audited staff actions. These hold even when the UI is bypassed.
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-arenahub', firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').at(-1)) || 8085, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const [uid, name] of [['student', 'Chat Student'], ['other', 'Other Student'], ['mod', 'Chat Moderator'], ['impostor', 'Arena AI']]) {
      await setDoc(doc(ctx.firestore(), 'users', uid), { uid, name, email: `${uid}@wmsu.edu.ph`, role: 'user', status: 'active', emailVerified: true });
    }
  });
});
after(async () => { await env?.cleanup(); });

const db = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, email: `${uid}@wmsu.edu.ph`, ...claims }).firestore();
const student = () => db('student');
const mod = () => db('mod', { role: 'moderator' });
let counter = 0;
const nextId = () => `m${++counter}`;

function send(database, matchId, uid, author, { id = nextId(), extra = {}, pace = true } = {}) {
  const batch = writeBatch(database);
  batch.set(doc(database, 'matchChat', matchId, 'messages', id), { author, text: `Message ${id}`, createdAt: serverTimestamp(), ...extra });
  batch.set(doc(database, 'matchChat', matchId, 'authors', id), { uid, createdAt: serverTimestamp() });
  if (pace) batch.set(doc(database, 'matchChat', matchId, 'pace', uid), { lastMessageAt: serverTimestamp(), messageId: id });
  return batch.commit();
}
const seed = fn => env.withSecurityRulesDisabled(async ctx => fn(ctx.firestore()));
const setPaceAgo = (matchId, uid, seconds) => seed(store => setDoc(doc(store, 'matchChat', matchId, 'pace', uid), { lastMessageAt: Timestamp.fromMillis(Date.now() - seconds * 1000), messageId: 'old' }));

function audited(database, staffUid, write) {
  const batch = writeBatch(database);
  const auditRef = doc(collection(database, 'auditEvents'));
  batch.set(auditRef, { actorId: staffUid, action: 'Chat moderation test', createdAt: serverTimestamp() });
  write(batch, auditRef.id);
  return batch.commit();
}
const mute = (database, staffUid, matchId, target, minutes, overrides = {}) => audited(database, staffUid, (batch, auditId) =>
  batch.set(doc(database, 'matchChat', matchId, 'mutes', target), { until: Timestamp.fromMillis(Date.now() + minutes * 60_000), kind: 'mute', reason: '', name: 'Chat Student', by: staffUid, auditId, createdAt: serverTimestamp(), ...overrides }));
const setState = (database, staffUid, matchId, state) => audited(database, staffUid, (batch, auditId) =>
  batch.set(doc(database, 'matchChat', matchId), { slowModeSec: 0, pinned: null, updatedBy: staffUid, auditId, updatedAt: serverTimestamp(), ...state }));

test('a message needs its pace record, and back-to-back posts are held to the 2 second floor', async () => {
  await assertFails(send(student(), 'floor', 'student', 'Chat Student', { pace: false }));
  await assertSucceeds(send(student(), 'floor', 'student', 'Chat Student'));
  await assertFails(send(student(), 'floor', 'student', 'Chat Student'));
  await setPaceAgo('floor', 'student', 3);
  await assertSucceeds(send(student(), 'floor', 'student', 'Chat Student'));
});

test('slow mode is enforced by the rules, and staff are exempt', async () => {
  await assertSucceeds(setState(mod(), 'mod', 'slow', { slowModeSec: 30 }));
  await setPaceAgo('slow', 'student', 10);
  await assertFails(send(student(), 'slow', 'student', 'Chat Student'));
  await setPaceAgo('slow', 'student', 31);
  await assertSucceeds(send(student(), 'slow', 'student', 'Chat Student'));
  await assertSucceeds(send(mod(), 'slow', 'mod', 'Chat Moderator'));
  await assertSucceeds(send(mod(), 'slow', 'mod', 'Chat Moderator'));
  // A viewer cannot backdate their own pace record to skip slow mode.
  await assertFails(setDoc(doc(student(), 'matchChat', 'slow', 'pace', 'student'), { lastMessageAt: Timestamp.fromMillis(0), messageId: 'forged' }));
});

test('only staff change chat state, only to allowed values, and only with an audit event', async () => {
  await assertFails(setState(student(), 'student', 'state', { slowModeSec: 10 }));
  await assertFails(setState(mod(), 'mod', 'state', { slowModeSec: 45 }));
  await assertFails(setDoc(doc(mod(), 'matchChat', 'state'), { slowModeSec: 10, pinned: null, updatedBy: 'mod', auditId: 'missing', updatedAt: serverTimestamp() }));
  await assertSucceeds(setState(mod(), 'mod', 'state', { slowModeSec: 10 }));
  await assertSucceeds(getDoc(doc(student(), 'matchChat', 'state')));
});

test('a pin must quote an existing message exactly', async () => {
  await assertSucceeds(send(student(), 'pin', 'student', 'Chat Student', { id: 'pin-source' }));
  await assertFails(setState(mod(), 'mod', 'pin', { pinned: { messageId: 'pin-source', author: 'Chat Student', text: 'Edited words' } }));
  await assertFails(setState(mod(), 'mod', 'pin', { pinned: { messageId: 'no-such-message', author: 'X', text: 'Hi' } }));
  await assertSucceeds(setState(mod(), 'mod', 'pin', { pinned: { messageId: 'pin-source', author: 'Chat Student', text: 'Message pin-source' } }));
});

test('the staff badge comes from the token role, not the profile', async () => {
  await assertFails(send(student(), 'badge', 'student', 'Chat Student', { extra: { badge: 'staff' } }));
  await assertFails(send(mod(), 'badge', 'mod', 'Chat Moderator', { extra: { badge: 'admin' } }));
  await assertSucceeds(send(mod(), 'badge', 'mod', 'Chat Moderator', { extra: { badge: 'staff' } }));
});

test('"Arena AI" is reserved in chat and in profile names', async () => {
  const impostor = db('impostor');
  await assertFails(send(impostor, 'reserved', 'impostor', 'Arena AI'));
  await assertSucceeds(send(impostor, 'reserved', 'impostor', 'Anonymous'));
  await assertFails(updateDoc(doc(student(), 'users', 'student'), { name: 'arena-ai' }));
  await assertFails(updateDoc(doc(student(), 'users', 'student'), { name: ' [Arena AI] ' }));
  await assertSucceeds(updateDoc(doc(student(), 'users', 'student'), { name: 'Arena Aiden' }));
  await assertSucceeds(updateDoc(doc(student(), 'users', 'student'), { name: 'Chat Student' }));
});

test('anonymous posts may use a generated alias, but only in the exact alias shape', async () => {
  await assertSucceeds(send(db('other'), 'alias-a', 'other', 'Anonymous Swift Kraken'));
  await assertSucceeds(send(db('other'), 'alias-b', 'other', 'Anonymous Tidal Pawikan'));
  // Lower-case words, extra words or a lookalike prefix are refused: only the profile name or an alias may be used.
  await assertFails(send(db('other'), 'alias-c', 'other', 'Anonymous swift kraken'));
  await assertFails(send(db('other'), 'alias-d', 'other', 'Anonymous Swift Kraken Staff'));
  await assertFails(send(db('other'), 'alias-e', 'other', 'Anon Swift Kraken'));
  await assertFails(send(db('other'), 'alias-f', 'other', 'Anonymous Arena Ai'));
});

test('a timed mute blocks posting until it expires; the viewer sees only their own mute', async () => {
  await assertFails(mute(student(), 'student', 'mute', 'other', 20));
  await assertFails(mute(mod(), 'mod', 'mute', 'mod', 20));
  await assertFails(mute(mod(), 'mod', 'mute', 'student', 25 * 60));
  await assertFails(mute(mod(), 'mod', 'mute', 'student', 20, { name: 'x'.repeat(81) }));
  await assertFails(setDoc(doc(mod(), 'matchChat', 'mute', 'mutes', 'student'), { until: Timestamp.fromMillis(Date.now() + 60_000), kind: 'mute', reason: '', by: 'mod', auditId: 'missing', createdAt: serverTimestamp() }));
  await assertSucceeds(mute(mod(), 'mod', 'mute', 'student', 20));

  await assertFails(send(student(), 'mute', 'student', 'Chat Student'));
  await assertFails(send(student(), 'mute', 'student', 'Anonymous'));
  await assertSucceeds(send(db('other'), 'mute', 'other', 'Other Student'));
  await assertSucceeds(getDoc(doc(student(), 'matchChat', 'mute', 'mutes', 'student')));
  await assertFails(getDoc(doc(db('other'), 'matchChat', 'mute', 'mutes', 'student')));
  await assertFails(deleteDoc(doc(student(), 'matchChat', 'mute', 'mutes', 'student')));

  await seed(store => updateDoc(doc(store, 'matchChat', 'mute', 'mutes', 'student'), { until: Timestamp.fromMillis(Date.now() - 1000) }));
  await assertSucceeds(send(student(), 'mute', 'student', 'Chat Student'));
});

test('a kick lets staff find and remove the viewer messages; viewers cannot list authors', async () => {
  await assertSucceeds(send(student(), 'kick', 'student', 'Chat Student', { id: 'k1' }));
  await setPaceAgo('kick', 'student', 3);
  await assertSucceeds(send(student(), 'kick', 'student', 'Anonymous', { id: 'k2' }));
  await assertSucceeds(send(db('other'), 'kick', 'other', 'Other Student', { id: 'k3' }));
  await assertFails(getDocs(query(collection(student(), 'matchChat', 'kick', 'authors'), where('uid', '==', 'student'))));

  const staff = mod();
  const posted = await getDocs(query(collection(staff, 'matchChat', 'kick', 'authors'), where('uid', '==', 'student')));
  if (posted.size !== 2) throw new Error(`Expected 2 messages from the kicked viewer, found ${posted.size}.`);
  await assertSucceeds(audited(staff, 'mod', (batch, auditId) => {
    batch.set(doc(staff, 'matchChat', 'kick', 'mutes', 'student'), { until: Timestamp.fromMillis(Date.now() + 6 * 3_600_000), kind: 'kick', reason: 'Spam', by: 'mod', auditId, createdAt: serverTimestamp() });
    posted.docs.forEach(item => batch.delete(doc(staff, 'matchChat', 'kick', 'messages', item.id)));
  }));
  const left = await getDocs(collection(staff, 'matchChat', 'kick', 'messages'));
  if (left.docs.map(d => d.id).join() !== 'k3') throw new Error('Only the other viewer message should remain.');
  await setPaceAgo('kick', 'student', 60);
  await assertFails(send(student(), 'kick', 'student', 'Chat Student'));
  await assertFails(deleteDoc(doc(student(), 'matchChat', 'kick', 'messages', 'k3')));
  await assertSucceeds(deleteDoc(doc(staff, 'matchChat', 'kick', 'mutes', 'student')));
});

test('Arena AI replies are server-only: clients cannot write isAI or read the request counters', async () => {
  // A real student, real profile name, but claiming to be the assistant.
  await assertFails(send(student(), 'ai-only', 'student', 'Chat Student', { extra: { isAI: true } }));
  await assertFails(send(mod(), 'ai-only', 'mod', 'Chat Moderator', { extra: { isAI: true, badge: 'staff' } }));
  await assertFails(send(db('impostor'), 'ai-only', 'impostor', 'Arena AI'));
  // Replies posted by the server (firebase-admin bypasses the rules) are readable like any message.
  await seed(store => setDoc(doc(store, 'matchChat', 'ai-only', 'messages', 'reply'), { author: 'Arena AI', text: 'Live, not final.', isAI: true, createdAt: Timestamp.now() }));
  await assertSucceeds(getDoc(doc(student(), 'matchChat', 'ai-only', 'messages', 'reply')));
  // Staff can delete a wrong reply.
  await assertSucceeds(deleteDoc(doc(mod(), 'matchChat', 'ai-only', 'messages', 'reply')));
  await seed(store => setDoc(doc(store, 'aiRate', 'user_student_20261115120000'), { count: 5 }));
  for (const database of [student(), mod()]) {
    await assertFails(getDoc(doc(database, 'aiRate', 'user_student_20261115120000')));
    await assertFails(setDoc(doc(database, 'aiRate', 'user_student_20261115120000'), { count: 0 }));
  }
  // The 5-hour allowance: nobody can read or reset it from a browser, not even their own.
  await seed(store => setDoc(doc(store, 'aiUsage', 'student'), { used: 400000, windowStart: Timestamp.now() }));
  for (const database of [student(), mod()]) {
    await assertFails(getDoc(doc(database, 'aiUsage', 'student')));
    await assertFails(setDoc(doc(database, 'aiUsage', 'student'), { used: 0, windowStart: Timestamp.now() }));
  }
});

test('only staff turn Arena AI on or off in a chat, with an audit event', async () => {
  await assertSucceeds(setState(mod(), 'mod', 'ai-toggle', { aiEnabled: false }));
  await assertSucceeds(setState(mod(), 'mod', 'ai-toggle', { aiEnabled: true }));
  await assertFails(setState(mod(), 'mod', 'ai-toggle', { aiEnabled: 'yes' }));
  await assertFails(setState(student(), 'student', 'ai-toggle', { aiEnabled: false }));
  // Without the audit event in the same write, even staff are refused.
  await assertFails(setDoc(doc(mod(), 'matchChat', 'ai-toggle'), { slowModeSec: 0, pinned: null, aiEnabled: false, updatedBy: 'mod', auditId: 'missing', updatedAt: serverTimestamp() }));
});

test('Arena AI feedback: one rating per answer, own account only, readable by staff only', async () => {
  const rating = (uid, id, extra = {}) => ({ uid, rating: 'down', question: 'Who won?', answer: 'Iron Owls won.', source: 'Arena AI', references: ['Dota 2 Showdown'], note: '', createdAt: serverTimestamp(), ...extra });
  await assertSucceeds(setDoc(doc(student(), 'aiFeedback', 'student_msg-1'), rating('student')));
  // The same answer cannot be rated twice, and a rating cannot be edited.
  await assertFails(setDoc(doc(student(), 'aiFeedback', 'student_msg-1'), rating('student', 'x', { rating: 'up' })));
  await assertFails(updateDoc(doc(student(), 'aiFeedback', 'student_msg-1'), { rating: 'up' }));
  // Not in someone else's name, not with extra fields or a made-up rating.
  await assertFails(setDoc(doc(student(), 'aiFeedback', 'other_msg-2'), rating('other')));
  await assertFails(setDoc(doc(student(), 'aiFeedback', 'student_msg-3'), rating('student', 'x', { rating: 'meh' })));
  await assertFails(setDoc(doc(student(), 'aiFeedback', 'student_msg-4'), rating('student', 'x', { email: 'student@wmsu.edu.ph' })));
  // Students cannot read ratings, even their own; staff can read and dismiss them.
  await assertFails(getDoc(doc(student(), 'aiFeedback', 'student_msg-1')));
  await assertSucceeds(getDoc(doc(mod(), 'aiFeedback', 'student_msg-1')));
  await assertSucceeds(deleteDoc(doc(mod(), 'aiFeedback', 'student_msg-1')));
});
