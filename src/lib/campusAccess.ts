import { doc, getDocFromServer, runTransaction, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';

import { CAMPUS_SHORT_NAME } from './institution';
export { CAMPUS_DOMAIN, CAMPUS_NAME, hasCampusEmail } from './institution';
export const INVITE_DURATION = 20 * 60 * 1000;
const STORAGE_KEY = 'arenahub_spectator_invite';
// New invitations use a 10-character code people can read out or type (no I, L, O; about 50 bits,
// and each code lasts 20 minutes). Older 48-character hex tokens stay valid until they expire.
const tokenPattern = /^(?:[a-f0-9]{48}|[2-9A-HJKMNP-Z]{10})$/;
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newInviteCode() {
  let code = '';
  while (code.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // 248 = 8 x 31, so every letter is equally likely.
      if (byte < 248 && code.length < 10) code += CODE_ALPHABET[byte % 31];
    }
  }
  return code;
}
/** "ABCDE-FGHJK" for display; the dash is optional when typing. */
export function formatInviteCode(token: string) {
  return token.length === 10 ? `${token.slice(0, 5)}-${token.slice(5)}` : token;
}

export function captureSpectatorInvite() {
  const url = new URL(window.location.href);
  const invite = url.searchParams.get('spectatorInvite');
  if (invite === null) return;
  try {
    if (tokenPattern.test(invite)) sessionStorage.setItem(STORAGE_KEY, invite);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* This browser requires session storage to preserve the invite. */ }
  url.searchParams.delete('spectatorInvite');
  window.history.replaceState(window.history.state, '', url);
}

export function pendingSpectatorInvite(): string | null {
  try {
    const invite = sessionStorage.getItem(STORAGE_KEY);
    return invite && tokenPattern.test(invite) ? invite : null;
  } catch { return null; }
}

export async function checkSpectatorInvite(invite: string) {
  if (!tokenPattern.test(invite)) throw new Error('This invitation code is invalid. Scan a current student QR or enter its code.');
  try {
    const snapshot = await getDocFromServer(doc(db, 'campusInvites', invite));
    if (snapshot.exists()) return { expiresAt: snapshot.data().createdAt.toMillis() + INVITE_DURATION };
  } catch (error) {
    if ((error as { code?: string }).code !== 'permission-denied') throw error;
  }
  throw new Error('This invite has expired or is invalid. Ask the student for their current QR or code.');
}
export function rememberSpectatorInvite(token: string) {
  if (!tokenPattern.test(token)) throw new Error('Invalid invitation code.');
  try { sessionStorage.setItem(STORAGE_KEY, token); }
  catch { throw new Error('Your browser could not save the invitation. Allow site storage or open ArenaHub in your regular browser.'); }
}
export function clearSpectatorInvite() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Nothing else to clear. */ }
}

export async function redeemSpectatorAccess(user: User): Promise<void> {
  const token = await user.getIdTokenResult(true);
  if (token.signInProvider !== 'google.com' && token.signInProvider !== 'password') {
    throw new Error('Sign in with Google or a verified email to continue.');
  }
  const ref = doc(db, 'spectatorAdmissions', user.uid);
  const existing = await getDocFromServer(ref);
  if (existing.data()?.email === user.email) return;
  const invite = pendingSpectatorInvite();
  if (!invite) throw new Error(`Scan a current ${CAMPUS_SHORT_NAME} student QR to access ArenaHub as a spectator.`);
  await checkSpectatorInvite(invite);
  try {
    await setDoc(ref, { email: user.email, invite, admittedAt: serverTimestamp() });
  } catch (error) {
    if ((error as { code?: string }).code !== 'permission-denied') throw error;
    // Another tab may have redeemed the same account first.
    if ((await getDocFromServer(ref)).data()?.email !== user.email) {
      throw new Error(`Spectator access could not be verified. Scan a current ${CAMPUS_SHORT_NAME} student QR and try again.`);
    }
  }
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Already admitted. */ }
}

export async function currentStudentInvite(user: User) {
  const ref = doc(db, 'studentInviteSlots', user.uid);
  await runTransaction(db, async transaction => {
    const old = (await transaction.get(ref)).data();
    if (old?.createdAt instanceof Timestamp && Date.now() < old.createdAt.toMillis() + INVITE_DURATION) return;
    const token = newInviteCode();
    const createdAt = serverTimestamp();
    transaction.set(ref, { token, createdAt });
    transaction.set(doc(db, 'campusInvites', token), { issuer: user.uid, createdAt });
    if (old?.token && tokenPattern.test(old.token)) transaction.delete(doc(db, 'campusInvites', old.token));
  });
  const invite = (await getDocFromServer(ref)).data();
  if (!invite || !(invite.createdAt instanceof Timestamp)) throw new Error('The QR is not available yet.');
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('spectatorInvite', invite.token);
  return { url: url.href, code: invite.token as string, expiresAt: invite.createdAt.toMillis() + INVITE_DURATION };
}
