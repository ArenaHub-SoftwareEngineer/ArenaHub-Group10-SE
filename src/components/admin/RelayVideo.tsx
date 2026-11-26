// One iPhone screen on the live wall, played from the iPhone relay (MediaMTX) instead of LiveKit, because Safari
// cannot share the screen. WebRTC first (about 1 s behind). A laptop relay sits behind a Cloudflare tunnel that
// carries web requests but not WebRTC media, so a wall elsewhere switches to HLS (a few seconds behind).
import React, { useEffect, useRef, useState } from 'react';
import { playWhep } from '../../lib/whep';
import { playHls } from '../../lib/hlsRelay';

/** Where one iPhone stream plays from. `hls` is set for laptop relays. Passes renew in `auth` without reconnecting. */
export interface RelayFeed { url: string; hls?: string; auth: React.MutableRefObject<{ user: string; pass: string }> }

type RelayState = 'connecting' | 'live' | 'retrying';
/**
 * One relay connection per iPhone, shared by every tile that shows it. Spotlight and full screen remount the tile;
 * without sharing, each remount would start a new connection and show black until the next key frame.
 */
interface SharedRelay {
  users: number; state: RelayState; busy: boolean; retry?: number; idle?: number; listeners: Set<() => void>;
  /** WebRTC gives a stream; HLS (laptop relay seen from elsewhere) gives its own video element, moved between tiles. */
  stream?: MediaStream; element?: HTMLVideoElement; resume?: () => void; close?: () => void;
  /** WebRTC could not reach this relay, so this wall plays HLS from now on. */
  hlsOnly: boolean;
}
const relayConnections = new WeakMap<RelayFeed, SharedRelay>();
function relayConnection(feed: RelayFeed) {
  let entry = relayConnections.get(feed);
  if (entry) return entry;
  const shared: SharedRelay = { users: 0, state: 'connecting', busy: false, hlsOnly: false, listeners: new Set() };
  relayConnections.set(feed, shared);
  const set = (state: RelayState) => { shared.state = state; shared.listeners.forEach(listener => listener()); };
  const fail = () => {
    shared.stream = undefined; shared.element = undefined; shared.resume = undefined; shared.close = undefined;
    if (!shared.users) return;
    set('retrying');
    shared.retry = window.setTimeout(() => { shared.retry = undefined; start(); }, 3000);
  };
  function start() {
    if (shared.busy || shared.stream || shared.element || shared.retry !== undefined) return;
    shared.busy = true;
    if (shared.hlsOnly && feed.hls) {
      playHls(feed.hls, () => feed.auth.current, fail)
        .then(session => {
          shared.busy = false;
          if (!shared.users) { session.close(); return; }
          shared.element = session.video; shared.resume = session.resume; shared.close = session.close;
          set('live');
        })
        .catch(() => { shared.busy = false; fail(); });
      return;
    }
    const { user, pass } = feed.auth.current;
    playWhep(feed.url, user, pass, fail)
      .then(async session => {
        // A laptop relay is reachable over WebRTC only from the laptop itself or its Wi-Fi. Elsewhere, switch to HLS.
        if (feed.hls && !(await session.connected(6000))) {
          session.close();
          shared.busy = false; shared.hlsOnly = true;
          start();
          return;
        }
        shared.busy = false;
        if (!shared.users) { session.close(); return; }
        shared.stream = session.stream; shared.close = session.close;
        set('live');
      })
      .catch(() => { shared.busy = false; fail(); });
  }
  entry = Object.assign(shared, {
    acquire(listener: () => void) {
      shared.users++; shared.listeners.add(listener);
      window.clearTimeout(shared.idle);
      start();
      return () => {
        shared.users--; shared.listeners.delete(listener);
        // Wait a moment: a remounting tile picks the same connection up again.
        if (!shared.users) shared.idle = window.setTimeout(() => {
          if (shared.users) return;
          window.clearTimeout(shared.retry); shared.retry = undefined;
          shared.close?.(); shared.stream = undefined; shared.element = undefined; shared.resume = undefined; shared.close = undefined; shared.state = 'connecting';
        }, 3000);
      };
    },
  });
  return entry;
}

/** One iPhone screen from the relay. It reconnects by itself if the phone's connection drops for a moment. */
export function RelayVideo({ feed, label }: { feed: RelayFeed; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RelayState>('connecting');
  const [hls, setHls] = useState(false);
  useEffect(() => {
    const connection = relayConnection(feed) as SharedRelay & { acquire: (listener: () => void) => () => void };
    const sync = () => {
      setState(connection.state);
      setHls(!!connection.element);
      if (video.current && video.current.srcObject !== (connection.stream || null)) video.current.srcObject = connection.stream || null;
      // HLS plays in one element per iPhone; it moves into whichever tile shows that iPhone now.
      const element = connection.element;
      if (element && holder.current && element.parentElement !== holder.current) {
        element.setAttribute('aria-label', label);
        holder.current.replaceChildren(element);
        connection.resume?.();
      }
    };
    const release = connection.acquire(sync);
    sync();
    return release;
  }, [feed, label]);
  return <>
    <video ref={video} className="lw-video" autoPlay muted playsInline aria-label={label} hidden={hls} />
    <div ref={holder} className="lw-video-holder" hidden={!hls} />
    {state !== 'live' && <span className="lw-weak">{state === 'connecting' ? 'Connecting to iPhone…' : 'Reconnecting to iPhone…'}</span>}
  </>;
}
