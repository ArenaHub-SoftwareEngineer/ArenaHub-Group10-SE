import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { workspaceHref, type Workspace } from '../../lib/navigation';
import { Brand } from './Brand';
import { Menu, Radio, Search, X } from './Icons';

export interface ShellItem {
  id: string;
  label: string;
  short?: string;
  icon: LucideIcon | React.ComponentType<{ className?: string; size?: number }>;
  badge?: { kind: 'count'; value: number } | { kind: 'live' };
  keywords?: string;
}
export interface ShellGroup { label: string; items: ShellItem[] }
export interface ShellLive {
  id: string;
  title: string;
  subtitle: string;
  image?: string;
  score?: string;
  broadcasting?: boolean;
  onOpen: () => void;
}

interface AppShellProps {
  workspace: Workspace;
  context?: string;
  contextLogo?: string;
  groups: ShellGroup[];
  isActive: (id: string) => boolean;
  onNavigate: (id: string) => void;
  mobileTabs: string[];
  actions: React.ReactNode;
  pageKey: string;
  routeKey: string;
  pageTitle: string;
  fullBleed?: boolean;
  navLabel: string;
  live?: ShellLive[];
  children: React.ReactNode;
}

const RAIL_KEY = 'arenahub.rail';
const PHONE_QUERY = '(max-width: 767px)';
const readRail = () => { try { return localStorage.getItem(RAIL_KEY); } catch { return null; } };
const saveRail = (value: 'open' | 'closed') => { try { localStorage.setItem(RAIL_KEY, value); } catch { /* private mode */ } };

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatch(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return match;
}

function Badge({ badge }: { badge?: ShellItem['badge'] }) {
  if (badge?.kind === 'count' && badge.value > 0) {
    return <span className="shell-badge-count" aria-label={`${badge.value} open`}>{badge.value > 99 ? '99+' : badge.value}</span>;
  }
  if (badge?.kind === 'live') return <span className="shell-badge-live" aria-label="Live"><i /></span>;
  return null;
}

function ShellSearch({ items, onNavigate, mobile = false, reduced }: {
  items: ShellItem[]; onNavigate: (id: string) => void; mobile?: boolean; reduced: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(mobile);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const resultsPanel = useRef<HTMLDivElement>(null);
  const listId = useId();
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return items.slice(0, 8);
    const rank = (item: ShellItem) => {
      const label = item.label.toLowerCase();
      if (label.startsWith(q)) return 0;
      if (label.includes(q)) return 1;
      return q.split(/\s+/).every(word => `${label} ${item.short || ''} ${item.keywords || ''}`.toLowerCase().includes(word)) ? 2 : 3;
    };
    return items.map(item => ({ item, rank: rank(item) }))
      .filter(result => result.rank < 3)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 8)
      .map(result => result.item);
  }, [items, q]);
  useEffect(() => {
    if (mobile) return;
    const onKey = (event: KeyboardEvent) => {
      if (window.matchMedia(PHONE_QUERY).matches || document.querySelector('dialog[open], :popover-open')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const shortcut = event.key === '/' && !target?.closest('input, textarea, select, [contenteditable=true]');
      if (event.defaultPrevented || event.isComposing || !shortcut || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      input.current?.focus();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobile]);

  const active = open ? results[Math.min(index, results.length - 1)] : undefined;
  const optionId = (item: ShellItem) => `${listId}-${item.id}`;
  useEffect(() => {
    const panel = resultsPanel.current;
    const option = panel?.querySelector('[aria-selected=true]');
    if (!open || !panel || !option) return;
    const panelBounds = panel.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.bottom > panelBounds.bottom) panel.scrollTop += optionBounds.bottom - panelBounds.bottom;
    if (optionBounds.top < panelBounds.top) panel.scrollTop += optionBounds.top - panelBounds.top;
  }, [active?.id, open]);
  const go = (item?: ShellItem) => {
    if (!item) return;
    setQuery('');
    setIndex(0);
    setOpen(false);
    onNavigate(item.id);
  };

  return <div className="shell-search" onBlur={event => {
    if (!mobile && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Search className="shell-search-icon" size={18} aria-hidden="true" />
    <input ref={input} type="search" value={query} placeholder="Find a page…" aria-label="Search pages" role="combobox"
      aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={active ? optionId(active) : undefined}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); setIndex(0); setOpen(true); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setIndex(i => Math.max(0, Math.min(results.length - 1, open ? i + step : 0)));
        } else if (event.key === 'Enter' && active) {
          event.preventDefault();
          go(active);
        } else if (event.key === 'Escape' && !mobile && open) {
          event.preventDefault();
          setOpen(false);
        }
      }} />
    {!mobile && <kbd className="shell-search-key" aria-hidden="true">/</kbd>}
    <motion.div ref={resultsPanel} className="shell-search-results" hidden={!open}
      animate={{ opacity: open ? 1 : 0 }} transition={{ duration: reduced ? 0 : .12 }}>
      <ul id={listId} role="listbox" aria-label="Pages">
        {results.map(item => {
          const Icon = item.icon;
          return <li key={item.id} id={optionId(item)} role="option" aria-selected={active?.id === item.id}
            onMouseDown={event => event.preventDefault()} onClick={() => go(item)}>
            <Icon className="w-4 h-4" aria-hidden="true" /><span>{item.label}</span><Badge badge={item.badge} />
          </li>;
        })}
      </ul>
      {open && !results.length && <p className="shell-search-hint" role="status">No pages found. Try a different search.</p>}
    </motion.div>
  </div>;
}

