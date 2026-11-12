import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
let env;
// Cross-service rules in the Storage emulator use the CLI's selected demo project.
const projectId = 'demo-arenahub';
const context = (uid, staff = false) => env.authenticatedContext(`evidence-${uid}`, { email_verified: true, email: `${uid}@wmsu.edu.ph`, ...(staff ? { admin: true } : {}) });
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') }, storage: { host: '127.0.0.1', port: 9198, rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') } });
  await env.withSecurityRulesDisabled(async ctx => {
    for (const uid of ['reporter', 'other', 'staff', 'banned']) await setDoc(doc(ctx.firestore(), 'users', `evidence-${uid}`), { uid: `evidence-${uid}`, status: uid === 'banned' ? 'banned' : 'active' });
    await deleteDoc(doc(ctx.firestore(), 'integrityCases/evidence-storage-case'));
  });
});
after(async () => { await env?.cleanup(); });
test('evidence uploads are private, scoped, and immutable once attached to a case', async t => {
  const path = `integrityEvidence/evidence-reporter/evidence-storage-case/${Date.now()}`;
  const own = ref(context('reporter').storage(`gs://${projectId}.appspot.com`), path), other = ref(context('other').storage(`gs://${projectId}.appspot.com`), path), staff = ref(context('staff', true).storage(`gs://${projectId}.appspot.com`), path);
  const outsideGoogle = ref(env.authenticatedContext('evidence-reporter', { email_verified: true, email: 'reporter@gmail.com', admin: true, firebase: { sign_in_provider: 'google.com' } }).storage(`gs://${projectId}.appspot.com`), path);
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await assertFails(uploadBytes(other, bytes, { contentType: 'image/png' }));
  await assertFails(uploadBytes(own, bytes, { contentType: 'text/html' }));
  await t.test('owner can create evidence', () => assertSucceeds(uploadBytes(own, bytes, { contentType: 'image/png' })));
  await assertFails(uploadBytes(outsideGoogle, bytes, { contentType: 'image/png' }));
  await assertFails(getBytes(outsideGoogle));
  await t.test('owner and staff can read while other users cannot', async () => { await assertSucceeds(getBytes(own)); await assertSucceeds(getBytes(staff)); await assertFails(getBytes(other)); });
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'integrityCases/evidence-storage-case'), { reporterId: 'evidence-reporter', status: 'open' }));
  await assertFails(uploadBytes(own, bytes, { contentType: 'image/png' }));
  await assertFails(deleteObject(own)); await assertFails(deleteObject(staff));
  await assertFails(getBytes(ref(context('banned').storage(`gs://${projectId}.appspot.com`), path)));
});
