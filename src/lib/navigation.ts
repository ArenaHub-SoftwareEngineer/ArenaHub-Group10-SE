import { useEffect, useState } from 'react';
const allowed = {
  arena: ['home', 'live', 'current-live', 'choose-tournament', 'brackets', 'teams', 'ai-assistant', 'support', 'settings', 'schedule', 'integrity', 'operations', 'standings'],
  admin: ['overview', 'users', 'games', 'reports', 'featured', 'bracket-studio', 'ai-assistant', 'match-data', 'live-stream', 'integrity', 'match-monitor', 'operations', 'support', 'settings'],
};
export function readHistoryTab(scope: keyof typeof allowed, hash: string, initial: string): string {
  const [section, tab] = hash.split('?')[0].replace(/^#\//, '').split('/');
  return section === scope && allowed[scope].includes(tab) ? tab : initial;
}
export function useHistoryTab(scope: keyof typeof allowed, initial: string): [string, (tab: string, params?: Record<string, string>) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => { const sync = () => setHash(window.location.hash); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync); return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); }; }, [scope]);
  return [readHistoryTab(scope, hash, initial), (next, params = {}) => {
    const safe = allowed[scope].includes(next) ? next : initial;
    const query = new URLSearchParams(params).toString();
    const target = `#/${scope}/${safe}${query ? `?${query}` : ''}`;
    if (window.location.hash !== target) window.history.pushState(null, '', target);
    setHash(target);
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
  }];
}
