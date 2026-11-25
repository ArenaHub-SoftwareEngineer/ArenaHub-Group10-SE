// iPhone live screens through a free relay (MediaMTX).
// Safari cannot capture the iPhone screen, and a native broadcast app needs a paid Apple developer account. Free
// App Store streaming apps (PRISM Live Studio, Streamlabs) can broadcast the whole iPhone screen to a "Custom
// RTMP" address, though. The relay receives that RTMP stream and plays it to the staff wall over WebRTC (WHEP),
// without re-encoding, so a small free cloud VM is enough.
//
// The relay holds no accounts. For every publish, view and API call it asks this server (POST /relay/auth),
// which answers from signed values only:
//   publish  path <screenKey>/<sessionId>-<mac>   the player's private stream key, valid while their check-in is
//   read     user w.<screenKey>.<expiry>, pass <mac>   short-lived, issued to facilitators of that match
//   api      user arenahub-api, pass <mac>          this server listing who is live
//
//   IPHONE_RELAY_RTMP    rtmp://<relay-host>:1935      where iPhones send their screen
//   IPHONE_RELAY_WEB     https://<relay-host>          where the wall plays it (WHEP) and the API lives (/v3)
//   IPHONE_RELAY_SECRET  long random string, known only to this server
//   IPHONE_RELAY_API     optional: where this server reaches the relay API, when not IPHONE_RELAY_WEB (/v3)
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SCREEN_KEY } from './liveScreens.ts';

type Env = Record<string, string | undefined>;
const MAC_LENGTH = 22;
const READ_TTL_MS = 30 * 60_000;
const API_USER = 'arenahub-api';

export interface RelayStream { path: string; sessionId: string; since: number }
export interface RelayAuthRequest { action?: string; path?: string; user?: string; password?: string; protocol?: string }
export interface IphoneRelay {
  rtmp: string; web: string;
  /** The RTMP server address and stream key a player types into their streaming app. */
  publishTarget(key: string, sessionId: string): { server: string; streamKey: string; url: string };
  /** The session a publish path belongs to, or null when the path was not signed by this server. */
  publisherOf(path: string): { key: string; sessionId: string } | null;
  readerCredentials(key: string, now: number): { user: string; pass: string; expiresAt: number };
  canRead(user: string, pass: string, path: string, now: number): boolean;
  canUseApi(user: string, pass: string): boolean;
  /** iPhone screens that are live in one match right now. */
  streams(key: string): Promise<RelayStream[]>;
  /** How many iPhones are live in each match, read once for the whole list. */
  counts(): Promise<Record<string, number>>;
}

export function iphoneRelayFromEnv(env: Env, fetcher: typeof fetch = fetch): IphoneRelay | null {
  const rtmp = (env.IPHONE_RELAY_RTMP || '').trim().replace(/\/+$/, ''), web = (env.IPHONE_RELAY_WEB || '').trim().replace(/\/+$/, '');
  const secret = (env.IPHONE_RELAY_SECRET || '').trim(), api = (env.IPHONE_RELAY_API || '').trim().replace(/\/+$/, '') || undefined;
  if (!rtmp || !web || !secret) return null;
  if (!/^rtmps?:\/\/[^/]+$/.test(rtmp)) throw new Error('IPHONE_RELAY_RTMP must look like rtmp://relay-host:1935');
  if (!/^https?:\/\/[^/]+$/.test(web)) throw new Error('IPHONE_RELAY_WEB must look like https://relay-host');
  if (secret.length < 24) throw new Error('IPHONE_RELAY_SECRET must be at least 24 characters.');
  return createIphoneRelay({ rtmp, web, secret, api }, fetcher);
}

export function createIphoneRelay({ rtmp, web, secret, api = web }: { rtmp: string; web: string; secret: string; api?: string }, fetcher: typeof fetch = fetch): IphoneRelay {
  const mac = (purpose: string, value: string, length = MAC_LENGTH) => createHmac('sha256', secret).update(purpose + ':' + value).digest('base64url').slice(0, length);
  const same = (left: string, right: string) => {
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const apiPass = mac('api', API_USER, 43);
  const publisherOf = (path: string) => {
    const match = /^([mr]-[A-Za-z0-9_-]{1,80})\/([\w-]{1,80})-([\w-]{22})$/.exec(path || '');
    if (!match || !SCREEN_KEY.test(match[1])) return null;
    const [, key, sessionId, signature] = match;
    return same(mac('publish', key + '/' + sessionId), signature) ? { key, sessionId } : null;
  };
  let cached: { at: number; data: Promise<Array<RelayStream & { key: string }>> } | null = null;
  // Every live, signed stream on the relay. Cached for 3 s: the match list and several walls poll it.
  const all = () => {
    if (cached && Date.now() - cached.at < 3000) return cached.data;
    const data = fetcher(api + '/v3/paths/list?itemsPerPage=1000', {
      headers: { Authorization: 'Basic ' + Buffer.from(API_USER + ':' + apiPass).toString('base64') }, signal: AbortSignal.timeout(6000),
    }).then(async response => {
      if (!response.ok) throw new Error(`The iPhone relay answered ${response.status}.`);
      const body = await response.json() as { items?: Array<{ name?: string; ready?: boolean; readyTime?: string | null }> };
      return (body.items || []).flatMap(item => {
        const owner = item.ready ? publisherOf(item.name || '') : null;
        return owner ? [{ key: owner.key, path: item.name!, sessionId: owner.sessionId, since: Date.parse(item.readyTime || '') || 0 }] : [];
      });
    });
    cached = { at: Date.now(), data };
    data.catch(() => { if (cached?.data === data) cached = null; });
    return data;
  };
  return {
    rtmp, web,
    publishTarget(key, sessionId) {
      if (!SCREEN_KEY.test(key) || !/^[\w-]{1,80}$/.test(sessionId)) throw new Error('Invalid screen room.');
      const server = rtmp + '/' + key, streamKey = sessionId + '-' + mac('publish', key + '/' + sessionId);
      return { server, streamKey, url: server + '/' + streamKey };
    },
    publisherOf,
    readerCredentials(key, now) {
      const expiresAt = now + READ_TTL_MS, user = `w.${key}.${expiresAt}`;
      return { user, pass: mac('read', user), expiresAt };
    },
    canRead(user, pass, path, now) {
      const match = /^w\.([mr]-[A-Za-z0-9_-]{1,80})\.(\d{13})$/.exec(user || '');
      if (!match || Number(match[2]) < now || !same(mac('read', user), pass || '')) return false;
      // A facilitator may watch the iPhones of their own match only.
      return publisherOf(path)?.key === match[1];
    },
    canUseApi: (user, pass) => user === API_USER && same(apiPass, pass || ''),
    async streams(key) {
      return (await all()).filter(stream => stream.key === key).map(({ key: _key, ...stream }) => stream);
    },
    async counts() {
      const counts: Record<string, number> = {};
      for (const stream of await all()) counts[stream.key] = (counts[stream.key] || 0) + 1;
      return counts;
    },
  };
}
