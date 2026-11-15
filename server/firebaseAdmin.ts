// One firebase-admin app per Firebase project for the API server.
// - Emulators (demo-arenahub with VITE_FIREBASE_EMULATORS=true): no credentials needed.
// - A real project: a service account from FIREBASE_SERVICE_ACCOUNT_JSON (the JSON itself, for hosts
//   that only take env values) or GOOGLE_APPLICATION_CREDENTIALS (a file path, kept out of git).
// - Neither: null. Callers fall back to Google's public REST endpoints with the viewer's own token,
//   so the event laptop keeps working without a service account.
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

export const EMULATOR_PROJECT = 'demo-arenahub';
type Env = Record<string, string | undefined>;

export function emulated(env: Env) {
  return env.VITE_FIREBASE_EMULATORS === 'true' && env.VITE_FIREBASE_PROJECT_ID === EMULATOR_PROJECT;
}

export function adminApp(env: Env): App | null {
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) return null;
  const name = `arenahub-api-${projectId}`;
  const existing = getApps().find(app => app.name === name);
  if (existing) return existing;
  if (emulated(env)) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9098';
    process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
    return initializeApp({ projectId }, name);
  }
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const path = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!inline && !path) return null;
  let account: { project_id?: string };
  try { account = inline ? JSON.parse(inline) : undefined as never; } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.'); }
  if (account && account.project_id !== projectId) throw new Error('The service account belongs to a different Firebase project than VITE_FIREBASE_PROJECT_ID.');
  return initializeApp({ credential: cert(inline ? account as never : path!), projectId }, name);
}

/** What the server can do with Firebase, for /api/health. Never includes key or credential values. */
export function adminMode(env: Env): 'emulator' | 'service-account' | 'rest' {
  if (emulated(env)) return 'emulator';
  return env.FIREBASE_SERVICE_ACCOUNT_JSON || env.GOOGLE_APPLICATION_CREDENTIALS ? 'service-account' : 'rest';
}
