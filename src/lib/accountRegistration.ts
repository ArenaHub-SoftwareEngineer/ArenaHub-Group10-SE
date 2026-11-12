import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
import { CAMPUS_NAME, hasCampusEmail, pendingSpectatorInvite, checkSpectatorInvite } from './campusAccess';
import { CAMPUS_SHORT_NAME } from './institution';
import { validateAuthFields } from './authValidation';

export async function registerEmailAccount(email: string, password: string, name: string, college = '') {
  const normalizedEmail = email.trim().toLowerCase(), school = hasCampusEmail(normalizedEmail) ? college.trim() || CAMPUS_NAME : 'Spectator';
  const invalid = Object.values(validateAuthFields({ email: normalizedEmail, password, name, campus: school }, true))[0];
  if (invalid) throw new Error(invalid);
  if (!isFirebaseConfigured) throw new Error('Account registration is not configured yet.');
  if (!hasCampusEmail(normalizedEmail)) {
    const invitation = pendingSpectatorInvite();
    if (!invitation) throw new Error(`Scan a current ${CAMPUS_SHORT_NAME} student invitation QR before creating a spectator account.`);
    await checkSpectatorInvite(invitation);
  }
  const { user } = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  await updateProfile(user, { displayName: name.trim() });
  const profile = doc(db, 'users', user.uid), initials = name.trim().split(/\s+/).map(part => part[0].toUpperCase()).join('').slice(0, 2);
  await runTransaction(db, async tx => {
    const existing = await tx.get(profile);
    const fields = { name: name.trim(), collegeName: school, avatarInitials: initials, email: normalizedEmail, emailVerified: user.emailVerified };
    if (existing.exists()) tx.update(profile, fields);
    else tx.set(profile, { ...fields, uid: user.uid, role: 'user', status: 'active', joinedAt: serverTimestamp() });
  });
  let verificationSent = false;
  try { await sendEmailVerification(user); verificationSent = true; } catch { /* The account exists. The verification screen offers a real resend. */ }
  return { user, verificationSent };
}
