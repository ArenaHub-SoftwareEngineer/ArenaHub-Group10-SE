// Published tournaments as the server sees them: the public documents only (tournaments/{id} and
// tournaments/{id}/public/rosters). The staff-only private roster is never read here.
// With firebase-admin this is an admin query. Without it, the caller's own ID token is used through the
// Firestore REST API, so the rules decide exactly as they would in the browser.
import { getFirestore } from 'firebase-admin/firestore';
import type { BracketDraft } from '../src/lib/types.ts';
import { fromDocs, type RosterDoc, type TournamentDoc } from '../src/lib/data/tournamentDocs.ts';
import { adminApp, emulated } from './firebaseAdmin.ts';

type Env = Record<string, string | undefined>;
export interface PublishedData {
  brackets: BracketDraft[];
  /** Past events (archived), for the cross-tournament player leaderboard only. Empty when they cannot be read. */
  archived?: BracketDraft[];
  /** Changes whenever any published tournament changes. Part of every cache key. */
  revision: string;
  checkedAt: string;
}

/** Firestore REST value to plain JSON. Integers arrive as strings and become numbers. */
export function decodeValue(field: any): any {
  if (!field || typeof field !== 'object') return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('timestampValue' in field) return field.timestampValue;
  if ('nullValue' in field) return null;
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in field) return decodeFields(field.mapValue.fields);
  return undefined;
}
export const decodeFields = (fields: any) => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]));

const plain = (value: unknown): any => JSON.parse(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && typeof item.toDate === 'function' ? item.toDate().toISOString() : item));

type Row = { doc: TournamentDoc; roster: RosterDoc | null };
const withStatus = (rows: Row[], status: string) => rows.filter(row => row.doc?.status === status && typeof row.doc.id === 'string')
  .sort((a, b) => a.doc.id.localeCompare(b.doc.id));
const toBracket = (row: Row) => fromDocs({ ...row.doc, matches: Array.isArray(row.doc.matches) ? row.doc.matches : [] }, row.roster);

function build(rows: Row[], archivedRows: Row[] = []): PublishedData {
  const published = withStatus(rows, 'published'), archived = withStatus(archivedRows, 'archived');
  const revision = published.map(row => `${row.doc.id}:${Number(row.doc.revision) || 0}`).join(',') || 'none';
  return {
    brackets: published.map(toBracket),
    archived: archived.map(toBracket),
    // Archiving or restoring an event changes leaderboard answers, so it is part of the cache key too.
    revision: archived.length ? `${revision}|a:${archived.map(row => `${row.doc.id}:${Number(row.doc.revision) || 0}`).join(',')}` : revision,
    checkedAt: new Date().toISOString(),
  };
}

async function viaAdmin(env: Env): Promise<PublishedData> {
  const db = getFirestore(adminApp(env)!);
  const read = async (status: string): Promise<Row[]> => {
    const snapshot = await db.collection('tournaments').where('status', '==', status).limit(100).get();
    const rosters = snapshot.empty ? [] : await db.getAll(...snapshot.docs.map(doc => doc.ref.collection('public').doc('rosters')));
    return snapshot.docs.map((doc, index) => ({ doc: { ...plain(doc.data()), id: doc.id }, roster: rosters[index]?.exists ? plain(rosters[index].data()) : null }));
  };
  const [published, archived] = await Promise.all([read('published'), read('archived').catch(() => [])]);
  return build(published, archived);
}

async function viaRest(env: Env, token: string, fetcher: typeof fetch): Promise<PublishedData> {
  const base = `${emulated(env) ? 'http://127.0.0.1:8085' : 'https://firestore.googleapis.com'}/v1/projects/${encodeURIComponent(env.VITE_FIREBASE_PROJECT_ID || '')}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${token}` };
  const read = async (status: string): Promise<Row[]> => {
    const response = await fetcher(`${base}:runQuery`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'tournaments' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: status } } }, limit: 100 } }),
    });
    if (!response.ok) throw new Error(`Tournament query failed (${response.status}).`);
    return withRosters((await response.json() as any[]).filter(row => row?.document?.fields));
  };
  // Past events are optional: where the rules do not allow them yet, the published answers still work.
  const [published, archived] = await Promise.all([read('published'), read('archived').catch(() => [])]);
  return build(published, archived);

  async function withRosters(rows: any[]): Promise<Row[]> {
    return Promise.all(rows.map(async row => {
      const doc = decodeFields(row.document.fields) as TournamentDoc;
      doc.id ||= String(row.document.name || '').split('/').pop() || '';
      let roster: RosterDoc | null = null;
      try {
        const r = await fetcher(`${base}/tournaments/${encodeURIComponent(doc.id)}/public/rosters`, { headers, signal: AbortSignal.timeout(8000) });
        const fields = r.ok ? (await r.json() as any)?.fields : undefined;
        if (fields) roster = decodeFields(fields) as RosterDoc;
      } catch { /* A missing roster only hides player names. */ }
      return { doc, roster };
    }));
  }
}

export type PublishedReader = (token: string) => Promise<PublishedData>;

/** Reads published tournaments, shared by every caller for a few seconds so bursts of questions cost one read set. */
export function publishedReader(env: Env, options: { fetcher?: typeof fetch; ttlMs?: number; now?: () => number } = {}): PublishedReader {
  const fetcher = options.fetcher || fetch, ttl = options.ttlMs ?? 10_000, now = options.now || Date.now;
  let cached: { at: number; data: Promise<PublishedData> } | null = null;
  return token => {
    if (cached && now() - cached.at < ttl) return cached.data;
    const data = (adminApp(env) ? viaAdmin(env) : viaRest(env, token, fetcher));
    cached = { at: now(), data };
    data.catch(() => { if (cached?.data === data) cached = null; });
    return data;
  };
}
