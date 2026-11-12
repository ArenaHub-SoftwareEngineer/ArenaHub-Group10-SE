import { hasCampusEmail } from '../src/lib/institution.ts';

export const STAFF_ROLES = ['admin', 'organizer', 'school-admin', 'moderator'];
export class AuthError extends Error { constructor(readonly status: 401 | 403, message: string) { super(message); } }

/**
 * Verifies a Firebase ID token the same way the fair-play video API does: Google's account lookup
 * proves the token is genuine, the claims must carry a staff role, and the Firestore profile must be active.
 * Returns the staff member's uid.
 */
export async function verifyStaffToken(env: Record<string, string | undefined>, token: string | undefined, fetcher: typeof fetch = fetch): Promise<string> {
  if (!token || ['local-dev-token', 'demo-token'].includes(token)) throw new AuthError(401, 'Sign in as tournament staff.');
  const emulated = env.VITE_FIREBASE_EMULATORS === 'true' && env.VITE_FIREBASE_PROJECT_ID === 'demo-arenahub';
  try {
    const identity = emulated ? 'http://127.0.0.1:9098/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com';
    const lookup = await fetcher(`${identity}/v1/accounts:lookup?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY || '')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(8000) });
    const account = (await lookup.json() as any).users?.[0];
    if (!lookup.ok || !account?.localId || account.disabled || !account.emailVerified || !hasCampusEmail(account.email)) throw new AuthError(401, 'A verified, active campus staff account is required.');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.sub !== account.localId || (claims.admin !== true && !STAFF_ROLES.includes(claims.role))) throw new AuthError(403, 'Only tournament staff can use the match monitor.');
    const base = `${emulated ? 'http://127.0.0.1:8085' : 'https://firestore.googleapis.com'}/v1/projects/${encodeURIComponent(env.VITE_FIREBASE_PROJECT_ID || '')}/databases/(default)/documents`;
    const profile = await fetcher(`${base}/users/${encodeURIComponent(account.localId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!profile.ok || (await profile.json() as any).fields?.status?.stringValue !== 'active') throw new AuthError(403, 'This staff account is not active.');
    return account.localId;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(401, 'Your staff access could not be verified. Sign in again.');
  }
}
