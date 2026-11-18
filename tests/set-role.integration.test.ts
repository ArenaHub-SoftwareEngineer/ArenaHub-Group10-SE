// scripts/set-role.mjs against the Auth and Firestore emulators. Never touches a real project.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9098';
const STORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
process.env.FIRESTORE_EMULATOR_HOST = STORE;
const app = getApps()[0] || initializeApp({ projectId: 'demo-arenahub' });
const email = `role-${Date.now()}@wmsu.edu.ph`;

const run = (args: string[], env: Record<string, string | undefined> = {}) => {
  const merged: NodeJS.ProcessEnv = { ...process.env, FIREBASE_AUTH_EMULATOR_HOST: AUTH, FIRESTORE_EMULATOR_HOST: STORE, GCLOUD_PROJECT: 'demo-arenahub', ...env };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete merged[key];
  return spawnSync(process.execPath, ['scripts/set-role.mjs', ...args], { encoding: 'utf8', env: merged });
};
const claims = async () => (await getAuth(app).getUserByEmail(email)).customClaims || {};

before(async () => { await getAuth(app).createUser({ email, emailVerified: true, password: 'ArenaHub-QA-Only-27!' }); });

test('grants each staff role, keeps unrelated claims, and revokes', async () => {
  await getAuth(app).setCustomUserClaims((await getAuth(app).getUserByEmail(email)).uid, { team: 'qa' });
  const granted = run([email, 'organizer']);
  assert.equal(granted.status, 0, granted.stderr);
  assert.deepEqual(await claims(), { team: 'qa', role: 'organizer' });

  assert.equal(run([email, 'admin']).status, 0);
  assert.deepEqual(await claims(), { team: 'qa', role: 'admin', admin: true });

  // Downgrading from admin removes the admin flag.
  assert.equal(run([email, 'moderator']).status, 0);
  assert.deepEqual(await claims(), { team: 'qa', role: 'moderator' });

  assert.equal(run([email, 'none']).status, 0);
  assert.deepEqual(await claims(), { team: 'qa' });

  const shown = run([email, '--show']);
  assert.equal(shown.status, 0);
  assert.equal(JSON.parse(shown.stdout).role, null);
});

test('mirrors the role onto an existing profile for display, and resets it on revoke', async () => {
  const uid = (await getAuth(app).getUserByEmail(email)).uid;
  const profile = getFirestore(app).collection('users').doc(uid);
  await profile.set({ uid, email, role: 'user', status: 'active' });
  assert.equal(run([email, 'organizer']).status, 0);
  assert.equal((await profile.get()).data()?.role, 'organizer');
  assert.equal(run([email, 'none']).status, 0);
  assert.equal((await profile.get()).data()?.role, 'user');
});

test('every change is written to the audit log by id, not by email', async () => {
  const uid = (await getAuth(app).getUserByEmail(email)).uid;
  const events = await getFirestore(app).collection('auditEvents').where('actorId', '==', 'cli:set-role').get();
  const mine = events.docs.map(d => d.data().action as string).filter(action => action.includes(uid));
  assert.ok(mine.some(a => a === `Staff role organizer granted to ${uid}`));
  assert.ok(mine.some(a => a === `Staff access revoked for ${uid}`));
  assert.ok(mine.every(a => !a.includes(email)));
});

test('refuses unknown roles, unknown accounts, and real projects without confirmation', () => {
  assert.match(run([email, 'superuser']).stderr, /Unknown role/);
  assert.match(run(['nobody-here@wmsu.edu.ph', 'organizer']).stderr, /No account/);
  assert.match(run([email, 'organizer'], { FIREBASE_AUTH_EMULATOR_HOST: undefined }).stderr, /No FIREBASE_AUTH_EMULATOR_HOST/);
  assert.match(run([email, 'organizer', '--project', 'wmsu-arl-hub']).stderr, /without --confirm-production/);
  // Even with confirmation, an emulator variable in the environment blocks a production change.
  assert.match(run([email, 'organizer', '--project', 'wmsu-arl-hub', '--confirm-production']).stderr, /FIREBASE_AUTH_EMULATOR_HOST is set/);
  assert.match(run([email, 'organizer', '--project', 'wmsu-arl-hub', '--confirm-production'], { FIREBASE_AUTH_EMULATOR_HOST: undefined, GOOGLE_APPLICATION_CREDENTIALS: undefined }).stderr, /GOOGLE_APPLICATION_CREDENTIALS/);
});
