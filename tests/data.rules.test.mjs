// Rules for the per-tournament data layer (Phase 1). Runs against the Firestore emulator only.
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, serverTimestamp } from 'firebase/firestore';

let env;
const campus = (uid, staff = false) => env.authenticatedContext(uid, { email_verified: true, email: `${uid}@wmsu.edu.ph`, ...(staff ? { role: 'organizer' } : {}) }).firestore();
const tournament = (id, overrides = {}) => ({
  id, title: 'Data Cup', gameId: 'game-mlbb', gameName: 'Mobile Legends: Bang Bang', gameKey: 'game-mlbb', format: 'Single Elimination',
  matchFormat: 'Bo3', teamsCount: 2, seedingRule: 'Seed', createdAt: '1/1/2026', status: 'published', revision: 1, featured: false,
  matches: [{ id: `${id}-m1`, status: 'upcoming', team1: { id: 'a', name: 'Alpha' }, team2: { id: 'b', name: 'Bravo' } }], updatedAt: serverTimestamp(), ...overrides,
});

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-arenahub-data', firestore: { host: '127.0.0.1', port: 8085, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const uid of ['student', 'staff', 'banned', 'staff2']) await setDoc(doc(ctx.firestore(), 'users', uid), { uid, email: `${uid}@wmsu.edu.ph`, status: uid === 'banned' ? 'banned' : 'active', emailVerified: true });
  });
});
after(async () => { await env?.cleanup(); });

test('every tournament update must raise the revision by exactly one', async () => {
  const staff = campus('staff', true);
  await assertSucceeds(setDoc(doc(staff, 'tournaments/t1'), tournament('t1')));
  await assertFails(setDoc(doc(staff, 'tournaments/t1'), tournament('t1', { revision: 1, title: 'Silent overwrite' })));
  await assertFails(setDoc(doc(staff, 'tournaments/t1'), tournament('t1', { revision: 5 })));
  await assertSucceeds(setDoc(doc(staff, 'tournaments/t1'), tournament('t1', { revision: 2 })));
  await assertFails(setDoc(doc(staff, 'tournaments/t1'), tournament('t1', { revision: 3, gameKey: 'game-dota2' })), 'a bracket cannot move to another game');
  await assertFails(setDoc(doc(staff, 'tournaments/t1'), tournament('t1', { revision: 3, extra: 'field' })));
  await assertFails(setDoc(doc(staff, 'tournaments/t1'), tournament('t1', { revision: 3, status: 'deleted' })));
  await assertFails(deleteDoc(doc(staff, 'tournaments/t1')));
});

test('students and banned staff cannot write tournaments', async () => {
  await assertFails(setDoc(doc(campus('student'), 'tournaments/t2'), tournament('t2')));
  await assertFails(setDoc(doc(campus('banned', true), 'tournaments/t2'), tournament('t2')));
  await assertFails(updateDoc(doc(campus('student'), 'tournaments/t1'), { title: 'Hijacked', revision: 3, updatedAt: serverTimestamp() }));
});

test('viewers see published and archived tournaments; withdrawn ones are staff only', async () => {
  const staff = campus('staff', true), student = campus('student');
  await assertSucceeds(setDoc(doc(staff, 'tournaments/old'), tournament('old', { status: 'archived' })));
  await assertSucceeds(setDoc(doc(staff, 'tournaments/pulled'), tournament('pulled', { status: 'unpublished' })));
  await assertSucceeds(getDoc(doc(student, 'tournaments/t1')));
  // Past events feed the cross-tournament player leaderboard (M10).
  await assertSucceeds(getDoc(doc(student, 'tournaments/old')));
  await assertSucceeds(getDocs(query(collection(student, 'tournaments'), where('status', '==', 'archived'))));
  await assertFails(getDoc(doc(student, 'tournaments/pulled')));
  await assertFails(getDocs(query(collection(student, 'tournaments'), where('status', '==', 'unpublished'))));
  await assertSucceeds(getDocs(query(collection(student, 'tournaments'), where('status', '==', 'published'))));
  await assertFails(getDocs(collection(student, 'tournaments')), 'an unfiltered list would expose withdrawn brackets');
  await assertSucceeds(getDoc(doc(staff, 'tournaments/old')));
  await assertSucceeds(getDoc(doc(staff, 'tournaments/pulled')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'tournaments/t1')));
});

test('public rosters are readable; the private roster is staff only', async () => {
  const staff = campus('staff', true), student = campus('student');
  await assertSucceeds(setDoc(doc(staff, 'tournaments/t1/public/rosters'), { teams: [{ id: 'a', name: 'Alpha', players: [{ id: 'p1', ign: 'Ace', role: 'Player', isVerified: true }] }] }));
  await assertSucceeds(getDoc(doc(student, 'tournaments/t1/public/rosters')));
  await assertFails(setDoc(doc(student, 'tournaments/t1/public/rosters'), { teams: [] }));
  await assertFails(setDoc(doc(staff, 'tournaments/t1/public/rosters'), { teams: [], studentIds: ['2024-1'] }));
  await assertSucceeds(setDoc(doc(staff, 'tournaments/t1/private/roster'), { teams: { a: { teamName: 'Alpha', collegeCode: 'CCS', players: [{ fullName: 'Real Name', studentId: '2024-00001', schoolEmail: 'real@wmsu.edu.ph', section: 'BSCS 2A', ign: 'Ace', role: 'Player', substitute: false }] } } }));
  await assertFails(getDoc(doc(student, 'tournaments/t1/private/roster')));
  await assertSucceeds(getDoc(doc(staff, 'tournaments/t1/private/roster')));
});

