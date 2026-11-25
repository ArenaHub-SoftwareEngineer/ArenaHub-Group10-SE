// Live player screens: who may share into which match, who may watch it, and the referee pause.
// Video never passes through here. Players and staff receive LiveKit tokens (see liveScreens.ts).
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthError, bearer, requireStaff, type VerifyCaller } from './auth.ts';
import { hasCampusEmail } from '../src/lib/institution.ts';
import { GAME_LABEL } from '../src/lib/integrityRisk.ts';
import { roomOpen, type RoomRow, type SessionRow, type MonitorStore } from './monitorStore.ts';
import { SCREEN_KEY, roomScreenKey, type LiveScreens, type ScreenRoomState } from './liveScreens.ts';
import type { IphoneRelay, RelayAuthRequest } from './iphoneRelay.ts';

const MAX_STAFF_PER_MATCH = 4;
function sign(room: RoomRow, purpose: string, value: string) {
  return createHmac('sha256', room.secret).update(purpose + ':' + value).digest('base64url');
}
function equal(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
/**
 * The player's private sharing key: check-in room, session, and the screen room (match) it may share into, signed
 * with the check-in room's secret. The match is fixed at check-in, so the key cannot be pointed at another match.
 */
export function screenCredential(room: RoomRow, sessionId: string, key: string) {
  if (!SCREEN_KEY.test(key)) throw new Error('Invalid screen room.');
  return [room.id, sessionId, key, sign(room, 'screen-publisher', sessionId + ':' + key)].join('.');
}
/** Rooms made for one bracket match share into that match. Scrim, test and all-games rooms share into the room. */
export const defaultScreenKey = (room: RoomRow) => room.match_id ? 'm-' + room.match_id : roomScreenKey(room.id);

class ScreenError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Action = (req: express.Request, res: express.Response) => Promise<void>;
function route(action: Action): express.RequestHandler {
  return (req, res, next) => { void action(req, res).catch(error => {
    if (error instanceof ScreenError || error instanceof AuthError) res.status(error.status).json({ error: error.message });
    else next(error);
  }); };
}
// A test room can try sharing without finishing the device scan.
function canShare(row: SessionRow, room: RoomRow, now: number) {
  return row.expires_at > now && (row.status === 'active' || (row.status === 'pending' && (room.test_room || row.code_expires_at >= now)));
}
const MANAGERS = ['admin', 'school-admin', 'organizer'];
const staffName = (email: string) => email.split('@')[0].slice(0, 60) || 'Staff';
/**
 * A local LiveKit (ws://localhost:7880) is "localhost" only on the laptop. A phone that opened the site at the
 * laptop's Wi-Fi address gets that address instead, so it can reach the same media server.
 */
export function clientLiveUrl(url: string, requestHost: string | undefined) {
  const host = (requestHost || '').replace(/:\d+$/, '');
  if (!/^ws:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url) || !/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === '127.0.0.1') return url;
  return url.replace(/^ws:\/\/(localhost|127\.0\.0\.1)/, 'ws://' + host);
}

