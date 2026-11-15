// Grants or revokes ArenaHub staff access through Firebase custom claims.
// Staff access comes only from these claims (firestore.rules: isAdmin / isStaff), never from profile text.
//
// Usage:
//   node scripts/set-role.mjs <email> <role>            grant: admin | organizer | school-admin | moderator
//   node scripts/set-role.mjs <email> none              revoke staff access
//   node scripts/set-role.mjs <email> --show            print the current claims
//
// Safety: it runs against the Auth emulator (FIREBASE_AUTH_EMULATOR_HOST) unless you add
//   --project <id> --confirm-production
// and point GOOGLE_APPLICATION_CREDENTIALS at a service-account key kept outside git. See docs/ROLES.md.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const STAFF_ROLES = ['admin', 'organizer', 'school-admin', 'moderator'];
const fail = message => { console.error(message); process.exit(1); };

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--project');
const [email, role] = positional;
const show = flag('--show');

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Give the account email first, for example: node scripts/set-role.mjs organizer@wmsu.edu.ph organizer');
if (!show && !role) fail(`Give a role: ${STAFF_ROLES.join(', ')}, or none to revoke.`);
if (!show && role !== 'none' && !STAFF_ROLES.includes(role)) fail(`Unknown role "${role}". Use ${STAFF_ROLES.join(', ')}, or none.`);

const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const production = option('--project');
let projectId;
if (production) {
  if (!flag('--confirm-production')) fail(`Refusing to change ${production} without --confirm-production.`);
  if (emulator) fail('FIREBASE_AUTH_EMULATOR_HOST is set, which would send this to the emulator. Unset it to change a real project.');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) fail('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file kept outside git.');
  projectId = production;
} else {
  if (!emulator) fail('No FIREBASE_AUTH_EMULATOR_HOST set. This script changes the emulator unless you pass --project <id> --confirm-production.');
  projectId = process.env.GCLOUD_PROJECT || 'demo-arenahub';
}

initializeApp({ projectId });
const auth = getAuth();
let user;
try { user = await auth.getUserByEmail(email); }
catch { fail(`No account for ${email} in ${projectId}. The person must sign in to ArenaHub once first.`); }

const before = user.customClaims || {};
if (show) {
  console.log(JSON.stringify({ email, uid: user.uid, project: projectId, admin: before.admin === true, role: before.role ?? null }));
  process.exit(0);
}

// Keep unrelated claims; replace only admin and role.
const { admin: _admin, role: _role, ...others } = before;
const after = role === 'none' ? others : { ...others, role, ...(role === 'admin' ? { admin: true } : {}) };
await auth.setCustomUserClaims(user.uid, after);
// Ends existing sessions on revoke or downgrade, so the account signs in again with the new claims.
// An ID token already issued stays valid for up to an hour; the app's rules also check the account status.
if (role === 'none' || (before.admin === true && role !== 'admin')) await auth.revokeRefreshTokens(user.uid);

const action = role === 'none' ? `Staff access revoked for ${user.uid}` : `Staff role ${role} granted to ${user.uid}`;
try {
  // In emulator mode without a Firestore emulator there is nowhere safe to write; never fall through to a real project.
  if (emulator && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is not set');
  // The script has no ArenaHub account of its own, so the actor is recorded as the command line.
  await getFirestore().collection('auditEvents').add({ actorId: 'cli:set-role', action, createdAt: FieldValue.serverTimestamp() });
} catch (error) {
  console.warn(`Claims changed, but the audit event could not be written: ${error.message}`);
}
console.log(`${action} in ${projectId}. ${role === 'none' ? 'Their sessions were ended.' : 'They get the new access the next time they sign in (or within an hour).'}`);
process.exit(0);
