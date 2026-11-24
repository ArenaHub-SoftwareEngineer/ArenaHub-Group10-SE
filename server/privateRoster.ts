// Reads the staff-only roster (tournaments/{id}/private/roster) when staff open a room, and keeps only a
// hash of each school email. The join page later compares a player's typed email against that hash, so
// staff see "email does not match the roster" without any roster email reaching a player's browser.
// With firebase-admin this is an admin read; otherwise the staff member's own token is used, and the
// Firestore rules allow that document to active staff only.
import { getFirestore } from 'firebase-admin/firestore';
import { decodeFields } from './data.ts';
import { adminApp, emulated } from './firebaseAdmin.ts';
import { emailHash } from './monitorStore.ts';
import type { PrivateRosterDoc } from '../src/lib/data/tournamentDocs.ts';

type Env = Record<string, string | undefined>;
/** Team id, then lower-case IGN, to the email hash. */
export type RosterEmails = Map<string, Map<string, string>>;
export type RosterEmailReader = (tournamentId: string, token: string) => Promise<RosterEmails | null>;

function index(doc: PrivateRosterDoc | null): RosterEmails | null {
  if (!doc?.teams || typeof doc.teams !== 'object') return null;
  const result: RosterEmails = new Map();
  for (const [teamId, team] of Object.entries(doc.teams)) {
    const players = new Map<string, string>();
    for (const player of Array.isArray(team?.players) ? team.players : []) {
      if (typeof player?.ign === 'string' && typeof player.schoolEmail === 'string' && player.schoolEmail.includes('@')) players.set(player.ign.trim().toLowerCase(), emailHash(player.schoolEmail));
    }
    result.set(teamId, players);
  }
  return result;
}

/** Never throws: without the private roster the room still works, and email checks read "unknown". */
export function rosterEmailReader(env: Env, fetcher: typeof fetch = fetch): RosterEmailReader {
  return async (tournamentId, token) => {
    try {
      const app = adminApp(env);
      if (app) {
        const snap = await getFirestore(app).collection('tournaments').doc(tournamentId).collection('private').doc('roster').get();
        return index(snap.exists ? snap.data() as PrivateRosterDoc : null);
      }
      const base = `${emulated(env) ? 'http://127.0.0.1:8085' : 'https://firestore.googleapis.com'}/v1/projects/${encodeURIComponent(env.VITE_FIREBASE_PROJECT_ID || '')}/databases/(default)/documents`;
      const response = await fetcher(`${base}/tournaments/${encodeURIComponent(tournamentId)}/private/roster`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      return index(decodeFields((await response.json() as { fields?: unknown }).fields) as PrivateRosterDoc);
    } catch { return null; }
  };
}
