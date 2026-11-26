// Facilitators: people an organizer invites by school email to watch screens and check players in.
// The role is the Firebase claim `role: 'facilitator'`. It is NOT a staff role: the Firestore rules treat a
// facilitator as a normal campus account, and the API only lets them use Anti-cheat for their assigned matches
// (server/integrity.ts `inScope`, server/screenWall.ts `watcher`).
//
// Invite flow: the organizer adds an email. If that account already exists it gets the role at once; otherwise the
// invite waits, and the person's first sign-in calls POST /facilitators/accept, which grants it.
import express from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { hasCampusEmail } from '../src/lib/institution.ts';
import { AuthError, FACILITATOR_ROLE, MONITOR_MANAGERS, STAFF_ROLES, bearer, type VerifyCaller } from './auth.ts';
import { adminApp } from './firebaseAdmin.ts';
import { SCREEN_KEY } from './liveScreens.ts';
import type { FacilitatorInvite, MonitorStore } from './monitorStore.ts';

export const MAX_FACILITATORS = 60;
export const MAX_STAFF_PER_MATCH = 4;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Changes the facilitator claim. Null when the server has no service account (claims cannot be set). */
export interface RoleAdmin {
  /** The account for this email and its current role, or null when the person has never signed in. */
  find(email: string): Promise<{ uid: string; role: string } | null>;
  grant(uid: string): Promise<void>;
  /** Removes the facilitator role only (never a staff role) and ends their sessions. */
  revoke(uid: string): Promise<void>;
}

export function firebaseRoleAdmin(env: Record<string, string | undefined>): RoleAdmin | null {
  const app = adminApp(env);
  if (!app) return null;
  const auth = getAuth(app), db = getFirestore(app);
  // Display only, like scripts/set-role.mjs: the Users page shows the profile role; access comes from the claim.
  const mirror = async (uid: string, role: string) => {
    const profile = db.collection('users').doc(uid);
    try { if ((await profile.get()).exists) await profile.update({ role }); } catch { /* The claim is what counts. */ }
  };
  return {
    async find(email) {
      try {
        const user = await auth.getUserByEmail(email), claims = user.customClaims || {};
        return { uid: user.uid, role: claims.admin === true ? 'admin' : typeof claims.role === 'string' ? claims.role : '' };
      } catch (error) {
        if ((error as { code?: string }).code === 'auth/user-not-found') return null;
        throw error;
      }
    },
    async grant(uid) {
      const user = await auth.getUser(uid);
      await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), role: FACILITATOR_ROLE });
      await mirror(uid, FACILITATOR_ROLE);
    },
    async revoke(uid) {
      const user = await auth.getUser(uid);
      const { role, ...others } = user.customClaims || {};
      if (role !== FACILITATOR_ROLE) return;
      await auth.setCustomUserClaims(uid, others);
      await auth.revokeRefreshTokens(uid);
      await mirror(uid, 'user');
    },
  };
}

class FacilitatorError extends Error { constructor(readonly status: number, message: string) { super(message); } }
type Handler = (req: express.Request, res: express.Response) => Promise<void>;

export interface FacilitatorView { email: string; status: 'invited' | 'active' | 'staff'; invitedAt: number; matches: string[] }

