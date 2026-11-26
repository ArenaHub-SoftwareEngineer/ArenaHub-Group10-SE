// Live player screens: who may share into which match, who may watch it, and the referee pause.
// Video never passes through here. Players and staff receive LiveKit tokens (see liveScreens.ts).
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthError, MONITOR_MANAGERS as MANAGERS, bearer, requireMonitorAccess, type VerifyCaller } from './auth.ts';
import { hasCampusEmail } from '../src/lib/institution.ts';
import { GAME_LABEL } from '../src/lib/integrityRisk.ts';
import { roomOpen, type RoomRow, type SessionRow, type MonitorStore } from './monitorStore.ts';
import { SCREEN_KEY, roomScreenKey, type LiveScreens, type ScreenRoomState } from './liveScreens.ts';
import { RelayOfflineError, type IphoneRelay, type RelayAuthRequest } from './iphoneRelay.ts';

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
/** The iPhone relay id for a player: their school account, or for a test check-in without sign-in, that session. */
export const iphonePlayerId = (relay: IphoneRelay, row: Pick<SessionRow, 'email' | 'id'>) =>
  relay.playerId(row.email ? 'email:' + row.email.trim().toLowerCase() : 'session:' + row.id);
const deviceLabel = (row: SessionRow) => {
  try { const device = JSON.parse(row.device || 'null') as { model?: string; os?: string } | null; return [device?.model, device?.os].filter(Boolean).join(' ').slice(0, 80); }
  catch { return ''; }
};
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
    res.json({ url: clientLiveUrl(await live.address(), req.get('host')), token, name: row.player_name, match: row.match_label });
  }));

  // iPhones share through a streaming app (PRISM, Streamlabs) and the relay, not through LiveKit (see iphoneRelay.ts).
  // The player's PRISM stream key never changes (one per school account), so it is set up once. Each check-in tells
  // the setup record which session and match that stream belongs to now; the first time the relay really receives
  // it, the setup counts as verified, and later check-ins just say "open PRISM and go live".
  // Live player streams with the check-in each belongs to now.
  async function liveOwned() {
    const streams = await relay!.live();
    const setups = new Map((await store.iphoneSetups(streams.map(stream => stream.playerId))).map(setup => [setup.player_id, setup]));
    return streams.flatMap(stream => {
      const setup = setups.get(stream.playerId);
      return setup ? [{ ...stream, key: setup.screen_key, sessionId: setup.session_id }] : [];
    });
  }
  const notSetUp = () => new ScreenError(503, 'iPhone screen sharing is not set up on this server yet. Tell your organizer.');
  router.post('/device/pov/relay', route(async (req, res) => {
    const { row, key } = await publisher(req);
    if (!relay) throw notSetUp();
    const playerId = iphonePlayerId(relay, row);
    let target: Awaited<ReturnType<IphoneRelay['publishTarget']>>;
    try { target = await relay.publishTarget(playerId); }
    catch (error) {
      if (error instanceof RelayOfflineError) throw new ScreenError(503, error.message);
      throw error;
    }
    const [saved] = await store.iphoneSetups([playerId]);
    if (!saved || saved.session_id !== row.id || saved.screen_key !== key) {
      await store.saveIphoneSetup({ player_id: playerId, email: row.email || '', session_id: row.id, screen_key: key, updated_at: store.now(),
        verified_at: saved?.verified_at ?? null, verified_server: saved?.verified_server || '', device: saved?.device || '' });
    }
    const verified = !!saved?.verified_at;
    res.json({ ...target, name: row.player_name, match: row.match_label, setup: {
      // Set up before with these same codes: PRISM already has them.
      verified: verified && saved!.verified_server === target.server,
      // Set up before, but the relay address changed since: only the Stream URL needs pasting again.
      serverChanged: verified && saved!.verified_server !== target.server,
      verifiedAt: saved?.verified_at ?? null, device: saved?.device || '',
    } });
  }));
  // The iPhone setup page asks this while the player starts the broadcast, so it can say "Your screen is live".
  router.post('/device/pov/relay/status', route(async (req, res) => {
    const { row } = await publisher(req);
    if (!relay) throw notSetUp();
    const playerId = iphonePlayerId(relay, row);
    let streams: Awaited<ReturnType<IphoneRelay['live']>> = [];
    try { streams = await relay.live(); }
    catch { res.json({ live: false, error: 'The iPhone relay did not answer. Try again in a moment.' }); return; }
    const [setup] = await store.iphoneSetups([playerId]);
    const live = !!setup && setup.session_id === row.id && streams.some(stream => stream.playerId === playerId);
    if (live) {
      // The relay received this player's screen: their PRISM is set up (for this relay address).
      const server = (await relay.publishTarget(playerId).catch(() => null))?.server || setup.verified_server;
      if (!setup.verified_at || setup.verified_server !== server) {
        await store.saveIphoneSetup({ ...setup, verified_at: store.now(), verified_server: server, device: deviceLabel(row), updated_at: store.now() });
        await store.audit('player', 'iphone-setup-verified', row.id, `${row.player_name}: PRISM stream received${deviceLabel(row) ? ` from ${deviceLabel(row)}` : ''}`);
      }
    }
    res.json({ live, verified: live || !!setup?.verified_at });
  }));
  // The relay asks before every publish, view and API call. Anything this server did not sign is refused.
  router.post('/relay/auth', express.json({ limit: '4kb' }), route(async (req, res) => {
    const ask = (req.body || {}) as RelayAuthRequest;
    const user = String(ask.user || ''), pass = String(ask.password || ''), path = String(ask.path || ''), now = store.now();
    let allowed = false;
    if (relay && ask.action === 'publish') {
      // The stream key is the player's; it may publish only while their current check-in is open.
      const owner = relay.publisherOf(path), [setup] = owner ? await store.iphoneSetups([owner.playerId]) : [];
      const row = setup ? await store.session(setup.session_id) : undefined;
      const room = row?.room_id ? await store.room(row.room_id) : undefined;
      allowed = !!(owner && row && room && iphonePlayerId(relay, row) === owner.playerId && roomOpen(room, now)
        && Object.values(room.joined).some(s => s.sessionId === row.id) && canShare(row, room, now));
    } else if (relay && (ask.action === 'read' || ask.action === 'playback')) allowed = relay.canRead(user, pass, path, now);
    else if (relay && ask.action === 'api') allowed = relay.canUseApi(user, pass);
    res.status(allowed ? 200 : 401).json(allowed ? { ok: true } : { error: 'Not allowed.' });
  }));
  // Laptop mode: the laptop relay checks in every 20 s with its current tunnel addresses, signed with the shared secret.
  router.post('/relay/register', express.json({ limit: '2kb' }), route(async (req, res) => {
    const accepted = !!relay?.laptop && await relay.register(req.body, Date.now());
    res.status(accepted ? 200 : 401).json(accepted ? { ok: true } : { error: 'Not allowed.' });
  }));

  // ---------- Staff ----------
  const caller = (req: express.Request) => requireMonitorAccess(verify, bearer(req.get('authorization')), 'Tournament staff access required.');
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
        if (relay.laptop && !await relay.place()) throw new Error('offline');
        for (const { key } of await liveOwned()) {
          if (!visible(key)) continue;
          const current = live[key] as { publishers: number; state: ScreenRoomState } | undefined;
          live[key] = { publishers: (current?.publishers || 0) + 1, state: current?.state || { paused: false } };
        }
      } catch (error) {
        liveError = liveError || ((error as Error).message === 'offline'
          ? 'iPhone screens are off: the relay laptop is not running. Start it with npm run relay:laptop. Android and PC screens are not affected.'
          : 'The iPhone relay did not answer. Check that it is running.');
      }
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
    res.json({ url: clientLiveUrl(await live.address(), req.get('host')), token: await live.viewerToken(key, { uid: person.uid, name: staffName(email) }), manage });
  }));
  // iPhone screens that are live in this match, with a short-lived pass to play them from the relay.
  router.get('/screenwall/:key/relay', route(async (req, res) => {
    const { key } = await watcher(req);
    if (!relay) { res.json({ configured: false, streams: [] }); return; }
    let streams: Awaited<ReturnType<typeof liveOwned>> = [], error = '';
    const where = await relay.place().catch(() => null);
    if (!where) error = relay.laptop ? 'The iPhone relay laptop is offline. Start it with npm run relay:laptop.' : 'The iPhone relay did not answer. Check that it is running.';
    else {
      try { streams = (await liveOwned()).filter(stream => stream.key === key); }
      catch { error = 'The iPhone relay did not answer. Check that it is running.'; }
    }
    const named = (await Promise.all(streams.map(async stream => {
      const row = await store.session(stream.sessionId);
      return row ? { path: stream.path, playerId: stream.playerId, sessionId: stream.sessionId, since: stream.since, name: row.player_name, team: row.team } : null;
    }))).filter(stream => stream !== null);
    // The pass lists exactly these players, so it plays this match's iPhones and nothing else.
    res.json({ configured: true, error, web: where?.web || '', hls: !!where?.hls, ...relay.readerCredentials(key, store.now(), named.map(stream => stream.playerId)), streams: named });
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
