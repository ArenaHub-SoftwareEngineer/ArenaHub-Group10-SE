import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { deleteApp } from 'firebase/app';
import { doc, getDocFromServer, updateDoc, terminate } from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

test('draft saves and deletes await permission checks and preserve the saved copy on failure', async t => {
  const vite = await createServer({ mode: 'test', server: { middlewareMode: true }, appType: 'custom' });
  t.after(() => vite.close());
  const firebase = await vite.ssrLoadModule('/src/lib/firebase.ts');
  assert.equal(firebase.app.options.projectId, 'demo-arenahub');
  const { firestoreService } = await vite.ssrLoadModule('/src/lib/firestore.ts');
  const { createPrebuiltManualBracket } = await vite.ssrLoadModule('/src/lib/bracketUtils.ts');
  const env = await initializeTestEnvironment({ projectId: 'demo-arenahub', firestore: { host: '127.0.0.1', port: 8085 } });
  const { user } = await signInWithEmailAndPassword(firebase.auth, 'organizer@wmsu.edu.ph', 'ArenaHub-QA-Only-27!');
  const profile = doc(firebase.db, 'users', user.uid);
  const setStatus = status => env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'users', user.uid), { status }));
  t.after(async () => {
    await setStatus('active');
    await signOut(firebase.auth);
    await terminate(firebase.db);
    await deleteApp(firebase.app);
    await env.cleanup();
  });

  const draft = createPrebuiltManualBracket({ title: 'QA draft persistence', teamCount: 5 });
  const saved = await firestoreService.saveBracketDraft(draft);
  const ref = doc(firebase.db, 'users', user.uid, 'drafts', saved.id);
  assert.equal((await getDocFromServer(ref)).data().draft.title, draft.title);
  assert.equal(firestoreService.getSavedBracketDrafts().find(item => item.id === saved.id)?.title, draft.title);

  await setStatus('banned');
  await assert.rejects(firestoreService.saveBracketDraft({ ...saved, title: 'Denied edit' }), /permission/i);
  assert.equal(firestoreService.getSavedBracketDrafts().find(item => item.id === saved.id)?.title, draft.title);
  await assert.rejects(firestoreService.deleteSavedBracketDraft(saved.id), /permission/i);
  assert.ok(firestoreService.getSavedBracketDrafts().some(item => item.id === saved.id));

  await setStatus('active');
  assert.equal((await getDocFromServer(profile)).data().status, 'active');
  assert.equal((await getDocFromServer(ref)).data().draft.title, draft.title);
  await firestoreService.deleteSavedBracketDraft(saved.id);
  assert.equal((await getDocFromServer(ref)).exists(), false);
  assert.equal(firestoreService.getSavedBracketDrafts().some(item => item.id === saved.id), false);
});
