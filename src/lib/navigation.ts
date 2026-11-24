import { useEffect, useState } from 'react';

const allowed = {
  arena: ['home', 'live', 'current-live', 'choose-tournament', 'brackets', 'teams', 'ai-assistant', 'support', 'settings', 'schedule', 'integrity', 'operations', 'standings'],
  admin: ['overview', 'users', 'games', 'reports', 'logs', 'schedule', 'bracket-studio', 'ai-assistant', 'live-stream', 'match-monitor', 'operations', 'support', 'settings'],
};
export type Workspace = keyof typeof allowed;

function resolveTab(scope: Workspace, tab: string) {
  return scope === 'admin' && tab === 'integrity' ? 'reports' : tab;
}

function canonicalHash(hash: string) {
  const [path, query] = hash.split('?');
  const oldCaseLink = path === '#/admin/match-monitor' && new URLSearchParams(query).has('case');
  return path === '#/admin/integrity' || oldCaseLink ? hash.replace(path, '#/admin/reports') : hash;
}

export function readHistoryTab(scope: Workspace, hash: string, initial: string): string {
  const [section, tab] = canonicalHash(hash).split('?')[0].replace(/^#\//, '').split('/');
  const resolved = resolveTab(scope, tab);
  return section === scope && allowed[scope].includes(resolved) ? resolved : initial;
}

export function workspaceHref(scope: Workspace, tab: string, params?: Record<string, string>) {
  const resolved = resolveTab(scope, tab);
  const safe = allowed[scope].includes(resolved) ? resolved : scope === 'arena' ? 'home' : 'overview';
  const query = new URLSearchParams(params).toString();
  return `#/${scope}/${safe}${query ? `?${query}` : ''}`;
}

export function useWorkspaceRoute() {
  const [hash, setHash] = useState(() => canonicalHash(window.location.hash));
  useEffect(() => {
    const sync = () => {
      const current = window.location.hash;
      const target = canonicalHash(current);
      if (target !== current) window.history.replaceState(window.history.state, '', target);
      setHash(target);
    };
    sync();
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
