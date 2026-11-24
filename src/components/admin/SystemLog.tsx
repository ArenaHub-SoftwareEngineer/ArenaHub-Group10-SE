import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditLogItem, BracketDraft, ContentReport, User } from '../../lib/types';
import { LOG_CATEGORIES, buildSystemLog, clockTime, groupByDay, relativeTime, type LogCategory, type LogEntry } from '../../lib/adminInsights';
import { PageHeading } from '../ui/PageHeading';
import { Modal } from '../ui/Modal';
import { ArrowUpRight, ChevronLeft, ChevronRight, Download, Flag, GitBranch, Info, Radio, Search, Star, Swords, Users } from '../ui/Icons';
import './adminOverview.css';

const CATEGORY_ICON: Record<LogCategory, typeof Info> = {
  matches: Swords, brackets: GitBranch, broadcast: Radio, accounts: Users, moderation: Flag, content: Star, system: Info,
};
const CATEGORY_LABEL = Object.fromEntries(LOG_CATEGORIES.map(item => [item.id, item.label])) as Record<LogCategory, string>;
const DESTINATION_LABEL: Record<string, string> = { 'bracket-studio': 'Brackets', 'live-stream': 'Broadcast', users: 'Users', reports: 'Reports' };
const PAGE_SIZE = 12;
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

function LogCategoryIcon({ entry }: { entry: LogEntry }) {
  const Icon = CATEGORY_ICON[entry.category];
  return <span className="log-area">
    <span className={`log-area-icon ov-tone is-${entry.tone}`} aria-hidden="true"><Icon size={14} /></span>
    {CATEGORY_LABEL[entry.category]}
  </span>;
}

export function SystemLogView({ auditLogs, users, reports, brackets, onNavigate }: {
  auditLogs: AuditLogItem[]; users: User[]; reports: ContentReport[]; brackets: BracketDraft[]; onNavigate: (tab: string) => void;
}) {
  const now = useNow();
  const [category, setCategory] = useState<LogCategory | 'all'>('all');
  const [date, setDate] = useState('');
  const [attention, setAttention] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const results = useRef<HTMLHeadingElement>(null);
  const all = useMemo(() => buildSystemLog({ auditLogs, users, reports, brackets }), [auditLogs, users, reports, brackets]);
  const dates = useMemo(() => groupByDay(all, now), [all, now]);
  const activeDate = dates.find(group => group.key === date);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (activeDate?.entries ?? all).filter(entry => {
    if ((category !== 'all' && entry.category !== category) || (attention && !ATTENTION_TONES.has(entry.tone))) return false;
    const searchable = `${entry.actor} ${entry.text} ${CATEGORY_LABEL[entry.category]}`.toLowerCase();
    return words.every(word => searchable.includes(word));
  });
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const groups = groupByDay(shown.slice(offset, offset + PAGE_SIZE), now);
  const filtered = Boolean(query || category !== 'all' || activeDate || attention);
  const destination = selected?.tab;

  function clearFilters() {
    setQuery('');
    setCategory('all');
    setDate('');
    setAttention(false);
    setPage(1);
  }

  function changePage(next: number) {
    setPage(next);
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView({ block: 'nearest' });
  }

  function download() {
    const rows = [['Time (Manila)', 'Category', 'Who', 'What'], ...shown.map(entry => [
      entry.at ? timestamp(entry.at) : '', CATEGORY_LABEL[entry.category], entry.actor, entry.text,
    ])];
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'arenahub-system-log.csv' });
    link.click();
    URL.revokeObjectURL(url);
  }

  return <div className="ov-page log-workspace">
    <PageHeading title="System log" description="Staff actions, sign-ups, and reports · Manila time"
      actions={<button type="button" className="arena-outline" disabled={!shown.length} onClick={download}><Download size={16} /> Download CSV</button>} />

    <section className="page-panel log-panel" aria-labelledby="log-activity-heading">
      <div className="log-filters" role="group" aria-label="Filter activity">
        <label className="page-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search the log" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search activity" />
        </label>
        <button type="button" className="log-attention" title="Show warnings, removals, and live changes" aria-pressed={attention}
          onClick={() => { setAttention(!attention); setPage(1); }}>
          <Flag size={15} aria-hidden="true" /> Key events
        </button>
        <select aria-label="Category" value={category} onChange={event => { setCategory(event.target.value as LogCategory | 'all'); setPage(1); }}>
          <option value="all">All categories</option>
          {LOG_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <select aria-label="Date" value={activeDate?.key || ''} onChange={event => { setDate(event.target.value); setPage(1); }}>
          <option value="">All dates</option>
          {dates.map(day => <option key={day.key} value={day.key}>{day.label}</option>)}
        </select>
      </div>

      <header className="log-results">
        <h2 id="log-activity-heading" ref={results} tabIndex={-1}>Activity</h2>
        <span role="status">{shown.length} {shown.length === 1 ? 'entry' : 'entries'}</span>
        {filtered && <button type="button" className="arena-text-button" onClick={clearFilters}>Clear filters</button>}
      </header>

      {groups.length ? groups.map(group => <section className="log-day" key={group.key} aria-label={group.label}>
        <h3>{group.label}</h3>
        <ol>
          {group.entries.map(entry => <li key={entry.id}>
            <button type="button" className="log-entry" aria-haspopup="dialog" onClick={() => setSelected(entry)}>
              {entry.at ? <time dateTime={new Date(entry.at).toISOString()} className="log-time">{clockTime(entry.at)}</time> : <span className="log-time">—</span>}
              <LogCategoryIcon entry={entry} />
              <span className="log-summary"><strong>{entry.actor}</strong> <span aria-hidden="true">·</span> {entry.text}</span>
              <ChevronRight size={16} className="log-entry-arrow" aria-hidden="true" />
            </button>
          </li>)}
        </ol>
      </section>) : <p className="log-empty">{all.length ? 'No entries match these filters.' : 'No activity has been recorded yet.'}</p>}

      {pageCount > 1 && <nav className="log-pagination" aria-label="Activity pages">
        <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, shown.length)} of {shown.length}</span>
        <div>
          <button type="button" className="arena-outline arena-sm" aria-label="Previous page" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <span role="status">Page {currentPage} of {pageCount}</span>
          <button type="button" className="arena-outline arena-sm" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </nav>}
    </section>

    <Modal open={Boolean(selected)} title="Log entry" onClose={() => setSelected(null)}>
      {selected && <div className="log-detail">
        <LogCategoryIcon entry={selected} />
        <p>{selected.text}</p>
        <dl>
          <div><dt>Actor</dt><dd>{selected.actor}</dd></div>
          <div><dt>Time in Manila</dt><dd>{selected.at ? <time dateTime={new Date(selected.at).toISOString()}>{timestamp(selected.at)}</time> : 'Unavailable'}</dd></div>
        </dl>
        {destination && <button type="button" className="arena-outline" onClick={() => { setSelected(null); onNavigate(destination); }}>
          Open {DESTINATION_LABEL[destination]} <ArrowUpRight size={15} aria-hidden="true" />
        </button>}
      </div>}
    </Modal>
  </div>;
}
