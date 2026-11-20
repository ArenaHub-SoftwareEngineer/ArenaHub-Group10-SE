// Live viewer counts (server/presence.ts). Costs no Firestore reads or writes.
// The watch page sends a heartbeat every 30 s; card grids ask for all their counts in one request.
import { useEffect, useMemo, useState } from 'react';
import { apiUrl } from './apiBase';

const BEAT_MS = 30_000;
const POLL_MS = 30_000;

/** One anonymous id per tab, so two tabs on one device count as two viewers, like a streaming site. */
function sessionId() {
  try {
    const saved = sessionStorage.getItem('arenahub.presence');
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => (b % 36).toString(36)).join('');
    sessionStorage.setItem('arenahub.presence', id);
    return id;
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(18)), b => (b % 36).toString(36)).join('');
  }
}
let session: string | undefined;
const mySession = () => (session ??= sessionId());

/** "1 viewer", "842 viewers", "1.2K viewers", "45.8K viewers". */
export function formatViewers(count: number) {
  const n = Math.max(0, Math.floor(count));
  const value = n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : n < 1_000_000 ? `${Math.round(n / 100) / 10}K`.replace(/\.0K$/, 'K') : `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${value} ${n === 1 ? 'viewer' : 'viewers'}`;
}

/** Counts this viewer as watching `matchId` while the page is open and visible. Returns the live count. */
export function useWatchPresence(matchId: string | undefined, enabled = true) {
  const [viewers, setViewers] = useState<number | null>(null);
  useEffect(() => {
    if (!matchId || !enabled) { setViewers(null); return; }
    let stopped = false;
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      fetch(apiUrl('/api/presence/beat'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: mySession(), match: matchId }) })
        .then(res => res.ok ? res.json() : null)
        .then(data => { if (!stopped && data && typeof data.viewers === 'number') setViewers(data.viewers); })
        .catch(() => { /* no API (static hosting): the count stays hidden */ });
    };
    const leave = () => {
      try { navigator.sendBeacon?.(apiUrl('/api/presence/leave'), new Blob([JSON.stringify({ session: mySession() })], { type: 'application/json' })); } catch { /* best effort */ }
    };
    beat();
    const timer = window.setInterval(beat, BEAT_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', leave);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [matchId, enabled]);
  return viewers;
}

/** Viewer counts for a set of matches (the cards on screen). Missing ids mean "unknown", not zero. */
export function useViewerCounts(matchIds: string[]) {
  const key = useMemo(() => [...new Set(matchIds)].sort().slice(0, 60).join(','), [matchIds]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!key) { setCounts({}); return; }
    let stopped = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      fetch(apiUrl(`/api/presence?ids=${encodeURIComponent(key)}`))
        .then(res => res.ok ? res.json() : null)
        .then(data => { if (!stopped && data?.counts && typeof data.counts === 'object') setCounts(data.counts); })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [key]);
  return counts;
}
