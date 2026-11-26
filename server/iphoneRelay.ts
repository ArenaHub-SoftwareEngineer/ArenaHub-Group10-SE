// iPhone live screens through a free relay (MediaMTX).
// Safari cannot capture the iPhone screen, and a native broadcast app needs a paid Apple developer account. Free
// App Store streaming apps (PRISM Live Studio, Streamlabs) can broadcast the whole iPhone screen to a "Custom
// RTMP" address, though. The relay receives that RTMP stream and plays it to the staff wall over WebRTC (WHEP),
// without re-encoding, so a small free cloud VM is enough.
//
// The relay holds no accounts. For every publish, view and API call it asks this server (POST /relay/auth),
// which answers from signed values only:
//   publish  path p/<playerId>-<mac>              the player's own stream key. It stays the same for every match, so
//                                                  PRISM keeps it; this server decides which match it belongs to now
//   read     user w.<screenKey>.<expiry>.<ids>, pass <mac>   short-lived, for facilitators of that match; lists the
//                                                  players they may watch, so a laptop relay can check it offline
//   api      user arenahub-api, pass <mac>          this server listing who is live
//
// Cloud VM mode:
//   IPHONE_RELAY_RTMP    rtmp://<relay-host>:1935      where iPhones send their screen
//   IPHONE_RELAY_WEB     https://<relay-host>          where the wall plays it (WHEP) and the API lives (/v3)
//   IPHONE_RELAY_SECRET  long random string, known only to this server (and a laptop relay)
//   IPHONE_RELAY_API     optional: where this server reaches the relay API, when not IPHONE_RELAY_WEB (/v3)
//
// Laptop mode (no cloud VM): set only IPHONE_RELAY_SECRET. The organizer's laptop runs the relay behind free
// tunnels (scripts/iphone-relay-laptop.ts) and tells this server its current addresses every 20 s
// (POST /relay/register, signed with the same secret), because tunnel addresses change on every start.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SCREEN_KEY } from './liveScreens.ts';

type Env = Record<string, string | undefined>;
const MAC_LENGTH = 22;
const READ_TTL_MS = 30 * 60_000;
const API_USER = 'arenahub-api';
/** A laptop relay that has not checked in for this long counts as offline. */
export const RELAY_PLACE_TTL_MS = 90_000;
const RTMP_ADDRESS = /^rtmps?:\/\/[^/\s]+$/, WEB_ADDRESS = /^https?:\/\/[^/\s]+$/;

/** Where the relay can be reached now. `hls`: the wall may fall back to HLS (a laptop relay behind tunnels). */
export interface RelayPlace { rtmp: string; web: string; api?: string; hls?: boolean; at?: number; livekit?: string }
/** Keeps the laptop relay's latest addresses where every API instance can read them (Firestore on Vercel). */
export interface RelayPlaceStore { get(): Promise<RelayPlace | null>; set(place: RelayPlace): Promise<void> }
export function memoryRelayPlaceStore(): RelayPlaceStore {
  let saved: RelayPlace | null = null;
  return { get: async () => saved, set: async next => { saved = next; } };
}

export class RelayOfflineError extends Error {
  constructor() { super('The iPhone relay is offline. Ask your organizer to start it.'); }
}

