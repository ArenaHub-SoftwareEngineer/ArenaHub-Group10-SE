// Live player screens: who may share into which match, who may watch it, and the referee pause.
// Video never passes through here. Players and staff receive LiveKit tokens (see liveScreens.ts).
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthError, bearer, requireStaff, type VerifyCaller } from './auth.ts';
import { hasCampusEmail } from '../src/lib/institution.ts';
import { GAME_LABEL } from '../src/lib/integrityRisk.ts';
import { roomOpen, type RoomRow, type SessionRow, type MonitorStore } from './monitorStore.ts';
import { SCREEN_KEY, roomScreenKey, type LiveScreens, type ScreenRoomState } from './liveScreens.ts';

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

export function screenWallRouter(store: MonitorStore, verify: VerifyCaller, screens: LiveScreens | null, allowOrigin: (req: express.Request) => boolean) {
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
    res.json({ url: live.url, token, name: row.player_name, match: row.match_label });
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
    res.json({ url: live.url, token: await live.viewerToken(key, { uid: person.uid, name: staffName(email) }), manage });
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
