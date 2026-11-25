/**
 * ArenaHub Auth Context + Hook
 *
 * Google/email authentication, real email verification, and private account profiles.
 * Staff roles come only from trusted Firebase claims. Spectators need student admission.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  User as FirebaseUser,
  reload,
  getIdTokenResult,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  serverTimestamp,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
import { UserRole } from './types';
import { CAMPUS_NAME, hasCampusEmail } from './campusAccess';
import { validateEmail, validateProfile } from './profileValidation';
import { authErrorMessage } from './authMessages';
import { registerEmailAccount } from './accountRegistration';
import { composeName, type NameParts } from './authValidation';
import { institutionalGoogleProvider, enforceGoogleInstitution } from './googleAuth';
import { GOOGLE_DOMAIN_ERROR } from './institution';
import { sendWithReturn } from './emailLinks';
import { errorMessage } from './errors';

export { isFirebaseConfigured };

// ─── Popular Institutional Campuses ───────────────────────────────────────────
// ─── Personal-email blocklist ─────────────────────────────────────────────────
export const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.com.ph',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'aol.com',
  'mail.com',
  'zoho.com',
  'tutanota.com',
  'tuta.io',
  'gmx.com',
  'gmx.net',
  'fastmail.com',
  'inbox.com',
  'yandex.com',
  'mail.ru',
]);

export function isPersonalEmail(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  return PERSONAL_DOMAINS.has(domain);
}

export function isInstitutionalEmail(email: string): boolean {
  return hasCampusEmail(email);
}

/**
 * Determine if an email belongs to an Admin or regular User
 */
export function determineRole(email: string): UserRole {
  // Privileged roles must be assigned by a trusted administrator/backend.
  // Email text is never an authorization signal.
  void email;
  return 'user';
}

/**
 * Infer human-readable school / institution name from an email address
 */
export function inferSchoolFromEmail(email: string): string {
  if (!email || !email.includes('@')) return 'Campus Hub';
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (hasCampusEmail(email)) return CAMPUS_NAME;
  if (domain === 'up.edu.ph') return 'University of the Philippines';
  if (domain === 'ateneo.edu') return 'Ateneo de Manila University';
  if (domain === 'dlsu.edu.ph') return 'De La Salle University';
  if (domain === 'ust.edu.ph') return 'University of Santo Tomas';

  const parts = domain.split('.');
  if (parts.length >= 2) {
    const rawName = parts[0];
    return rawName.toUpperCase();
  }
  return 'Campus Hub';
}

export function inferNameFromEmail(email: string): string {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ');
  return local.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function makeInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

// ─── ArenaHub user profile ───────────────────────────────────────────────────
export interface AHUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'suspended' | 'banned';
  collegeName?: string;
  avatarInitials: string;
  emailVerified: boolean;
  joinedAt: unknown;
  isDomainVerified?: boolean;
  spectatorInviteApproved?: boolean;
}

