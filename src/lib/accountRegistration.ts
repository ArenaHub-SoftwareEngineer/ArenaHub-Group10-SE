import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
import { CAMPUS_NAME, hasCampusEmail, pendingSpectatorInvite, checkSpectatorInvite } from './campusAccess';
import { CAMPUS_SHORT_NAME } from './institution';
import { composeName, nameInitials, tidyName, validateAuthFields, type NameParts } from './authValidation';
import { sendWithReturn } from './emailLinks';

export async function registerEmailAccount(email: string, password: string, nameParts: NameParts, college = '') {
  const name = composeName(nameParts);
  const normalizedEmail = email.trim().toLowerCase(), school = hasCampusEmail(normalizedEmail) ? college.trim() || CAMPUS_NAME : 'Spectator';
  const invalid = Object.values(validateAuthFields({ email: normalizedEmail, password, nameParts, campus: school }, true))[0];
  if (invalid) throw new Error(invalid);
  if (!isFirebaseConfigured) throw new Error('Account registration is not configured yet.');
  if (!hasCampusEmail(normalizedEmail)) {
    const invitation = pendingSpectatorInvite();
    if (!invitation) throw new Error(`Scan a current ${CAMPUS_SHORT_NAME} student invitation QR before creating a spectator account.`);
    await checkSpectatorInvite(invitation);
  }
  const { user } = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  await updateProfile(user, { displayName: name });
  const profile = doc(db, 'users', user.uid), initials = nameInitials(nameParts);
  await runTransaction(db, async tx => {
    const existing = await tx.get(profile);
    const fields = { name, firstName: tidyName(nameParts.first), middleName: tidyName(nameParts.middle), lastName: tidyName(nameParts.last), collegeName: school, avatarInitials: initials, email: normalizedEmail, emailVerified: user.emailVerified };
    if (existing.exists()) tx.update(profile, fields);
    else tx.set(profile, { ...fields, uid: user.uid, role: 'user', status: 'active', joinedAt: serverTimestamp() });
  });
  let verificationSent = false;
  try { await sendWithReturn(settings => sendEmailVerification(user, settings), 'verified'); verificationSent = true; } catch { /* The account exists. The verification screen offers a real resend. */ }
  return { user, verificationSent };
}
