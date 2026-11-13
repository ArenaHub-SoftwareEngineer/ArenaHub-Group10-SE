import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { Brand } from './Brand';
import { Menu, Search, X } from './Icons';

/**
 * The signed-in app frame, shared by the admin console and the viewer app. It follows the layout people
 * already know from YouTube and Kaggle: a top bar with search, a left rail that collapses to icons, a
 * drawer and bottom tab bar on phones, and a quiet animated marker on the current page.
 */
export interface ShellItem {
  id: string;
  label: string;
  /** Shorter name for the mini rail and the phone tab bar. */
  short?: string;
  icon: LucideIcon | React.ComponentType<{ className?: string; size?: number }>;
  /** Small trailing marker: a number (open reports), a pulsing live dot, or an AI tag. */
  badge?: { kind: 'count'; value: number } | { kind: 'live' } | { kind: 'ai' };
  /** Extra words that should find this page in search. */
  keywords?: string;
}
export interface ShellGroup { label: string; items: ShellItem[] }

interface AppShellProps {
  context?: string;
  groups: ShellGroup[];
  isActive: (id: string) => boolean;
  onNavigate: (id: string) => void;
  /** Up to five ids for the phone bottom bar. */
  mobileTabs: string[];
  /** Bell, profile and other controls on the right of the top bar. */
  actions: React.ReactNode;
  /** Shown at the bottom of the expanded rail (profile). */
  railFooter?: React.ReactNode;
  /** Key for the page transition; usually the active tab. */
  pageKey: string;
  /** Full-height pages (chat) skip padding and page scroll. */
  fullBleed?: boolean;
  navLabel: string;
  children: React.ReactNode;
}

const RAIL_KEY = 'arenahub.rail';
const readRail = () => { try { return localStorage.getItem(RAIL_KEY); } catch { return null; } };
const saveRail = (value: 'open' | 'closed') => { try { localStorage.setItem(RAIL_KEY, value); } catch { /* private mode */ } };
const useMedia = (query: string) => {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => { const m = window.matchMedia(query); const on = () => setMatch(m.matches); on(); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, [query]);
  return match;
};

function Badge({ badge }: { badge?: ShellItem['badge'] }) {
  if (!badge) return null;
  if (badge.kind === 'count') return badge.value > 0 ? <span className="shell-badge-count" aria-label={`${badge.value} open`}>{badge.value > 99 ? '99+' : badge.value}</span> : null;
  if (badge.kind === 'live') return <span className="shell-badge-live" aria-label="Live"><i /></span>;
  return <span className="shell-badge-ai">AI</span>;
}

/** Search box: finds any page in the app. "/" focuses it, arrows move, Enter opens, Escape closes. */
function ShellSearch({ items, onNavigate, onDone }: { items: ShellItem[]; onNavigate: (id: string) => void; onDone?: () => void }) {
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null), listId = useId();
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    // Page names that start with the query first, then names that contain it, then keyword matches.
    const rank = (i: ShellItem) => { const label = i.label.toLowerCase(); return label.startsWith(q) ? 0 : label.split(/\s+/).some(w => w.startsWith(q)) ? 1 : label.includes(q) ? 2 : (i.keywords || '').toLowerCase().includes(q) ? 3 : 9; };
    return items.map(i => [rank(i), i] as const).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0]).map(([, i]) => i).slice(0, 8);
  }, [items, query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !target.isContentEditable) { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setIndex(0), [query]);
  const go = (item?: ShellItem) => { if (!item) return; onNavigate(item.id); setQuery(''); setOpen(false); input.current?.blur(); onDone?.(); };
  return <div className="shell-search" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <Search className="shell-search-icon" size={18} aria-hidden="true" />
    <input ref={input} type="search" value={query} placeholder="Search ArenaHub" aria-label="Search pages" role="combobox"
      aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && results[index] ? `${listId}-${results[index].id}` : undefined}
      onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(results.length - 1, i + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); go(results[index]); }
        else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); onDone?.(); }
      }} />
    <kbd className="shell-search-key" aria-hidden="true">/</kbd>
    <AnimatePresence>{open && results.length > 0 && <motion.ul id={listId} role="listbox" className="shell-search-results"
      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .14 }}>
      {!query && <li className="shell-search-hint" role="presentation">Jump to</li>}
      {results.map((item, i) => { const Icon = item.icon; return <li key={item.id} id={`${listId}-${item.id}`} role="option" aria-selected={i === index}
        onMouseEnter={() => setIndex(i)} onMouseDown={e => { e.preventDefault(); go(item); }}>
        <Icon className="w-4 h-4" aria-hidden="true" /><span>{item.label}</span><Badge badge={item.badge} />
      </li>; })}
    </motion.ul>}</AnimatePresence>
  </div>;
}