function NavigationLink({ href, onNavigate, children, ...props }: React.ComponentPropsWithoutRef<'a'> & { onNavigate: () => void }) {
  return <a href={href} {...props} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate();
  }}>{children}</a>;
}

export function AppShell({
  workspace, context, contextLogo, groups, isActive, onNavigate, mobileTabs, actions, pageKey, routeKey, pageTitle,
  fullBleed = false, navLabel, live = [], children,
}: AppShellProps) {
  const reduced = Boolean(useReducedMotion() || document.documentElement.dataset.motion === 'reduced');
  const phone = useMedia(PHONE_QUERY);
  const wide = useMedia('(min-width: 1200px)');
  const [railPref, setRailPref] = useState(readRail);
  const [mobileSearch, setMobileSearch] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const searchDialog = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);
  const previousRoute = useRef(routeKey);
  const navId = useId();
  const drawerId = useId();
  const searchId = useId();
  const contentId = useId();
  const collapsed = railPref ? railPref === 'closed' : !wide;
  const items = groups.flatMap(group => group.items);
  const activeItem = items.find(item => isActive(item.id));
  const moreActive = !mobileTabs.some(isActive);
  const initial = items[0].id;

  useEffect(() => {
    document.title = `${pageTitle} · ArenaHub`;
    return () => { document.title = 'ArenaHub — School Esports Platform'; };
  }, [pageTitle]);

  useEffect(() => {
    if (previousRoute.current === routeKey) return;
    previousRoute.current = routeKey;
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [routeKey]);

  useEffect(() => {
    if (phone) return;
    drawer.current?.close();
    searchDialog.current?.close();
  }, [phone]);

  useEffect(() => {
    if (!mobileSearch) return;
    const dialog = searchDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector('input')?.focus();
  }, [mobileSearch]);

  const go = (id: string) => {
    drawer.current?.close();
    searchDialog.current?.close();
    onNavigate(id);
    main.current?.focus({ preventScroll: true });
  };
  const toggleRail = () => {
    const next = collapsed ? 'open' : 'closed';
    setRailPref(next);
    saveRail(next);
  };
  const markerTransition = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 40 };
  const navList = (mode: 'rail' | 'drawer') => groups.map(group => <div key={group.label} className="shell-group">
    {(mode === 'drawer' || !collapsed) && <p className="shell-group-label">{group.label}</p>}
    {group.items.map(item => {
      const active = isActive(item.id), Icon = item.icon, mini = mode === 'rail' && collapsed;
      return <NavigationLink key={item.id} href={workspaceHref(workspace, item.id)} data-tab={item.id} aria-current={active ? 'page' : undefined}
        className={`shell-item${active ? ' is-active' : ''}${mini ? ' is-mini' : ''}`} onNavigate={() => go(item.id)}
        aria-label={mini ? item.label : undefined} title={mini ? item.label : undefined}>
        {active && <motion.span layoutId={`shell-active-${mode}`} className="shell-item-marker" transition={markerTransition} />}
        <Icon className="shell-item-icon" aria-hidden="true" />
        <span className="shell-item-label">{mini ? item.short || item.label : item.label}</span>
        {mini ? <span className="shell-item-dot"><Badge badge={item.badge} /></span> : <Badge badge={item.badge} />}
      </NavigationLink>;
    })}
  </div>);

  const liveList = (mode: 'rail' | 'drawer') => live.length > 0 && <div className="shell-group shell-live">
    <p className="shell-group-label shell-live-label">{mode === 'rail' && collapsed ? 'Live' : 'Live matches'}</p>
    {live.slice(0, 6).map(item => {
      const mini = mode === 'rail' && collapsed;
      return <button key={item.id} type="button" className={`shell-live-item${mini ? ' is-mini' : ''}`}
        onClick={() => { drawer.current?.close(); item.onOpen(); main.current?.focus({ preventScroll: true }); }}
        aria-label={mini ? `${item.title}, ${item.subtitle}${item.score ? `, ${item.score}` : ''}${item.broadcasting ? ', on air' : ''}` : undefined}
        title={mini ? item.title : undefined}>
        <span className="shell-live-avatar">{item.image ? <img src={item.image} alt="" /> : <Radio size={16} aria-hidden="true" />}</span>
        {!mini && <span className="shell-live-text"><strong>{item.title}</strong><small>{item.subtitle}</small></span>}
        {!mini && <span className="shell-live-meta">{item.broadcasting && <i aria-label="On air" role="img" />}{item.score}</span>}
      </button>;
    })}
  </div>;

  return <div className={`app-shell shell${collapsed ? ' shell-collapsed' : ''}`}>
    <a className="shell-skip" href={`#${contentId}`} onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to content</a>
    <header className="shell-topbar">
      <div className="shell-topbar-start">
        <button type="button" className="shell-icon-button shell-rail-toggle" onClick={toggleRail} aria-controls={navId}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed}>
          <Menu size={20} aria-hidden="true" />
        </button>
        <NavigationLink className="shell-brand" href={workspaceHref(workspace, initial)} onNavigate={() => go(initial)} aria-label={workspace === 'admin' ? 'Admin overview' : 'ArenaHub home'}>
          <Brand compact context={context} />
        </NavigationLink>
        {context && <span className="shell-context">{contextLogo && <img src={contextLogo} alt="" width="16" height="16" />}{context}</span>}
      </div>
      <div className="shell-topbar-center"><ShellSearch items={items} onNavigate={go} reduced={reduced} key={pageKey} /></div>
      <div className="shell-topbar-end">
        <button type="button" className="shell-icon-button shell-search-trigger" aria-label="Search pages" aria-haspopup="dialog"
          aria-controls={searchId} onClick={() => setMobileSearch(true)}><Search size={20} aria-hidden="true" /></button>
        {actions}
      </div>
    </header>

    <div className="shell-body">
      <aside className="shell-rail" id={navId}>
        <nav className="shell-nav" aria-label={navLabel}>{navList('rail')}{liveList('rail')}</nav>
      </aside>

      <main ref={main} id={contentId} tabIndex={-1} aria-label={pageTitle} className={`shell-main${fullBleed ? ' is-full' : ''}`}>
        <motion.div key={pageKey} className="shell-page" initial={reduced ? false : { opacity: .8, y: 5 }}
          animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .2, ease: [.2, 0, 0, 1] }}>
          {children}
        </motion.div>
      </main>
    </div>

    <dialog ref={drawer} id={drawerId} className="shell-drawer" aria-label={navLabel}
      onClick={event => { if (event.target === event.currentTarget) drawer.current?.close(); }}>
      <div className="shell-drawer-content">
        <div className="shell-drawer-head">
          <strong>{navLabel}</strong>
          <button type="button" className="shell-icon-button" aria-label="Close navigation" onClick={() => drawer.current?.close()}><X size={20} aria-hidden="true" /></button>
        </div>
        <nav className="shell-nav" aria-label={navLabel}>{navList('drawer')}{liveList('drawer')}</nav>
      </div>
    </dialog>

    <dialog ref={searchDialog} id={searchId} className="shell-mobile-search" aria-label="Find a page"
      onClose={() => setMobileSearch(false)}
      onClick={event => { if (event.target === event.currentTarget) searchDialog.current?.close(); }}>
      {mobileSearch && <div className="shell-mobile-search-content">
        <ShellSearch items={items} onNavigate={go} mobile reduced={reduced} />
        <button type="button" className="shell-icon-button" aria-label="Close search" onClick={() => searchDialog.current?.close()}><X size={20} aria-hidden="true" /></button>
      </div>}
    </dialog>

    <nav className="shell-tabbar" aria-label="Shortcuts">
      {items.filter(item => mobileTabs.includes(item.id)).sort((a, b) => mobileTabs.indexOf(a.id) - mobileTabs.indexOf(b.id)).map(item => {
        const active = isActive(item.id), Icon = item.icon;
        return <NavigationLink key={item.id} href={workspaceHref(workspace, item.id)} aria-current={active ? 'page' : undefined}
          className={`shell-tab${active ? ' is-active' : ''}`} onNavigate={() => go(item.id)}>
          <span className="shell-tab-icon">{active && <motion.span layoutId="shell-tab-pill" className="shell-tab-pill" transition={markerTransition} />}
            <Icon className="w-5 h-5" aria-hidden="true" /><span className="shell-item-dot"><Badge badge={item.badge} /></span>
          </span>
          <span className="shell-tab-label">{item.short || item.label}</span>
        </NavigationLink>;
      })}
      <button type="button" className={`shell-tab${moreActive ? ' is-active' : ''}`} aria-haspopup="dialog" aria-controls={drawerId}
        aria-label={moreActive ? `More pages. Current page: ${activeItem?.label || pageTitle}` : 'More pages'} onClick={() => drawer.current?.showModal()}>
        <span className="shell-tab-icon">{moreActive && <motion.span layoutId="shell-tab-pill" className="shell-tab-pill" transition={markerTransition} />}
          <Menu size={20} aria-hidden="true" />
        </span>
        <span className="shell-tab-label">More</span>
      </button>
    </nav>
  </div>;
}
