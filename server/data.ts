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

function build(rows: Array<{ doc: TournamentDoc; roster: RosterDoc | null }>): PublishedData {
  const published = rows.filter(row => row.doc?.status === 'published' && typeof row.doc.id === 'string')
    .sort((a, b) => a.doc.id.localeCompare(b.doc.id));
  return {
    brackets: published.map(row => fromDocs({ ...row.doc, matches: Array.isArray(row.doc.matches) ? row.doc.matches : [] }, row.roster)),
    revision: published.map(row => `${row.doc.id}:${Number(row.doc.revision) || 0}`).join(',') || 'none',
    checkedAt: new Date().toISOString(),
  };
}

async function viaAdmin(env: Env): Promise<PublishedData> {
  const db = getFirestore(adminApp(env)!);
  const snapshot = await db.collection('tournaments').where('status', '==', 'published').limit(100).get();
  const rosters = snapshot.empty ? [] : await db.getAll(...snapshot.docs.map(doc => doc.ref.collection('public').doc('rosters')));
  return build(snapshot.docs.map((doc, index) => ({ doc: { ...plain(doc.data()), id: doc.id }, roster: rosters[index]?.exists ? plain(rosters[index].data()) : null })));
}

async function viaRest(env: Env, token: string, fetcher: typeof fetch): Promise<PublishedData> {
  const base = `${emulated(env) ? 'http://127.0.0.1:8085' : 'https://firestore.googleapis.com'}/v1/projects/${encodeURIComponent(env.VITE_FIREBASE_PROJECT_ID || '')}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetcher(`${base}:runQuery`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'tournaments' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } }, limit: 100 } }),
  });
  if (!response.ok) throw new Error(`Tournament query failed (${response.status}).`);
  const rows = (await response.json() as any[]).filter(row => row?.document?.fields);
  return build(await Promise.all(rows.map(async row => {
    const doc = decodeFields(row.document.fields) as TournamentDoc;
    doc.id ||= String(row.document.name || '').split('/').pop() || '';
    let roster: RosterDoc | null = null;
    try {
      const r = await fetcher(`${base}/tournaments/${encodeURIComponent(doc.id)}/public/rosters`, { headers, signal: AbortSignal.timeout(8000) });
      const fields = r.ok ? (await r.json() as any)?.fields : undefined;
      if (fields) roster = decodeFields(fields) as RosterDoc;
    } catch { /* A missing roster only hides player names. */ }
    return { doc, roster };
  })));
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
