// Removing a viewer from chat deletes every message they posted in the match, beyond one 400-message page,
// using the real client code signed in as the seeded organizer. Emulators only (seeded by tests/seed-emulators.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, terminate, writeBatch, Timestamp } from 'firebase/firestore';
import { deleteApp } from 'firebase/app';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

test('a kick removes all of the viewer\'s messages in the match and blocks posting', async t => {
  const vite = await createServer({ mode: 'test', server: { middlewareMode: true }, appType: 'custom' });
  t.after(() => vite.close());
  const firebase = await vite.ssrLoadModule('/src/lib/firebase.ts');
  assert.equal(firebase.app.options.projectId, 'demo-arenahub', 'Integration tests must never use a production project.');
  const chat = await vite.ssrLoadModule('/src/lib/matchChat.ts');
  const env = await initializeTestEnvironment({ projectId: 'demo-arenahub', firestore: { host: '127.0.0.1', port: 8085 } });
  t.after(async () => { await signOut(firebase.auth); await terminate(firebase.db); await deleteApp(firebase.app); await env.cleanup(); });

  const matchId = `kick-${Date.now()}`, spammer = 'kick-target-uid', bystander = 'kick-bystander-uid', SPAM = 450;
  await env.withSecurityRulesDisabled(async ctx => {
    const store = ctx.firestore();
    const seed = async (uid, count, prefix) => {
      for (let start = 0; start < count; start += 200) {
        const batch = writeBatch(store);
        for (let i = start; i < Math.min(count, start + 200); i++) {
          const createdAt = Timestamp.fromMillis(Date.now() - (count - i) * 1000);
          batch.set(doc(store, 'matchChat', matchId, 'messages', `${prefix}-${String(i).padStart(4, '0')}`), { author: 'Anonymous', text: `${prefix} ${i}`, createdAt });
          batch.set(doc(store, 'matchChat', matchId, 'authors', `${prefix}-${String(i).padStart(4, '0')}`), { uid, createdAt });
        }
        await batch.commit();
      }
    };
    await seed(spammer, SPAM, 'spam');
    await seed(bystander, 3, 'ok');
  });

  const { user } = await signInWithEmailAndPassword(firebase.auth, 'organizer@wmsu.edu.ph', 'ArenaHub-QA-Only-27!');
  const removed = await chat.kickChatUser(matchId, user.uid, { id: 'spam-0449', author: 'Anonymous' }, 'Spam');
  assert.equal(removed, SPAM);

  const left = (await getDocs(collection(firebase.db, 'matchChat', matchId, 'messages'))).docs.map(d => d.id).sort();
  assert.deepEqual(left, ['ok-0000', 'ok-0001', 'ok-0002'], 'only the other viewer\'s messages remain');
  const mute = (await getDoc(doc(firebase.db, 'matchChat', matchId, 'mutes', spammer))).data();
  assert.equal(mute.kind, 'kick');
  assert.ok(mute.until.toMillis() > Date.now() + 5 * 3_600_000, 'blocked for about 6 hours');
  assert.equal(mute.name, 'Anonymous');
  // The audit event names the account id, not a name or email.
  const audit = (await getDoc(doc(firebase.db, 'auditEvents', mute.auditId))).data();
  assert.equal(audit.action, `Chat kick 6 h in match ${matchId} (target ${spammer})`);

});