export function facilitatorRouter(store: MonitorStore, verify: VerifyCaller, roles: RoleAdmin | null, allowOrigin: (req: express.Request) => boolean) {
  const router = express.Router();
  const route = (fn: Handler): express.RequestHandler => (req, res) => {
    if (!allowOrigin(req)) { res.status(403).json({ error: 'Open Anti-cheat from your ArenaHub website.' }); return; }
    fn(req, res).catch(error => {
      const status = error instanceof FacilitatorError || error instanceof AuthError ? error.status : 503;
      res.status(status).json({ error: status === 503 ? 'Facilitators could not be updated. Try again in a moment.' : error.message });
    });
  };
  const manager = async (req: express.Request) => {
    const caller = await verify(bearer(req.get('authorization')));
    if (!caller.staff || !MONITOR_MANAGERS.includes(caller.role)) throw new FacilitatorError(403, 'An administrator or organizer invites facilitators.');
    return caller;
  };
  const emailOf = (raw: unknown) => {
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 160) throw new FacilitatorError(400, 'Type their email address.');
    if (!hasCampusEmail(email)) throw new FacilitatorError(400, 'Use their school email. Facilitators sign in with it.');
    return email;
  };
  const list = async (): Promise<FacilitatorView[]> => {
    const [invites, staff] = await Promise.all([store.facilitatorInvites(), store.screenStaff()]);
    const matchesOf = (email: string) => Object.entries(staff).filter(([, emails]) => emails.includes(email)).map(([key]) => key);
    return invites.map(invite => ({ email: invite.email, status: invite.accepted_at ? 'active' : 'invited', invitedAt: invite.invited_at, matches: matchesOf(invite.email) }));
  };

  router.get('/facilitators', route(async (req, res) => {
    await manager(req);
    res.json({ facilitators: await list(), canInvite: !!roles });
  }));

  // Invite (or re-invite) one email, and optionally put them on matches at the same time.
  router.post('/facilitators', express.json({ limit: '4kb' }), route(async (req, res) => {
    const caller = await manager(req), email = emailOf(req.body?.email);
    const keys = Array.isArray(req.body?.matches) ? [...new Set((req.body.matches as unknown[]).filter((key): key is string => typeof key === 'string'))] : [];
    if (keys.length > 40 || keys.some(key => !SCREEN_KEY.test(key))) throw new FacilitatorError(400, 'Choose matches from the list.');
    const invites = await store.facilitatorInvites();
    const existing = invites.find(invite => invite.email === email);
    if (!existing && invites.length >= MAX_FACILITATORS) throw new FacilitatorError(400, `You can invite up to ${MAX_FACILITATORS} facilitators.`);
    if (!roles) throw new FacilitatorError(503, 'This server cannot give the facilitator role yet. Add the Firebase service account to the API settings.');
    const account = await roles.find(email);
    let status: FacilitatorView['status'] = 'invited';
    if (account && (account.role === 'admin' || STAFF_ROLES.includes(account.role))) status = 'staff';
    else if (account) { if (account.role !== 'facilitator') await roles.grant(account.uid); status = 'active'; }
    // Staff already have access; they only need the match assignment, so they are not kept on the invite list.
    if (status !== 'staff') {
      const invite: FacilitatorInvite = { email, invited_by: caller.email || caller.uid, invited_at: existing?.invited_at || store.now(), accepted_at: status === 'active' ? existing?.accepted_at || store.now() : null };
      await store.saveFacilitatorInvite(invite, caller.uid);
    }
    if (keys.length) {
      const staff = await store.screenStaff();
      const full = keys.find(key => !(staff[key] || []).includes(email) && (staff[key] || []).length >= MAX_STAFF_PER_MATCH);
      if (full) throw new FacilitatorError(400, `A match has at most ${MAX_STAFF_PER_MATCH} facilitators. Remove one first.`);
      for (const key of keys) if (!(staff[key] || []).includes(email)) await store.setScreenStaff(key, [...(staff[key] || []), email], caller.uid);
    }
    res.status(201).json({ email, status, facilitators: await list() });
  }));

  // Put one facilitator on exactly these matches (replaces their old assignments).
  router.put('/facilitators/:email/matches', express.json({ limit: '4kb' }), route(async (req, res) => {
    const caller = await manager(req), email = emailOf(req.params.email);
    const keys = Array.isArray(req.body?.matches) ? [...new Set((req.body.matches as unknown[]).filter((key): key is string => typeof key === 'string'))] : null;
    if (!keys || keys.length > 40 || keys.some(key => !SCREEN_KEY.test(key))) throw new FacilitatorError(400, 'Choose matches from the list.');
    const staff = await store.screenStaff();
    const full = keys.find(key => !(staff[key] || []).includes(email) && (staff[key] || []).length >= MAX_STAFF_PER_MATCH);
    if (full) throw new FacilitatorError(400, `A match has at most ${MAX_STAFF_PER_MATCH} facilitators. Remove one first.`);
    const wanted = new Set(keys);
    for (const key of new Set([...Object.keys(staff), ...keys])) {
      const now = staff[key] || [], has = now.includes(email);
      if (wanted.has(key) && !has) await store.setScreenStaff(key, [...now, email], caller.uid);
      if (!wanted.has(key) && has) await store.setScreenStaff(key, now.filter(item => item !== email), caller.uid);
    }
    res.json({ facilitators: await list() });
  }));

  // Remove: off every match, invite deleted, facilitator role taken back (staff roles are never touched).
  router.delete('/facilitators/:email', route(async (req, res) => {
    const caller = await manager(req), email = emailOf(req.params.email);
    const staff = await store.screenStaff();
    for (const [key, emails] of Object.entries(staff)) if (emails.includes(email)) await store.setScreenStaff(key, emails.filter(item => item !== email), caller.uid);
    await store.deleteFacilitatorInvite(email, caller.uid);
    const account = roles ? await roles.find(email) : null;
    if (roles && account?.role === FACILITATOR_ROLE) await roles.revoke(account.uid);
    res.json({ facilitators: await list() });
  }));

  // Called once after sign-in. An invited account gets the facilitator role; everyone else is unchanged.
  router.post('/facilitators/accept', route(async (req, res) => {
    const caller = await verify(bearer(req.get('authorization')));
    const role = caller.role || 'user';
    if (!caller.campus || !roles) { res.json({ role, changed: false }); return; }
    const email = caller.email.toLowerCase();
    const invite = (await store.facilitatorInvites()).find(item => item.email === email);
    if (!invite) { res.json({ role, changed: false }); return; }
    if (role === FACILITATOR_ROLE) {
      if (!invite.accepted_at) await store.saveFacilitatorInvite({ ...invite, accepted_at: store.now() }, caller.uid);
      res.json({ role, changed: false }); return;
    }
    // A staff account keeps its own role; the invite adds nothing.
    if (caller.staff || (role !== 'user' && role !== '')) { res.json({ role, changed: false }); return; }
    await roles.grant(caller.uid);
    await store.saveFacilitatorInvite({ ...invite, accepted_at: store.now() }, caller.uid);
    res.json({ role: FACILITATOR_ROLE, changed: true });
  }));

  return router;
}