/** A signed player stream that is live on the relay. Which match it is in comes from the player's iPhone setup. */
export interface RelayStream { path: string; playerId: string; since: number }
export interface RelayAuthRequest { action?: string; path?: string; user?: string; password?: string; protocol?: string }
export interface IphoneRelay {
  /** True when the relay runs on a laptop and checks in (laptop mode). */
  readonly laptop: boolean;
  /** Where the relay is now, or null when a laptop relay is not running. */
  place(): Promise<RelayPlace | null>;
  /** A player's relay id: the same for one school account (or one test session) every time. */
  playerId(identity: string): string;
  /** The RTMP server address and stream key a player types into their streaming app. Throws RelayOfflineError. */
  publishTarget(playerId: string): Promise<{ server: string; streamKey: string; url: string }>;
  /** The player a publish path belongs to, or null when the path was not signed by this server. */
  publisherOf(path: string): { playerId: string } | null;
  /** A pass to watch these players' streams for one match. */
  readerCredentials(key: string, now: number, playerIds: string[]): { user: string; pass: string; expiresAt: number };
  canRead(user: string, pass: string, path: string, now: number): boolean;
  canUseApi(user: string, pass: string): boolean;
  /** Laptop mode: accepts a signed check-in from the laptop relay. False when the signature or time is wrong. */
  register(body: unknown, now: number): Promise<boolean>;
  /** Every signed player stream live on the relay now (cached for 3 s). */
  live(): Promise<RelayStream[]>;
}

export function iphoneRelayFromEnv(env: Env, fetcher: typeof fetch = fetch, places?: () => RelayPlaceStore): IphoneRelay | null {
  const rtmp = (env.IPHONE_RELAY_RTMP || '').trim().replace(/\/+$/, ''), web = (env.IPHONE_RELAY_WEB || '').trim().replace(/\/+$/, '');
  const secret = (env.IPHONE_RELAY_SECRET || '').trim(), api = (env.IPHONE_RELAY_API || '').trim().replace(/\/+$/, '') || undefined;
  if (!secret) return null;
  if (secret.length < 24) throw new Error('IPHONE_RELAY_SECRET must be at least 24 characters.');
  if (!rtmp && !web) return createIphoneRelay({ secret, places: places ? places() : memoryRelayPlaceStore() }, fetcher);
  if (!RTMP_ADDRESS.test(rtmp)) throw new Error('IPHONE_RELAY_RTMP must look like rtmp://relay-host:1935');
  if (!WEB_ADDRESS.test(web)) throw new Error('IPHONE_RELAY_WEB must look like https://relay-host');
  return createIphoneRelay({ rtmp, web, secret, api }, fetcher);
}

/** The signature the laptop relay puts on its check-in. */
export function relayRegistrationSignature(secret: string, place: { rtmp: string; web: string; at: number; livekit?: string }) {
  // The laptop's own LiveKit address is signed too when it sends one (older launchers do not send it).
  const text = `register:${place.rtmp}\n${place.web}\n${place.at}` + (place.livekit ? `\n${place.livekit}` : '');
  return createHmac('sha256', secret).update(text).digest('base64url');
}

type RelayOptions = { secret: string } & ({ rtmp: string; web: string; api?: string } | { places: RelayPlaceStore });

