// Live viewer counts ("1.2K viewers" on match cards), kept in this server's memory only.
//
// Why not Firestore: a heartbeat per viewer per 30 s would cost 120 writes per viewer per hour, and every
// count shown would cost reads (see docs/READ_BUDGET.md). Here a heartbeat costs nothing and one request
// returns the counts for every card on a page.
//
// Limits, on purpose:
// - Counts are a soft signal. Sessions are anonymous random ids, so each IP may hold at most
//   MAX_SESSIONS_PER_IP sessions; a lab PC with many tabs still counts, a script cannot inflate a match.
// - On a serverless host every instance has its own memory, so counts would be partial. GET then still
//   answers, and the client simply shows whatever it receives. Run the API as one Node process
//   (npm start, npm run demo, or a single always-on instance) for exact counts.
import express from 'express';

const SESSION = /^[A-Za-z0-9_-]{16,64}$/;
const MATCH = /^[A-Za-z0-9_.:-]{1,128}$/;
export const PRESENCE_TTL_MS = 70_000;
const MAX_SESSIONS = 50_000;
const MAX_SESSIONS_PER_IP = 12;
const MAX_IDS = 60;

type Session = { match: string; ip: string; seen: number };

export function createPresenceStore({ ttlMs = PRESENCE_TTL_MS, now = () => Date.now() } = {}) {
  const sessions = new Map<string, Session>();
  const sweep = () => {
    const cutoff = now() - ttlMs;
    for (const [id, session] of sessions) if (session.seen < cutoff) sessions.delete(id);
  };
  return {
    /** Records that `session` is watching `match`. Returns false when the session is refused. */
    beat(session: string, match: string, ip: string): boolean {
      if (!SESSION.test(session) || !MATCH.test(match)) return false;
      const known = sessions.get(session);
      if (!known) {
        sweep();
        if (sessions.size >= MAX_SESSIONS) return false;
        let fromIp = 0;
        for (const other of sessions.values()) if (other.ip === ip && ++fromIp >= MAX_SESSIONS_PER_IP) return false;
      } else if (known.ip !== ip) return false;
      sessions.set(session, { match, ip, seen: now() });
      return true;
    },
    /** The viewer leaves (tab closed or navigated away). */
    leave(session: string) { if (SESSION.test(session)) sessions.delete(session); },
    counts(ids: string[]): Record<string, number> {
      const cutoff = now() - ttlMs;
      const wanted = new Set(ids.filter(id => MATCH.test(id)).slice(0, MAX_IDS));
      const result: Record<string, number> = {};
      for (const id of wanted) result[id] = 0;
      for (const session of sessions.values()) if (session.seen >= cutoff && wanted.has(session.match)) result[session.match]++;
      return result;
    },
    get size() { sweep(); return sessions.size; },
  };
}

export function createPresenceRouter(store = createPresenceStore()) {
  const router = express.Router();
  router.use(express.json({ limit: '1kb' }));
  const ipOf = (req: express.Request) => req.ip || req.socket.remoteAddress || 'unknown';

  // Heartbeat: { session, match }. Answers with the match's current count so the watch page needs no GET.
  router.post('/beat', (req, res) => {
    const { session, match } = (req.body || {}) as { session?: unknown; match?: unknown };
    if (typeof session !== 'string' || typeof match !== 'string' || !store.beat(session, match, ipOf(req))) {
      res.status(400).json({ error: 'Invalid presence heartbeat.' });
      return;
    }
    res.set('Cache-Control', 'no-store').json({ viewers: store.counts([match])[match] ?? 0 });
  });
  router.post('/leave', (req, res) => {
    const { session } = (req.body || {}) as { session?: unknown };
    if (typeof session === 'string') store.leave(session);
    res.status(204).end();
  });
  // Counts for the cards on a page: GET /api/presence?ids=a,b,c
  router.get('/', (req, res) => {
    const ids = String(req.query.ids || '').split(',').map(id => id.trim()).filter(Boolean);
    res.set('Cache-Control', 'no-store').json({ counts: store.counts(ids) });
  });
  return router;
}
