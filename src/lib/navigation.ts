import { useEffect, useState } from 'react';

const allowed = {
  arena: ['home', 'live', 'current-live', 'choose-tournament', 'brackets', 'teams', 'ai-assistant', 'support', 'settings', 'schedule', 'integrity', 'operations', 'standings', 'leaderboard'],
  admin: ['overview', 'users', 'games', 'reports', 'featured', 'bracket-studio', 'battle-royale', 'ai-assistant', 'match-data', 'live-stream', 'integrity', 'match-monitor', 'operations', 'support', 'settings'],
};
export type Workspace = keyof typeof allowed;

export function readHistoryTab(scope: Workspace, hash: string, initial: string): string {
  const [section, tab] = hash.split('?')[0].replace(/^#\//, '').split('/');
  return section === scope && allowed[scope].includes(tab) ? tab : initial;
}

export function workspaceHref(scope: Workspace, tab: string, params?: Record<string, string>) {
  const safe = allowed[scope].includes(tab) ? tab : scope === 'arena' ? 'home' : 'overview';
  const query = new URLSearchParams(params).toString();
  return `#/${scope}/${safe}${query ? `?${query}` : ''}`;
}

export function useWorkspaceRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  const navigate = (scope: Workspace, tab: string, params?: Record<string, string>) => {
    const target = workspaceHref(scope, tab, params);
    if (window.location.hash !== target) window.history.pushState(null, '', target);
    setHash(target);
  };
  return { hash, navigate };
}