export function screenWallRouter(store: MonitorStore, verify: VerifyCaller, screens: LiveScreens | null, allowOrigin: (req: express.Request) => boolean, relay: IphoneRelay | null = null) {
  const router = express.Router();
  router.use('/screenwall', (req, res, next) => {
    if (allowOrigin(req)) next();
    else res.status(403).json({ error: 'Open the screen wall from your ArenaHub website.' });
  });
  const requireScreens = () => {
    if (!screens) throw new ScreenError(503, 'Live screens are not set up on this server yet. Add the LiveKit settings (see docs/LIVE_SCREENS.md).');
    return screens;
  };
  const lastToken = new Map<string, number>();

  // ---------- Players ----------
  async function publisher(req: express.Request) {
    const [rid, sid, key, mac, extra] = (bearer(req.get('authorization')) || '').split('.');
    if (!rid || !sid || !key || !mac || extra || !/^[\w-]{1,80}$/.test(sid) || !/^[\w-]{1,80}$/.test(rid) || !SCREEN_KEY.test(key)) throw new ScreenError(401, 'Open your private sharing link after match check-in.');
    const room = await store.room(rid);
    if (!room || !roomOpen(room, store.now())) throw new ScreenError(410, 'This check-in has closed. Ask your organizer for the current QR.');
    if (!equal(sign(room, 'screen-publisher', sid + ':' + key), mac) || !Object.values(room.joined).some(s => s.sessionId === sid)) throw new ScreenError(403, 'This sharing link is no longer valid.');
    const row = await store.session(sid);
    if (!row || row.room_id !== rid || !canShare(row, room, store.now())) throw new ScreenError(410, 'Your check-in ended. Check in again to share.');
    return { room, row, key };
  }
  router.post('/device/pov/info', route(async (req, res) => {
    const { row } = await publisher(req);
    res.json({ name: row.player_name, team: row.team, match: row.match_label, game: row.game, gameLabel: GAME_LABEL[row.game], ready: !!screens });
  }));
  router.post('/device/pov/token', route(async (req, res) => {
    const { row, key } = await publisher(req);
    const live = requireScreens();
    const last = lastToken.get(row.id) || 0;
    if (Date.now() - last < 1000) throw new ScreenError(429, 'Wait a second and try again.');
    lastToken.set(row.id, Date.now());
    if (lastToken.size > 5000) lastToken.clear();
    const token = await live.publisherToken(key, { sessionId: row.id, name: row.player_name, team: row.team, platform: row.platform, game: row.game });
    res.json({ url: clientLiveUrl(live.url, req.get('host')), token, name: row.player_name, match: row.match_label });
  }));

  // iPhones share through a streaming app (PRISM, Streamlabs) and the relay, not through LiveKit (see iphoneRelay.ts).
  router.post('/device/pov/relay', route(async (req, res) => {
    const { row, key } = await publisher(req);
    if (!relay) throw new ScreenError(503, 'iPhone screen sharing is not set up on this server yet. Tell your organizer.');
    res.json({ ...relay.publishTarget(key, row.id), name: row.player_name, match: row.match_label });
  }));
  // The iPhone setup page asks this while the player starts the broadcast, so it can say "Your screen is live".
  router.post('/device/pov/relay/status', route(async (req, res) => {
    const { row, key } = await publisher(req);
    if (!relay) throw new ScreenError(503, 'iPhone screen sharing is not set up on this server yet. Tell your organizer.');
    let streams: Awaited<ReturnType<IphoneRelay['streams']>> = [];
    try { streams = await relay.streams(key); }
    catch { res.json({ live: false, error: 'The iPhone relay did not answer. Try again in a moment.' }); return; }
    res.json({ live: streams.some(stream => stream.sessionId === row.id) });
  }));
  // The relay asks before every publish, view and API call. Anything this server did not sign is refused.
  router.post('/relay/auth', express.json({ limit: '4kb' }), route(async (req, res) => {
    const ask = (req.body || {}) as RelayAuthRequest;
    const user = String(ask.user || ''), pass = String(ask.password || ''), path = String(ask.path || ''), now = store.now();
    let allowed = false;
    if (relay && ask.action === 'publish') {
      const owner = relay.publisherOf(path), row = owner && await store.session(owner.sessionId);
      const room = row?.room_id ? await store.room(row.room_id) : undefined;
      allowed = !!(row && room && roomOpen(room, now) && Object.values(room.joined).some(s => s.sessionId === row.id) && canShare(row, room, now));
    } else if (relay && (ask.action === 'read' || ask.action === 'playback')) allowed = relay.canRead(user, pass, path, now);
    else if (relay && ask.action === 'api') allowed = relay.canUseApi(user, pass);
    res.status(allowed ? 200 : 401).json(allowed ? { ok: true } : { error: 'Not allowed.' });
  }));

  // ---------- Staff ----------
  const caller = (req: express.Request) => requireStaff(verify, bearer(req.get('authorization')), 'Tournament staff access required.');
  const screenKey = (req: express.Request) => {
    const key = String(req.params.key);
    if (!SCREEN_KEY.test(key)) throw new ScreenError(400, 'Choose a match.');
    return key;
  };
  async function watcher(req: express.Request) {
    const person = await caller(req), key = screenKey(req);
    const manage = MANAGERS.includes(person.role), email = person.email.toLowerCase();
    if (!manage && !((await store.screenStaff())[key] || []).includes(email)) throw new ScreenError(403, 'Ask the organizer to assign you to this match.');
    return { person, key, manage, email };
  }
  router.get('/screenwall/status', route(async (req, res) => {
    const person = await caller(req);
    const manage = MANAGERS.includes(person.role), email = person.email.toLowerCase(), now = store.now();
    const all = await store.screenStaff();
    const staff = Object.fromEntries(Object.entries(all).filter(([, emails]) => manage || emails.includes(email)));
    const visible = (key: string) => manage || key in staff;
    let live: Record<string, unknown> = {}, liveError = '';
    if (screens) {
      try { live = Object.fromEntries(Object.entries(await screens.live()).filter(([key]) => visible(key))); }
      catch { liveError = 'The live screen server did not answer. Check that LiveKit is running.'; }
    }
    // iPhones share through the relay, so they are added to each match's sharing count here.
    if (relay) {
      try {
        for (const [key, count] of Object.entries(await relay.counts())) {
          if (!visible(key)) continue;
          const current = live[key] as { publishers: number; state: ScreenRoomState } | undefined;
          live[key] = { publishers: (current?.publishers || 0) + count, state: current?.state || { paused: false } };
        }
      } catch { liveError = liveError || 'The iPhone relay did not answer. Check that it is running.'; }
    }
    // Scrim and test check-ins have no scheduled match, so they are listed as their own screen rooms.
    const scrims = (await store.rooms()).filter(room => roomOpen(room, now) && !room.match_id && !room.verified_checkin)
      .map(room => ({ key: roomScreenKey(room.id), label: room.label, game: room.game || null, gameLabel: room.game ? GAME_LABEL[room.game] : 'Any game', players: room.players.map(player => ({ name: player.name, team: player.team })) }))
      .filter(room => visible(room.key));
    res.json({ configured: !!screens, liveError, manage, email, staff, live, scrims });
  }));
  router.post('/screenwall/:key/staff', express.json({ limit: '2kb' }), route(async (req, res) => {
    const person = await caller(req), key = screenKey(req);
    if (!MANAGERS.includes(person.role)) throw new ScreenError(403, 'An administrator or organizer assigns facilitators.');
    const raw = req.body?.emails;
    if (!Array.isArray(raw) || raw.length > MAX_STAFF_PER_MATCH || raw.some(email => typeof email !== 'string' || email.length > 160)) throw new ScreenError(400, `Assign up to ${MAX_STAFF_PER_MATCH} facilitators.`);
    const emails = [...new Set(raw.map((email: string) => email.trim().toLowerCase()).filter(Boolean))];
    if (emails.some(email => !hasCampusEmail(email))) throw new ScreenError(400, 'Use each facilitator’s school staff email.');
    await store.setScreenStaff(key, emails, person.uid);
    res.json({ emails });
  }));
  router.post('/screenwall/:key/watch', route(async (req, res) => {
    const { person, key, manage, email } = await watcher(req);
    const live = requireScreens();
    res.json({ url: clientLiveUrl(live.url, req.get('host')), token: await live.viewerToken(key, { uid: person.uid, name: staffName(email) }), manage });
  }));
  // iPhone screens that are live in this match, with a short-lived pass to play them from the relay.
  router.get('/screenwall/:key/relay', route(async (req, res) => {
    const { key } = await watcher(req);
    if (!relay) { res.json({ configured: false, streams: [] }); return; }
    let streams: Awaited<ReturnType<IphoneRelay['streams']>> = [], error = '';
    try { streams = await relay.streams(key); }
    catch { error = 'The iPhone relay did not answer. Check that it is running.'; }
    const named = await Promise.all(streams.map(async stream => {
      const row = await store.session(stream.sessionId);
      return row ? { ...stream, name: row.player_name, team: row.team } : null;
    }));
    res.json({ configured: true, error, web: relay.web, ...relay.readerCredentials(key, store.now()), streams: named.filter(Boolean) });
  }));
  router.post('/screenwall/:key/pause', express.json({ limit: '1kb' }), route(async (req, res) => {
    const { key, email } = await watcher(req);
    const live = requireScreens();
    const paused = req.body?.paused === true, note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';
    const state: ScreenRoomState = paused ? { paused, by: staffName(email), at: store.now(), note } : { paused: false };
    await live.setState(key, state);
    await store.audit(email, paused ? 'screen-pause' : 'screen-resume', '', key + (note ? ' · ' + note : ''));
    res.json(state);
  }));
  return router;
}