export function AppShell({ context, groups, isActive, onNavigate, mobileTabs, actions, railFooter, pageKey, fullBleed = false, navLabel, children }: AppShellProps) {
  const reduced = useReducedMotion() || (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced');
  const phone = useMedia('(max-width: 767px)'), wide = useMedia('(min-width: 1200px)');
  const [railPref, setRailPref] = useState(readRail);
  const [drawer, setDrawer] = useState(false), [mobileSearch, setMobileSearch] = useState(false);
  const collapsed = railPref ? railPref === 'closed' : !wide;
  const items = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const go = (id: string) => { onNavigate(id); setDrawer(false); };
  const toggle = () => {
    if (phone) { setDrawer(true); return; }
    const next = collapsed ? 'open' : 'closed'; setRailPref(next); saveRail(next);
  };
  useEffect(() => { if (!drawer) return; const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false); window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [drawer]);

  const navList = (mode: 'rail' | 'drawer') => groups.map(group => <div key={group.label} className="shell-group">
    {(mode === 'drawer' || !collapsed) && <p className="shell-group-label">{group.label}</p>}
    {group.items.map(item => {
      const active = isActive(item.id), Icon = item.icon, mini = mode === 'rail' && collapsed;
      return <button key={item.id} type="button" data-tab={item.id} aria-current={active ? 'page' : undefined}
        className={`shell-item${active ? ' is-active' : ''}${mini ? ' is-mini' : ''}`} onClick={() => go(item.id)}
        {...(mini ? { 'data-tip': item.label, 'data-tip-side': 'right', 'aria-label': item.label } : {})}>
        {active && <motion.span layoutId={`shell-active-${mode}`} className="shell-item-marker" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }} />}
        <Icon className="shell-item-icon" aria-hidden="true" />
        <span className="shell-item-label">{mini ? item.short || item.label : item.label}</span>
        {mini ? (item.badge && item.badge.kind !== 'ai' && <span className="shell-item-dot"><Badge badge={item.badge} /></span>) : <Badge badge={item.badge} />}
      </button>;
    })}
  </div>);

  return <div className={`app-shell shell${collapsed ? ' shell-collapsed' : ''}`}>
    <header className="shell-topbar">
      <div className="shell-topbar-start">
        <button type="button" className="shell-icon-button" onClick={toggle} aria-label={phone ? 'Open navigation' : collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={phone ? drawer : !collapsed} data-tip={phone ? undefined : collapsed ? 'Expand menu' : 'Collapse menu'}><Menu size={20} aria-hidden="true" /></button>
        <button type="button" className="shell-brand" onClick={() => go(items[0]?.id)} aria-label="ArenaHub home"><Brand compact context={context} /></button>
        {context && <span className="shell-context">{context}</span>}
      </div>
      <div className="shell-topbar-center"><ShellSearch items={items} onNavigate={go} /></div>
      <div className="shell-topbar-end">
        <button type="button" className="shell-icon-button shell-search-trigger" aria-label="Search pages" onClick={() => setMobileSearch(true)}><Search size={20} aria-hidden="true" /></button>
        {actions}
      </div>
      <AnimatePresence>{mobileSearch && <motion.div className="shell-mobile-search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .12 }}>
        <button type="button" className="shell-icon-button" aria-label="Close search" onClick={() => setMobileSearch(false)}><X size={20} aria-hidden="true" /></button>
        <ShellSearch items={items} onNavigate={go} onDone={() => setMobileSearch(false)} />
      </motion.div>}</AnimatePresence>
    </header>

    <div className="shell-body">
      <aside className="shell-rail" aria-label={navLabel}>
        <nav className="shell-nav">{navList('rail')}</nav>
        {railFooter && !collapsed && <div className="shell-rail-footer">{railFooter}</div>}
      </aside>

      <main className={`shell-main${fullBleed ? ' is-full' : ''}`}>
        <motion.div key={pageKey} className="shell-page" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22, ease: [.2, 0, 0, 1] }}>
          {children}
        </motion.div>
      </main>
    </div>

    <AnimatePresence>{drawer && <motion.div className="shell-drawer-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .16 }} onClick={() => setDrawer(false)}>
      <motion.aside className="shell-drawer" aria-label={navLabel} onClick={e => e.stopPropagation()}
        initial={{ x: reduced ? 0 : -24, opacity: reduced ? 1 : 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: reduced ? 0 : -24, opacity: 0 }} transition={{ duration: .2, ease: [.2, 0, 0, 1] }}>
        <div className="shell-drawer-head"><Brand compact context={context} /><button type="button" className="shell-icon-button" aria-label="Close navigation" onClick={() => setDrawer(false)}><X size={20} aria-hidden="true" /></button></div>
        <nav className="shell-nav">{navList('drawer')}</nav>
        {railFooter && <div className="shell-rail-footer">{railFooter}</div>}
      </motion.aside>
    </motion.div>}</AnimatePresence>

    <nav className="shell-tabbar" aria-label="Shortcuts">
      {mobileTabs.map(id => items.find(i => i.id === id)).filter(Boolean).map(item => {
        const active = isActive(item!.id), Icon = item!.icon;
        return <button key={item!.id} type="button" aria-current={active ? 'page' : undefined} className={`shell-tab${active ? ' is-active' : ''}`} onClick={() => go(item!.id)}>
          <span className="shell-tab-icon">{active && <motion.span layoutId="shell-tab-pill" className="shell-tab-pill" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }} />}<Icon className="w-5 h-5" aria-hidden="true" />{item!.badge && item!.badge.kind !== 'ai' && <span className="shell-item-dot"><Badge badge={item!.badge} /></span>}</span>
          <span className="shell-tab-label">{item!.short || item!.label}</span>
        </button>;
      })}
    </nav>
  </div>;
}