// ─── Auth context shape ───────────────────────────────────────────────────────
interface AuthContextType {
  firebaseUser: FirebaseUser | null | undefined;
  ahUser: AHUser | null;
  loading: boolean;
  isConfigured: boolean;
  affiliationPending: boolean;
  profileError: string;
  authError: string;
  verificationNotice: string;
  retryProfile: () => Promise<void>;
  signInWithGoogleRedirect: () => Promise<{ error?: string }>;
  signInWithGoogle: () => Promise<{
    error?: string;
    cancelled?: boolean;
    canRedirect?: boolean;
    needsAffiliation?: boolean;
    userEmail?: string;
    userName?: string;
  }>;
  signUpWithEmail: (
    email: string,
    password: string,
    name: NameParts,
    collegeName?: string
  ) => Promise<{ error?: string; code?: string; verificationSent?: boolean }>;
  signInWithEmail: (
    email: string,
    password: string
  ) => Promise<{ error?: string; notFound?: boolean }>;
  resendVerificationEmail: () => Promise<void>;
  reloadUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export async function getOrCreateProfile(fbUser: FirebaseUser, overrideSchool?: string): Promise<AHUser> {
  await enforceGoogleInstitution(fbUser);
  const ref = doc(db, 'users', fbUser.uid);
  const email = fbUser.email ?? '';
  let claimedRole: UserRole | null = null;
  try {
    const token = await getIdTokenResult(fbUser);
    const tokenRole = typeof token.claims.role === 'string' ? token.claims.role : null;
    const allowedRoles: UserRole[] = ['admin', 'organizer', 'moderator', 'school-admin'];
    if (token.claims.admin === true) claimedRole = 'admin';
    else if (tokenRole && allowedRoles.includes(tokenRole as UserRole)) claimedRole = tokenRole as UserRole;
  } catch {
    // Without a verified staff claim, use regular user permissions.
  }

  try {
    return await runTransaction(db, async transaction => {
    const snap = await transaction.get(ref);
    if (snap.exists()) {
      const data = snap.data() as AHUser;
      // Firebase owns sign-in email. A verified email change is mirrored on the next login.
      if (email && (data.email !== email || data.emailVerified !== fbUser.emailVerified)) {
        transaction.update(ref, { email, emailVerified: fbUser.emailVerified });
        data.email = email;
        data.emailVerified = fbUser.emailVerified;
      }
      // Browser-writable profile text never grants staff permissions.
      data.role = claimedRole ?? 'user';
      return data;
    }

    const displayName = fbUser.displayName || inferNameFromEmail(email || 'user');
    const inferredSchool = overrideSchool || (hasCampusEmail(email) ? CAMPUS_NAME : 'Spectator');
    const profile: AHUser = {
      uid: fbUser.uid,
      name: displayName,
      email,
      role: 'user',
      status: 'active',
      collegeName: inferredSchool,
      avatarInitials: makeInitials(displayName),
      emailVerified: fbUser.emailVerified,
      joinedAt: serverTimestamp(),
    };

    transaction.set(ref, profile);
    return { ...profile, role: claimedRole ?? 'user' };
    });
  } catch (err) {
    throw new Error('Your account signed in, but its ArenaHub profile could not load. Check your connection and retry.');
  }
}

const SESSION_STORAGE_KEY = 'arenahub_auth_session';

// ─── Provider ─────────────────────────────────────────────────────────────────
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [firebaseUser, setFirebaseUser] = useState<
    FirebaseUser | null | undefined
  >(undefined);
  const [ahUser, setAhUser] = useState<AHUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [affiliationPending, setAffiliationPending] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [authError, setAuthError] = useState('');
  const [verificationNotice, setVerificationNotice] = useState('');
  const [profileAttempt, setProfileAttempt] = useState(0);

  // Firebase Auth is the only source of session truth.
  useEffect(() => {
    let stopProfile: (() => void) | undefined;
    let generation = 0;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const currentGeneration = ++generation;
      stopProfile?.();
      setFirebaseUser(user);
      setAhUser(null); setProfileError(''); setLoading(true);

      if (user) {
        try {
        try { await enforceGoogleInstitution(user); }
        catch (error) {
          if (currentGeneration !== generation) return;
          setAuthError(error instanceof Error ? error.message : GOOGLE_DOMAIN_ERROR);
          await signOut(auth); return;
        }
        const profile = await getOrCreateProfile(user);
        if (currentGeneration !== generation) return;
        if (profile.emailVerified !== user.emailVerified) {
          try {
            const ref = doc(db, 'users', user.uid);
            await setDoc(ref, { emailVerified: user.emailVerified }, { merge: true });
          } catch {
            // ignore
          }
          profile.emailVerified = user.emailVerified;
        }
        setAhUser(profile);
        stopProfile = onSnapshot(doc(db, 'users', user.uid), snapshot => {
          if (currentGeneration !== generation) return;
          if (!snapshot.exists()) { setProfileError('Your account profile is unavailable. Retry loading it or sign out.'); return; }
          const data = snapshot.data();
          setAhUser(previous => ({ ...(previous || profile), name: data.name || profile.name, email: data.email || profile.email, avatarInitials: data.avatarInitials || makeInitials(data.name || profile.name), collegeName: data.collegeName || profile.collegeName, status: data.status || profile.status, spectatorInviteApproved: data.spectatorInviteApproved === true }));
        }, () => { if (currentGeneration === generation) setProfileError('Your account profile could not be reached. Check your connection and retry.'); });
        } catch (error) { if (currentGeneration !== generation) return; setProfileError(errorMessage(error, 'Your account profile could not load.')); }
      } else setAhUser(null);

      setLoading(false);
    });

