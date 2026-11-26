import React, { useEffect, useMemo, useState } from 'react';
import type { AuditLogItem, BracketDraft, ContentReport, User } from '../../lib/types';
import { LOG_CATEGORIES, buildSystemLog, clockTime, groupByDay, relativeTime, type LogCategory, type LogEntry } from '../../lib/adminInsights';
import { activityBuckets, collapseBursts, useMutedCategories, type ActivityRange, type FeedItem } from '../../lib/logFeed';
import { Modal } from '../ui/Modal';
import { ActivitySkyline, CATEGORY_TONE } from '../three/ActivitySkyline';
import { ArrowUpRight, BellOff, Bell, ChevronDown, ChevronRight, Download, Flag, GitBranch, Info, Pause, Play, Radio, Search, Star, Swords, Users, X } from '../ui/Icons';
import './adminOverview.css';
import './adminPoster.css';

const CATEGORY_ICON: Record<LogCategory, typeof Info> = {
  matches: Swords, brackets: GitBranch, broadcast: Radio, accounts: Users, moderation: Flag, content: Star, system: Info,
};
const CATEGORY_LABEL = Object.fromEntries(LOG_CATEGORIES.map(item => [item.id, item.label])) as Record<LogCategory, string>;
const DESTINATION_LABEL: Record<string, string> = { 'bracket-studio': 'Brackets', 'live-stream': 'Broadcast', users: 'Users', reports: 'Reports' };
const PAGE_SIZE = 30;
const ATTENTION_TONES = new Set(['danger', 'warning', 'live']);
const timestamp = (at: number) => new Date(at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });

/** Re-renders every minute so "5 min ago" stays true. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), intervalMs); return () => window.clearInterval(id); }, [intervalMs]);
  return now;
}

export function LogList({ entries, now, onNavigate, compact = false }: {
  entries: LogEntry[]; now: number; onNavigate?: (tab: string) => void; compact?: boolean;
}) {
  return <ol className={`ov-log${compact ? ' is-compact' : ''}`}>
    {entries.map(entry => {
      const Icon = CATEGORY_ICON[entry.category];
      const body = <>
        <span className={`ov-log-icon ov-tone is-${entry.tone}`} aria-hidden="true"><Icon size={15} /></span>
        <span className="ov-log-text">
          <span><strong>{entry.actor}</strong> {entry.text}</span>
          <small>{CATEGORY_LABEL[entry.category]}{entry.at ? <> · <time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}>{compact ? relativeTime(entry.at, now) : `${clockTime(entry.at)} · ${relativeTime(entry.at, now)}`}</time></> : null}</small>
        </span>
        {entry.tab && onNavigate && <ChevronRight size={15} aria-hidden="true" className="ov-log-go" />}
      </>;
      return <li key={entry.id}>
        {entry.tab && onNavigate
          ? <button type="button" className="ov-log-row" onClick={() => onNavigate(entry.tab!)}>{body}</button>
          : <div className="ov-log-row">{body}</div>}
      </li>;
    })}
  </ol>;
}

function csvCell(value: string) { return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value; }

function CategoryBadge({ category }: { category: LogCategory }) {
  const Icon = CATEGORY_ICON[category];
  return <span className={`adp-cat is-${CATEGORY_TONE[category]}`} title={CATEGORY_LABEL[category]}><Icon size={14} aria-hidden="true" /><span>{CATEGORY_LABEL[category]}</span></span>;
}

function Row({ entry, onOpen }: { entry: LogEntry; onOpen: (entry: LogEntry) => void }) {
  return <button type="button" className={`adp-log-row${ATTENTION_TONES.has(entry.tone) ? ` is-${entry.tone}` : ''}`} aria-haspopup="dialog" onClick={() => onOpen(entry)}>
    {entry.at ? <time dateTime={new Date(entry.at).toISOString()} className="adp-log-time">{clockTime(entry.at)}</time> : <span className="adp-log-time">—</span>}
    <CategoryBadge category={entry.category} />
    <span className="adp-log-text"><strong>{entry.actor}</strong> {entry.text}</span>
    <ChevronRight size={16} className="adp-log-go" aria-hidden="true" />
  </button>;
}

function Burst({ item, onOpen }: { item: Extract<FeedItem, { kind: 'burst' }>; onOpen: (entry: LogEntry) => void }) {
  const [open, setOpen] = useState(false);
  const first = item.entries[item.entries.length - 1], last = item.entries[0];
  return <>
    <button type="button" className="adp-log-row is-burst" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="adp-log-time" title={`${clockTime(first.at)} to ${clockTime(last.at)}`}>{clockTime(last.at)}</span>
      <CategoryBadge category={item.category} />
      <span className="adp-log-text"><strong>{item.label}</strong> <span className="adp-burst-names">{item.entries.slice(0, 3).map(entry => entry.actor).join(', ')}{item.entries.length > 3 ? '…' : ''}</span></span>
      <ChevronDown size={16} className="adp-log-go" aria-hidden="true" />
    </button>
    {open && <ol className="adp-burst-list">{item.entries.map(entry => <li key={entry.id}><Row entry={entry} onOpen={onOpen} /></li>)}</ol>}
  </>;
}

export function SystemLogView({ auditLogs, users, reports, brackets, onNavigate }: {
  auditLogs: AuditLogItem[]; users: User[]; reports: ContentReport[]; brackets: BracketDraft[]; onNavigate: (tab: string) => void;
}) {
  const now = useNow();
  const [muted, setMuted] = useMutedCategories();
  const [category, setCategory] = useState<LogCategory | 'all'>('all');
  const [range, setRange] = useState<ActivityRange>('day');
  const [slot, setSlot] = useState<string | null>(null);
  const [attention, setAttention] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);

  const all = useMemo(() => buildSystemLog({ auditLogs, users, reports, brackets }), [auditLogs, users, reports, brackets]);
  // Paused: the feed holds still; anything newer waits behind the "new" button.
  const live = useMemo(() => all.filter(entry => !muted.includes(entry.category)), [all, muted]);
  const visible = pausedAt === null ? live : live.filter(entry => (entry.at ?? 0) <= pausedAt);
  const waiting = live.length - visible.length;
  const buckets = useMemo(() => activityBuckets(visible, now, range), [visible, now, range]);
  const window_ = buckets.find(bucket => bucket.key === slot);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = visible.filter(entry => {
    if (category !== 'all' && entry.category !== category) return false;
    if (attention && !ATTENTION_TONES.has(entry.tone)) return false;
    if (window_ && !(entry.at && entry.at >= window_.start && entry.at < window_.end)) return false;
    const searchable = `${entry.actor} ${entry.text} ${CATEGORY_LABEL[entry.category]}`.toLowerCase();
    return words.every(word => searchable.includes(word));
  });
  const counts = useMemo(() => Object.fromEntries(LOG_CATEGORIES.map(item => [item.id, visible.filter(entry => entry.category === item.id).length])) as Record<LogCategory, number>, [visible]);
  const groups = groupByDay(shown.slice(0, limit), now);
  const filtered = Boolean(query || category !== 'all' || window_ || attention);
  const today = visible.filter(entry => entry.at && now - entry.at < 86_400_000).length;

  function clearFilters() { setQuery(''); setCategory('all'); setSlot(null); setAttention(false); setLimit(PAGE_SIZE); }

  function download() {
    const rows = [['Time (Manila)', 'Category', 'Who', 'What'], ...shown.map(entry => [
      entry.at ? timestamp(entry.at) : '', CATEGORY_LABEL[entry.category], entry.actor, entry.text,
    ])];
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'arenahub-system-log.csv' });
    link.click();
    URL.revokeObjectURL(url);
  }

  const toggleMute = (id: LogCategory) => {
    setMuted(muted.includes(id) ? muted.filter(item => item !== id) : [...muted, id]);
    if (category === id) setCategory('all');
  };

  return <div className="adp">
    <header className="adp-head">
      <span className="adp-giant" aria-hidden="true">Activity</span>
      <div className="adp-title">
        <h2><span className="adp-count">{today}</span> <span className="is-thin">events</span> today</h2>
        <p>System log · Manila time</p>
      </div>
      <div className="adp-head-actions">
        <button type="button" className={`arena-outline${pausedAt !== null ? ' is-paused' : ''}`} aria-pressed={pausedAt !== null}
          onClick={() => setPausedAt(pausedAt === null ? Date.now() : null)}>
          {pausedAt === null ? <><Pause size={16} aria-hidden="true" /> Pause</> : <><Play size={16} aria-hidden="true" /> Resume</>}
        </button>
        <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setMuteOpen(true)}>
          <BellOff size={16} aria-hidden="true" /> Mute{muted.length ? <span className="ah-chip-count">{muted.length}</span> : null}
        </button>
        <button type="button" className="arena-outline" disabled={!shown.length} onClick={download} aria-label="Download CSV" title="Download CSV"><Download size={16} aria-hidden="true" /></button>
      </div>
    </header>

    {waiting > 0 && <button type="button" className="adp-waiting" onClick={() => setPausedAt(null)}>
      <Play size={14} aria-hidden="true" /> {waiting} new · show
    </button>}

    <section className="adp-sky-card" aria-label="Activity chart">
      <div className="adp-sky-head">
        <div className="ah-chips" role="group" aria-label="Chart range">
          <button type="button" className="ah-chip" aria-pressed={range === 'day'} onClick={() => { setRange('day'); setSlot(null); }}>24 h</button>
          <button type="button" className="ah-chip" aria-pressed={range === 'week'} onClick={() => { setRange('week'); setSlot(null); }}>7 days</button>
        </div>
        {window_ && <button type="button" className="ah-chip" aria-pressed="true" onClick={() => setSlot(null)}>{window_.label} <X size={13} aria-label="clear time" /></button>}
      </div>
      <ActivitySkyline buckets={buckets} selected={slot} onSelect={setSlot} />
    </section>

    <nav className="adp-cats" aria-label="Filter by category">
      <button type="button" className="adp-cat-chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}><span>All</span><b>{visible.length}</b></button>
      {LOG_CATEGORIES.filter(item => !muted.includes(item.id) && counts[item.id]).map(item => {
        const Icon = CATEGORY_ICON[item.id];
        return <button key={item.id} type="button" className={`adp-cat-chip is-${CATEGORY_TONE[item.id]}`} aria-pressed={category === item.id}
          onClick={() => setCategory(category === item.id ? 'all' : item.id)}>
          <Icon size={15} aria-hidden="true" /><span>{item.label}</span><b>{counts[item.id]}</b>
        </button>;
      })}
      {muted.length > 0 && <button type="button" className="adp-cat-chip is-muted" onClick={() => setMuteOpen(true)}><BellOff size={15} aria-hidden="true" /><span>{muted.length} muted</span></button>}
    </nav>

    <div className="adp-toolbar">
      <label className="page-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label="Search the log" value={query} onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} placeholder="Search" />
      </label>
      <button type="button" className="ah-chip" title="Warnings, removals and live changes only" aria-pressed={attention} onClick={() => setAttention(!attention)}>
        <Flag size={14} aria-hidden="true" /> Key events
      </button>
      <span className="adp-results" role="status">{shown.length} {shown.length === 1 ? 'entry' : 'entries'}</span>
      {filtered && <button type="button" className="arena-text-button" onClick={clearFilters}>Clear</button>}
    </div>

    <section className="adp-feed" aria-label="Activity">
      {groups.length ? groups.map(group => <section className="adp-day" key={group.key} aria-label={group.label}>
        <h3>{group.label}</h3>
        <ol>
          {collapseBursts(group.entries).map(item => <li key={item.kind === 'entry' ? item.entry.id : item.id}>
            {item.kind === 'entry' ? <Row entry={item.entry} onOpen={setSelected} /> : <Burst item={item} onOpen={setSelected} />}
          </li>)}
        </ol>
      </section>) : <p className="adp-empty">{all.length ? 'Nothing matches.' : 'No activity yet.'}</p>}
      {shown.length > limit && <button type="button" className="arena-outline adp-more" onClick={() => setLimit(limit + PAGE_SIZE)}>
        Show more <span className="ah-chip-count">{shown.length - limit}</span>
      </button>}
    </section>

    <Modal open={muteOpen} title="Mute activity" description="Muted categories are hidden from the log and Overview on this browser." onClose={() => setMuteOpen(false)}>
      <ul className="adp-mute-list">
        {LOG_CATEGORIES.map(item => {
          const Icon = CATEGORY_ICON[item.id];
          const off = muted.includes(item.id);
          return <li key={item.id}>
            <label className={`adp-mute${off ? ' is-off' : ''}`}>
              <span className={`adp-cat is-${CATEGORY_TONE[item.id]}`}><Icon size={16} aria-hidden="true" /></span>
              <span className="adp-mute-name">{item.label}<small>{all.filter(entry => entry.category === item.id).length} entries</small></span>
              {off ? <BellOff size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}
              <input type="checkbox" role="switch" className="adp-switch" checked={!off} onChange={() => toggleMute(item.id)} aria-label={`Show ${item.label}`} />
            </label>
          </li>;
        })}
      </ul>
      <div className="feature-dialog-actions">
        {muted.length > 0 && <button type="button" className="arena-outline" onClick={() => setMuted([])}>Unmute all</button>}
        <button type="button" className="arena-primary" onClick={() => setMuteOpen(false)}>Done</button>
      </div>
    </Modal>

    <Modal open={Boolean(selected)} title="Log entry" onClose={() => setSelected(null)}>
      {selected && <div className="log-detail">
        <CategoryBadge category={selected.category} />
        <p><strong>{selected.actor}</strong> {selected.text}</p>
        <dl>
          <div><dt>Time in Manila</dt><dd>{selected.at ? <time dateTime={new Date(selected.at).toISOString()}>{timestamp(selected.at)}</time> : 'Unavailable'}</dd></div>
        </dl>
        <div className="feature-dialog-actions">
          {!muted.includes(selected.category) && <button type="button" className="arena-outline" onClick={() => { toggleMute(selected.category); setSelected(null); }}>
            <BellOff size={15} aria-hidden="true" /> Mute {CATEGORY_LABEL[selected.category]}
          </button>}
          {selected.tab && <button type="button" className="arena-primary" onClick={() => { const tab = selected.tab!; setSelected(null); onNavigate(tab); }}>
            Open {DESTINATION_LABEL[selected.tab] || 'page'} <ArrowUpRight size={15} aria-hidden="true" />
          </button>}
        </div>
      </div>}
    </Modal>
  </div>;
}