export function createIphoneRelay(options: RelayOptions, fetcher: typeof fetch = fetch): IphoneRelay {
  const { secret } = options;
  const places = 'places' in options ? options.places : null;
  const fixed: RelayPlace | null = 'places' in options ? null : { rtmp: options.rtmp, web: options.web, api: options.api || options.web };
  let placeCache: { at: number; value: Promise<RelayPlace | null> } | null = null;
  const place = (): Promise<RelayPlace | null> => {
    if (fixed) return Promise.resolve(fixed);
    // Read at most every 5 s: the match list and several walls ask often, and Firestore reads cost.
    if (!placeCache || Date.now() - placeCache.at > 5000) {
      const value = places!.get().then(found => found && Date.now() - (found.at || 0) < RELAY_PLACE_TTL_MS ? found : null);
      placeCache = { at: Date.now(), value };
      value.catch(() => { if (placeCache?.value === value) placeCache = null; });
    }
    return placeCache.value;
  };
  const mac = (purpose: string, value: string, length = MAC_LENGTH) => createHmac('sha256', secret).update(purpose + ':' + value).digest('base64url').slice(0, length);
  const same = (left: string, right: string) => {
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const apiPass = mac('api', API_USER, 43);
  const publisherOf = (path: string) => {
    const match = /^p\/([\w-]{20})-([\w-]{22})$/.exec(path || '');
    if (!match) return null;
    const [, playerId, signature] = match;
    return same(mac('publish', 'p/' + playerId), signature) ? { playerId } : null;
  };
  let cached: { at: number; data: Promise<RelayStream[]> } | null = null;
  // Every live, signed stream on the relay. Cached for 3 s: the match list and several walls poll it.
  const all = () => {
    if (cached && Date.now() - cached.at < 3000) return cached.data;
    const data = place().then(where => !where ? [] : fetcher((where.api || where.web) + '/v3/paths/list?itemsPerPage=1000', {
      headers: { Authorization: 'Basic ' + Buffer.from(API_USER + ':' + apiPass).toString('base64') }, signal: AbortSignal.timeout(6000),
    }).then(async response => {
      if (!response.ok) throw new Error(`The iPhone relay answered ${response.status}.`);
      const body = await response.json() as { items?: Array<{ name?: string; ready?: boolean; readyTime?: string | null }> };
      return (body.items || []).flatMap(item => {
        const owner = item.ready ? publisherOf(item.name || '') : null;
        return owner ? [{ path: item.name!, playerId: owner.playerId, since: Date.parse(item.readyTime || '') || 0 }] : [];
      });
    }));
    cached = { at: Date.now(), data };
    data.catch(() => { if (cached?.data === data) cached = null; });
    return data;
  };
  return {
    laptop: !!places,
    place,
    playerId: identity => mac('player', identity, 20),
    async publishTarget(playerId) {
      if (!/^[\w-]{20}$/.test(playerId)) throw new Error('Invalid player.');
      const where = await place();
      if (!where) throw new RelayOfflineError();
      const server = where.rtmp + '/p', streamKey = playerId + '-' + mac('publish', 'p/' + playerId);
      return { server, streamKey, url: server + '/' + streamKey };
    },
    publisherOf,
    readerCredentials(key, now, playerIds) {
      if (!SCREEN_KEY.test(key)) throw new Error('Invalid screen room.');
      const ids = playerIds.filter(id => /^[\w-]{20}$/.test(id)).slice(0, 40);
      const expiresAt = now + READ_TTL_MS, user = `w.${key}.${expiresAt}.${ids.join('~')}`;
      return { user, pass: mac('read', user), expiresAt };
    },
    canRead(user, pass, path, now) {
      const match = /^w\.([mr]-[A-Za-z0-9_-]{1,80})\.(\d{13})\.([\w~-]*)$/.exec(user || '');
      if (!match || Number(match[2]) < now || !same(mac('read', user), pass || '')) return false;
      // A facilitator may watch only the players this server listed in their pass (the players of their match).
      const owner = publisherOf(path);
      return !!owner && match[3].split('~').includes(owner.playerId);
    },
    canUseApi: (user, pass) => user === API_USER && same(apiPass, pass || ''),
    async register(body, now) {
      if (!places || !body || typeof body !== 'object') return false;
      const { rtmp, web, at, sig, livekit } = body as Record<string, unknown>;
      if (typeof rtmp !== 'string' || typeof web !== 'string' || typeof at !== 'number' || typeof sig !== 'string') return false;
      if (livekit !== undefined && (typeof livekit !== 'string' || !/^wss:\/\/[^/\s]+$/.test(livekit))) return false;
      // HTTPS only: the wall runs on https and cannot play from an http page.
      if (!RTMP_ADDRESS.test(rtmp) || !/^https:\/\/[^/\s]+$/.test(web) || Math.abs(now - at) > 120_000) return false;
      if (!same(relayRegistrationSignature(secret, { rtmp, web, at, livekit: livekit as string | undefined }), sig)) return false;
      const next: RelayPlace = { rtmp, web, hls: true, at: now, ...(livekit ? { livekit: livekit as string } : {}) };
      await places.set(next);
      placeCache = { at: Date.now(), value: Promise.resolve(next) };
      cached = null;
      return true;
    },
    live: all,
  };
}