    return () => { generation++; stopProfile?.(); unsub(); };
  }, [profileAttempt]);
  useEffect(() => { if (isFirebaseConfigured) void getRedirectResult(auth).catch(error => setAuthError(authErrorMessage(error))); }, []);

  // ── Google sign-in ──────────────────────────────────────────────────────────
  const signInWithGoogle = useCallback(async (): Promise<{ error?: string; cancelled?: boolean; canRedirect?: boolean }> => {
    if (!isFirebaseConfigured) return { error: 'Authentication is not configured.' };
    setAffiliationPending(true);
    setAuthError('');
    const provider = institutionalGoogleProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      try { await enforceGoogleInstitution(result.user); }
      catch { await signOut(auth); return { error: GOOGLE_DOMAIN_ERROR }; }
      return {};
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      return { error: authErrorMessage(err), cancelled: code === 'auth/popup-closed-by-user', canRedirect: code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request' || code === 'auth/operation-not-supported-in-this-environment' };
    } finally {
      setAffiliationPending(false);
    }
  }, []);
  const signInWithGoogleRedirect = useCallback(async (): Promise<{ error?: string }> => {
    if (!isFirebaseConfigured) return { error: 'Authentication is not configured.' };
    const provider = institutionalGoogleProvider();
    setAffiliationPending(true); setAuthError('');
    try { await signInWithRedirect(auth, provider); return {}; }
    catch (error) { return { error: authErrorMessage(error) }; }
    finally { setAffiliationPending(false); }
  }, []);

  const signUpWithEmail = useCallback(
    async (
      email: string,
      password: string,
      nameParts: NameParts,
      collegeName?: string
    ): Promise<{ error?: string; code?: string; verificationSent?: boolean }> => {
      const displayName = composeName(nameParts);
      const normalizedEmail = email.trim().toLowerCase();
      const school = hasCampusEmail(normalizedEmail) ? collegeName?.trim() || CAMPUS_NAME : 'Spectator';
      const invalid = validateEmail(normalizedEmail) || validateProfile(displayName, school);
      if (invalid) return { error: invalid };

      if (!isFirebaseConfigured) return { error: 'Authentication is not configured.' };
      setAffiliationPending(true); setVerificationNotice('');
      try {
        const result = await registerEmailAccount(normalizedEmail, password, nameParts, collegeName);
        if (!result.verificationSent) setVerificationNotice('Your account was created, but the verification email could not be sent. Use Resend verification email to try again.');
        return { verificationSent: result.verificationSent };
      } catch (err: unknown) {
        const error = (err as { code?: string }).code ? authErrorMessage(err) : errorMessage(err, 'Account creation could not be completed.');
        if (auth.currentUser?.email === normalizedEmail && !String((err as any).code).includes('email-already-in-use')) setProfileError('Your account was created, but account setup could not finish. Retry loading your profile; you do not need to create another account.');
        return { error };
      } finally { setAffiliationPending(false); }
    },
    []
  );

  // ── Email/password sign-in ───────────────────────────────────────────────────
  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<{ error?: string; notFound?: boolean }> => {
      const normalizedEmail = email.trim().toLowerCase();
      if (!isFirebaseConfigured) return { error: 'Authentication is not configured.' };
      try {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
        return {};
      } catch (err: unknown) {
        const code = (err as { code?: string }).code ?? '';
        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential')
          return { notFound: true, error: 'Email or password is incorrect.' };
        if (code === 'auth/wrong-password') return { error: 'Email or password is incorrect.' };
        if (code === 'auth/too-many-requests') return { error: 'Too many attempts. Please wait and try again.' };
        return { error: authErrorMessage(err) };
      }
    },
    []
  );

  const resendVerificationEmail = useCallback(async () => {
    if (auth.currentUser) {
      const user = auth.currentUser;
      await sendWithReturn(settings => sendEmailVerification(user, settings), 'verified');
      setVerificationNotice('');
    }
  }, []);

  // ── Reload user ──────────────────────────────────────────────────────────────
  const reloadUser = useCallback(async () => {
    if (auth.currentUser) {
      await reload(auth.currentUser);
      await auth.currentUser.getIdToken(true);
      setFirebaseUser(auth.currentUser);

      const profile = await getOrCreateProfile(auth.currentUser);
      if (profile.emailVerified !== auth.currentUser.emailVerified) {
        try {
          const ref = doc(db, 'users', auth.currentUser.uid);
          await setDoc(
            ref,
            { emailVerified: auth.currentUser.emailVerified },
            { merge: true }
          );
        } catch {
          // ignore
        }
        profile.emailVerified = auth.currentUser.emailVerified;
      }
      setAhUser(profile);
    }
  }, []);
  const retryProfile = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoading(true); setProfileError(''); setProfileAttempt(value => value + 1);
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    setAffiliationPending(false);
    setProfileError(''); setAuthError(''); setVerificationNotice('');
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setAhUser(null);
    setFirebaseUser(null);
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        ahUser,
        loading,
        isConfigured: isFirebaseConfigured,
        affiliationPending,
        profileError, authError, verificationNotice, retryProfile, signInWithGoogleRedirect,
        signInWithGoogle,
        signUpWithEmail,
        signInWithEmail,
        resendVerificationEmail,
        reloadUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