test('publication pointers and restore copies are staff only', async () => {
  const staff = campus('staff', true), student = campus('student');
  const pub = { gameKey: 'game-mlbb', currentId: 't1', hasPrevious: false, revision: 1, updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(staff, 'publications/game-mlbb'), pub));
  await assertFails(setDoc(doc(staff, 'publications/game-mlbb'), { ...pub, gameKey: 'game-dota2' }));
  await assertFails(getDoc(doc(student, 'publications/game-mlbb')));
  await assertSucceeds(setDoc(doc(staff, 'publications/game-mlbb/previous/tournament'), { id: 'old' }));
  await assertFails(setDoc(doc(staff, 'publications/game-mlbb/previous/other'), { id: 'old' }));
  await assertFails(getDoc(doc(student, 'publications/game-mlbb/previous/tournament')));
});

test('spotlight items need real fields and only the feature flag can change', async () => {
  const staff = campus('staff', true), student = campus('student');
  const item = { kind: 'highlight', title: 'Final clutch', link: 'https://youtu.be/example', author: 'CCS Media', isFeatured: false, createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(staff, 'featured/f1'), item));
  await assertFails(setDoc(doc(student, 'featured/f2'), item));
  await assertFails(setDoc(doc(staff, 'featured/f3'), { ...item, link: 'javascript:alert(1)' }));
  await assertFails(setDoc(doc(staff, 'featured/f4'), { ...item, meta: '2.1k views' }));
  await assertSucceeds(updateDoc(doc(staff, 'featured/f1'), { isFeatured: true }));
  await assertFails(updateDoc(doc(staff, 'featured/f1'), { title: 'Edited after the fact' }));
  await assertSucceeds(getDoc(doc(student, 'featured/f1')));
});

test('bracket drafts are private to the organizer who saved them', async () => {
  const staff = campus('staff', true), staff2 = campus('staff2', true), student = campus('student');
  const draft = { draft: { id: 'd1', title: 'Draft' }, savedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(staff, 'users/staff/drafts/d1'), draft));
  await assertFails(setDoc(doc(staff, 'users/staff/drafts/d2'), draft), 'the draft id must match the document id');
  await assertFails(getDoc(doc(staff2, 'users/staff/drafts/d1')));
  await assertFails(setDoc(doc(student, 'users/student/drafts/d1'), draft));
  await assertSucceeds(deleteDoc(doc(staff, 'users/staff/drafts/d1')));
});

test('legacy single documents are read-only', async () => {
  await assertFails(setDoc(doc(campus('staff', true), 'arenahub/brackets'), { publishedBrackets: [] }));
  await assertFails(setDoc(doc(campus('staff', true), 'arenahub/workspace'), { games: [] }));
});

test('Battle Royale placement data is accepted within its limits and rejected outside them', async () => {
  const staff = campus('staff', true);
  const squads = n => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Squad ${i}`, collegeCode: 'CCS' }));
  const placement = (overrides = {}) => ({ config: { pointsTable: [10, 6, 5, 4], killPoints: 1 }, teams: squads(4), games: [{ id: 'g1', label: 'Game 1', status: 'upcoming', results: [] }], ...overrides });
  const br = (id, p, revision = 1) => tournament(id, { gameId: 'game-codm-br', gameName: 'Call of Duty: Mobile Battle Royale', gameKey: 'game-codm-br', format: 'Battle Royale points', matches: [], placement: p, revision });
  await assertSucceeds(setDoc(doc(staff, 'tournaments/br1'), br('br1', placement())));
  await assertSucceeds(getDoc(doc(campus('student'), 'tournaments/br1')));
  await assertFails(setDoc(doc(campus('student'), 'tournaments/br2'), br('br2', placement())));
  await assertFails(setDoc(doc(staff, 'tournaments/br3'), br('br3', placement({ teams: squads(26) }))), 'a lobby holds at most 25 squads');
  await assertFails(setDoc(doc(staff, 'tournaments/br3'), br('br3', placement({ games: [] }))), 'an event needs at least one game');
  await assertFails(setDoc(doc(staff, 'tournaments/br3'), br('br3', placement({ config: { pointsTable: [10], killPoints: 50 } }))));
  await assertFails(setDoc(doc(staff, 'tournaments/br3'), br('br3', placement({ players: [] }))), 'no extra fields such as player data');
  await assertFails(setDoc(doc(staff, 'tournaments/br3'), br('br3', 'not a map')));
  await assertSucceeds(setDoc(doc(staff, 'tournaments/br1'), br('br1', placement({ games: [{ id: 'g1', label: 'Game 1', status: 'completed', results: [{ teamId: 's0', placement: 1, kills: 3 }] }] }), 2)));
});
