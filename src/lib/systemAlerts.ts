// System (desktop or phone) notifications for new inbox items, while ArenaHub is open in a tab (M11).
//
// Kerr's choice, 16 Nov 2026: no background push service. A notification appears only when the person has
// switched it on in Settings, the browser has granted permission, an ArenaHub tab is open, and that tab is
// not the one they are looking at. Items already in the inbox when the page loads never pop up.
import { useEffect, useRef } from 'react';
import type { ArenaNotification } from './notificationService';

const KEY = 'arenahub_system_alerts';

export type AlertState = 'unsupported' | 'denied' | 'off' | 'on';

export function alertState(): AlertState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  let wanted = false;
  try { wanted = localStorage.getItem(KEY) === 'true'; } catch { /* private mode: treated as off */ }
  return wanted && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Asks the browser once, then remembers the choice for this browser only. */
export async function setSystemAlerts(on: boolean): Promise<AlertState> {
  if (!('Notification' in window)) return 'unsupported';
  if (on && Notification.permission !== 'granted') {
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') return answer === 'denied' ? 'denied' : 'off';
  }
  try { localStorage.setItem(KEY, String(on)); } catch { /* not remembered, still applied for this page */ }
  return on ? 'on' : 'off';
}

/**
 * Inbox items to announce: unread, not seen in an earlier snapshot. The first snapshot only fills `seen`,
 * so opening the app with 20 unread items does not fire 20 notifications.
 */
export function freshAlerts(seen: Set<string> | null, items: ArenaNotification[]): { seen: Set<string>; fresh: ArenaNotification[] } {
  const next = new Set(items.map(item => item.id));
  if (!seen) return { seen: next, fresh: [] };
  return { seen: new Set([...seen, ...next]), fresh: items.filter(item => !seen.has(item.id) && !item.readAt) };
}

/** Shows fresh inbox items as system notifications while this tab is in the background. */
export function useSystemAlerts(uid: string | undefined, items: ArenaNotification[], loading: boolean, open: (item: ArenaNotification) => void) {
  const seen = useRef<Set<string> | null>(null);
  const opener = useRef(open);
  opener.current = open;
  useEffect(() => { seen.current = null; }, [uid]);
  useEffect(() => {
    if (!uid || loading) return;
    const { seen: next, fresh } = freshAlerts(seen.current, items);
    seen.current = next;
    if (!fresh.length || alertState() !== 'on' || (document.visibilityState === 'visible' && document.hasFocus())) return;
    for (const item of fresh.slice(0, 3)) {
      try {
        // The tag is the inbox id: several open ArenaHub tabs replace each other's copy instead of stacking.
        const shown = new Notification(item.title, { body: item.body, tag: `arenahub-${item.id}`, icon: '/arenahub-logo.png' });
        shown.onclick = () => { window.focus(); shown.close(); opener.current(item); };
      } catch { /* some mobile browsers only allow notifications from a service worker; the bell still shows it */ }
    }
  }, [uid, items, loading]);
}
