// Who is calling the API. Mirrors the Firestore rules (signedIn, campusStudent, activeSpectator, activeStaff),
// so the server never grants more than the database would.
// With firebase-admin: verifyIdToken(token, checkRevoked = true), then the profile and admission documents.
// Without it (no service account configured): Google's account lookup proves the token, and the profile is
// read with the caller's own token through the Firestore REST API.
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { hasCampusEmail } from '../src/lib/institution.ts';
import { adminApp, emulated } from './firebaseAdmin.ts';

export const STAFF_ROLES = ['admin', 'organizer', 'school-admin', 'moderator'];
/**
 * Facilitators are invited by email (server/facilitators.ts). They are not staff anywhere else: no Firestore staff
 * rules, no bracket or user tools. They only use Anti-cheat, and only for the matches they are assigned to.
 */
export const FACILITATOR_ROLE = 'facilitator';
/** Staff roles that run Anti-cheat for every match and invite facilitators. Moderators see assigned matches only. */
export const MONITOR_MANAGERS = ['admin', 'school-admin', 'organizer'];
export class AuthError extends Error { constructor(readonly status: 401 | 403, message: string) { super(message); } }

export interface Caller {
  uid: string;
  email: string;
  /** Verified institutional email: may read tournaments, post in chat. */
  campus: boolean;
  /** Campus account or an admitted personal spectator: may read published tournaments. */
  admitted: boolean;
  /** Staff claim on a campus account (activeStaff in the rules). */
  staff: boolean;
  /** Invited facilitator on a campus account: Anti-cheat only, for their assigned matches. */
  facilitator?: boolean;
  role: string;
}
type Env = Record<string, string | undefined>;
const DEMO_TOKENS = ['local-dev-token', 'demo-token'];

export function bearer(header: string | undefined) {
  return header?.match(/^Bearer (\S+)$/)?.[1];
}

interface Identity { uid: string; email: string; verified: boolean; provider: string; admin: boolean; role: string }

function classify(identity: Identity, active: boolean, spectatorEmail: () => Promise<string | undefined>) {
  const campus = identity.verified && hasCampusEmail(identity.email);
  // acceptedGoogleIdentity(): Google sign-in is only accepted for verified campus addresses.
  if (!identity.verified || (identity.provider === 'google.com' && !campus)) throw new AuthError(401, 'A verified account is required.');
  if (!active) throw new AuthError(403, 'This account is not active.');
  const staff = campus && (identity.admin || STAFF_ROLES.includes(identity.role));
  const facilitator = campus && !staff && identity.role === FACILITATOR_ROLE;
  const base: Caller = { uid: identity.uid, email: identity.email, campus, admitted: campus, staff, facilitator, role: identity.admin ? 'admin' : identity.role };
  if (campus || !['google.com', 'password'].includes(identity.provider)) return Promise.resolve(base);
  return spectatorEmail().then(email => ({ ...base, admitted: !!email && email === identity.email }));
}

async function viaAdmin(env: Env, token: string): Promise<Caller> {
  const app = adminApp(env)!;
  let decoded;
  try { decoded = await getAuth(app).verifyIdToken(token, true); }
  catch { throw new AuthError(401, 'Your sign-in has expired or was revoked. Sign in again.'); }
  const db = getFirestore(app);
  const profile = await db.doc(`users/${decoded.uid}`).get();
  return classify({
    uid: decoded.uid, email: decoded.email || '', verified: decoded.email_verified === true,
    provider: decoded.firebase?.sign_in_provider || '', admin: decoded.admin === true, role: typeof decoded.role === 'string' ? decoded.role : '',
  }, profile.get('status') === 'active', async () => (await db.doc(`spectatorAdmissions/${decoded.uid}`).get()).get('email'));
}

async function viaRest(env: Env, token: string, fetcher: typeof fetch): Promise<Caller> {
  const local = emulated(env);
  const identity = local ? 'http://127.0.0.1:9098/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com';
  const lookup = await fetcher(`${identity}/v1/accounts:lookup?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY || '')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(8000) });
  const account = (await lookup.json() as any).users?.[0];
  if (!lookup.ok || !account?.localId || account.disabled) throw new AuthError(401, 'Your sign-in has expired. Sign in again.');
  // The lookup proved the token is genuine and current, so its payload can be read for the claims.
  const claims = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8') || '{}');
  if (claims.sub !== account.localId) throw new AuthError(401, 'Your sign-in could not be verified. Sign in again.');
  const base = `${local ? 'http://127.0.0.1:8085' : 'https://firestore.googleapis.com'}/v1/projects/${encodeURIComponent(env.VITE_FIREBASE_PROJECT_ID || '')}/databases/(default)/documents`;
  const read = async (path: string) => {
    const response = await fetcher(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    return response.ok ? (await response.json() as any).fields : undefined;
  };
  const profile = await read(`users/${encodeURIComponent(account.localId)}`);
  return classify({
    uid: account.localId, email: account.email || '', verified: account.emailVerified === true,
    provider: claims.firebase?.sign_in_provider || '', admin: claims.admin === true, role: typeof claims.role === 'string' ? claims.role : '',
  }, profile?.status?.stringValue === 'active', async () => (await read(`spectatorAdmissions/${encodeURIComponent(account.localId)}`))?.email?.stringValue);
}

export type VerifyCaller = (token: string | undefined) => Promise<Caller>;

/** Builds the verifier for one server environment. Throws AuthError for every rejection. */
export function callerVerifier(env: Env, fetcher: typeof fetch = fetch): VerifyCaller {
  return async token => {
    if (!token || DEMO_TOKENS.includes(token)) throw new AuthError(401, 'Sign in to continue.');
    try {
      return adminApp(env) ? await viaAdmin(env, token) : await viaRest(env, token, fetcher);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(401, 'Your account could not be verified. Sign in again.');
    }
  };
}

/** Staff or an invited facilitator: the Anti-cheat page. Callers check `facilitator` for what it may not do. */
export async function requireMonitorAccess(verify: VerifyCaller, token: string | undefined, notStaff: string) {
  const caller = await verify(token);
  if (!caller.staff && caller.facilitator !== true) throw new AuthError(403, notStaff);
  return caller;
}

/** Staff only (activeStaff). The message is shown to the caller when they are signed in but not staff. */
export async function requireStaff(verify: VerifyCaller, token: string | undefined, notStaff: string) {
  const caller = await verify(token);
  if (!caller.staff) throw new AuthError(403, notStaff);
  return caller;
}
