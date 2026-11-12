import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

const projectId = 'demo-arenahub';
const apiKey = 'demo-arenahub-key';
const endpoint = 'http://127.0.0.1:9098';
const app = initializeApp({ projectId, apiKey });
const auth = getAuth(app);
connectAuthEmulator(auth, endpoint);
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085 } });
try {
  for (const fixture of [
    { email: 'organizer@wmsu.edu.ph', name: 'Test Organizer', initials: 'TO', admin: true },
    { email: 'student@wmsu.edu.ph', name: 'Test Student', initials: 'TS', admin: false },
  ]) {
    const credential = GoogleAuthProvider.credential(JSON.stringify({
      sub: fixture.email, email: fixture.email, email_verified: true, name: fixture.name,
    }));
    const { user } = await signInWithCredential(auth, credential);
    const update = await fetch(endpoint + '/identitytoolkit.googleapis.com/v1/accounts:update?key=' + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: user.uid, password: 'ArenaHub-QA-Only-27!', customAttributes: JSON.stringify(fixture.admin ? { admin: true } : {}) }),
    });
    if (!update.ok) throw new Error('Could not configure the local account: ' + fixture.email);
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users', user.uid), {
      uid: user.uid, name: fixture.name, email: fixture.email, role: 'user', status: 'active',
      collegeName: 'Western Mindanao State University', spectatorInviteApproved: !fixture.admin,
      avatarInitials: fixture.initials, emailVerified: true, joinedAt: new Date(),
    }, { merge: true }));
    await signOut(auth);
    const signedIn = await signInWithCredential(auth, credential);
    const token = await signedIn.user.getIdTokenResult();
    if (token.signInProvider !== 'google.com' || !signedIn.user.emailVerified || (token.claims.admin === true) !== fixture.admin) {
      throw new Error('Local Google sign-in or role verification failed: ' + fixture.email);
    }
    console.log('Verified local Google sign-in: ' + fixture.email + (fixture.admin ? ' (Admin)' : ' (User, QR approved)'));
    await signOut(auth);
  }
} finally {
  await env.cleanup();
  await deleteApp(app);
}
