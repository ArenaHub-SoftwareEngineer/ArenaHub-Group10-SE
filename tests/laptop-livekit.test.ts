// The organizer laptop's own LiveKit (npm run relay:laptop) takes over Android/PC live screens while it is checked in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt } from 'jose';
import { createIphoneRelay, memoryRelayPlaceStore, relayRegistrationSignature } from '../server/iphoneRelay.ts';
import { liveScreensFromEnv } from '../server/liveScreens.ts';

const secret = 'relay-secret-'.padEnd(40, 'x');
const env = { LIVEKIT_URL: 'wss://cloud.example', LIVEKIT_API_KEY: 'APIkey', LIVEKIT_API_SECRET: 's'.repeat(40) };

test('the laptop check-in carries a signed LiveKit address', async () => {
  const relay = createIphoneRelay({ secret, places: memoryRelayPlaceStore() });
  const at = Date.now(), rtmp = 'rtmp://1.2.3.4:5000', web = 'https://a-b.trycloudflare.com', livekit = 'wss://a-b.trycloudflare.com';
  assert.equal(await relay.register({ rtmp, web, at, livekit, sig: relayRegistrationSignature(secret, { rtmp, web, at, livekit }) }, at), true);
  assert.equal((await relay.place())?.livekit, livekit);
  // Swapping the LiveKit address breaks the signature; so does a signature made without it.
  assert.equal(await relay.register({ rtmp, web, at, livekit: 'wss://evil.example', sig: relayRegistrationSignature(secret, { rtmp, web, at, livekit }) }, at), false);
  assert.equal(await relay.register({ rtmp, web, at, livekit, sig: relayRegistrationSignature(secret, { rtmp, web, at }) }, at), false);
  assert.equal(await relay.register({ rtmp, web, at, livekit: 'ws://plain.example', sig: relayRegistrationSignature(secret, { rtmp, web, at, livekit: 'ws://plain.example' }) }, at), false);
  // Older launchers (no LiveKit) still check in, and then nothing points at the laptop's LiveKit.
  assert.equal(await relay.register({ rtmp, web, at, sig: relayRegistrationSignature(secret, { rtmp, web, at }) }, at), true);
  assert.equal((await relay.place())?.livekit, undefined);
});

test('live screens use the laptop LiveKit while it is checked in, else LiveKit Cloud', async () => {
  let laptop: string | null = 'wss://a-b.trycloudflare.com';
  const screens = liveScreensFromEnv(env, async () => laptop)!;
  assert.equal(await screens.address(), 'wss://a-b.trycloudflare.com');
  laptop = null;
  assert.equal(await screens.address(), 'wss://cloud.example');
  assert.equal(await liveScreensFromEnv(env, async () => { throw new Error('Firestore down'); })!.address(), 'wss://cloud.example');
});

test('tokens survive a laptop clock that runs slow', async () => {
  const screens = liveScreensFromEnv(env)!;
  const now = Math.floor(Date.now() / 1000);
  const claims = decodeJwt(await screens.viewerToken('m-abc', { uid: 'staff1', name: 'Staff' }));
  assert.ok(claims.nbf! <= now - 3000, 'valid from about an hour ago');
  assert.ok(claims.exp! >= now + 4 * 3600, 'still the full 4 hours ahead');
  assert.equal(claims.iss, 'APIkey');
  assert.equal((claims.video as { room: string; canPublish: boolean }).room, 'arenahub-m-abc');
});
