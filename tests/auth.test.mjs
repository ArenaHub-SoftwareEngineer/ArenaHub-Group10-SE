import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, applyActionCode, reload, sendPasswordResetEmail, confirmPasswordReset, verifyBeforeUpdateEmail, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDocFromServer, terminate } from 'firebase/firestore';

// Hardcoded demo project and loopback emulators: never contact a real Firebase account.
test('authentication, verification, reset, verified email changes and profile persistence work together', async () => {
  const app = initializeApp({ projectId: 'demo-arenahub', apiKey: 'demo-arenahub-key' }, `auth-test-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9098', { disableWarnings: true });
  const database = getFirestore(app);
  connectFirestoreEmulator(database, '127.0.0.1', 8085);
  const email = `player-${Date.now()}@arena.test`;
  const nextEmail = `new-${email}`;
  async function codeFor(address, type) {
    const response = await fetch('http://127.0.0.1:9098/emulator/v1/projects/demo-arenahub/oobCodes');
    const data = await response.json();
    const code = data.oobCodes?.filter(c => c.email === address && c.requestType === type).at(-1);
    assert.ok(code, `Expected emulator ${type} message`);
    return code.oobCode;
  }
  try {
    await assert.rejects(createUserWithEmailAndPassword(auth, email, '123'), { code: 'auth/weak-password' });
    const { user } = await createUserWithEmailAndPassword(auth, email, 'ArenaTest!2026');
    const profile = doc(database, 'users', user.uid);
    await setDoc(profile, { uid: user.uid, email, name: 'Test Player', collegeName: 'Test Campus', avatarInitials: 'TP', role: 'user', status: 'active', emailVerified: false });
    await assert.rejects(updateDoc(profile, { role: 'admin' }), { code: 'permission-denied' });
    await sendEmailVerification(user);
    await applyActionCode(auth, await codeFor(email, 'VERIFY_EMAIL'));
    await reload(user); await user.getIdToken(true);
    assert.equal(user.emailVerified, true);
    await updateDoc(profile, { emailVerified: true, name: 'Updated Player', collegeName: 'Updated Campus' });
    assert.equal((await getDocFromServer(profile)).data().name, 'Updated Player');
    await signOut(auth);
    await assert.rejects(signInWithEmailAndPassword(auth, email, 'wrong-password'));
    await signInWithEmailAndPassword(auth, email, 'ArenaTest!2026');
    await sendPasswordResetEmail(auth, email);
    await confirmPasswordReset(auth, await codeFor(email, 'PASSWORD_RESET'), 'ResetTest!2026');
    await signOut(auth);
    await assert.rejects(signInWithEmailAndPassword(auth, email, 'ArenaTest!2026'));
    const changed = await signInWithEmailAndPassword(auth, email, 'ResetTest!2026');
    await verifyBeforeUpdateEmail(changed.user, nextEmail);
    await applyActionCode(auth, await codeFor(email, 'VERIFY_AND_CHANGE_EMAIL'));
    await signOut(auth);
    const updated = await signInWithEmailAndPassword(auth, nextEmail, 'ResetTest!2026');
    assert.equal(updated.user.email, nextEmail);
    await updateDoc(profile, { email: nextEmail, emailVerified: updated.user.emailVerified });
    assert.equal((await getDocFromServer(profile)).data().email, nextEmail);
    await signOut(auth);
    await assert.rejects(getDocFromServer(profile), { code: 'permission-denied' });
  } finally { await terminate(database); await deleteApp(app); }
});
