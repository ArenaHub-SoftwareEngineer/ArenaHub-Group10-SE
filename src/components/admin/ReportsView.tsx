import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ContentReport, Match } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { Ban, Check, ChevronLeft, ChevronRight, Flag, Search, ShieldCheck, Trash2, X } from '../ui/Icons';
import { errorMessage } from '../../lib/errors';
import { relativeTime } from '../../lib/adminInsights';
import { useNow } from './SystemLog';
import { ReportDeck } from '../three/ReportDeck';
import './adminPoster.css';

const FairPlayCenter = lazy(() => import('../common/FairPlayCenter').then(module => ({ default: module.FairPlayCenter })));

interface ReportsViewProps {
  reports: ContentReport[];
  matches: Match[];
  initialCaseId: string | null;
  /** A report to open first, from a notification. */
  initialReportId?: string | null;
}

type Kind = ContentReport['type'];
type Action = 'remove' | 'remove_and_ban' | 'dismiss';

/** Each report type keeps one colour everywhere: the filter, the 3D card, the list dot and the focus panel. */
const KIND: Record<Kind, { tone: 'danger' | 'warning' | 'violet' | 'info'; label: string; hint: string }> = {
  HARASSMENT: { tone: 'danger', label: 'Harassment', hint: 'Insults, threats or targeting a player' },
  'SPAM / SCAM': { tone: 'warning', label: 'Spam', hint: 'Repeated posts, links or scams' },
  'STOLEN CONTENT': { tone: 'violet', label: 'Stolen', hint: 'Clips or art posted without credit' },
  MISINFORMATION: { tone: 'info', label: 'False info', hint: 'False results or schedules' },
};
const KINDS = Object.keys(KIND) as Kind[];
const kindOf = (report: ContentReport) => KIND[report.type] || { tone: 'info' as const, label: report.type, hint: '' };

export const ReportsView: React.FC<ReportsViewProps> = ({ reports, matches, initialCaseId, initialReportId = null }) => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<'open' | 'resolved'>(() => reports.find(report => report.id === initialReportId)?.status === 'resolved' ? 'resolved' : 'open');
  const [type, setType] = useState<Kind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialReportId);
  const [busy, setBusy] = useState<Action | null>(null);
  const [banTarget, setBanTarget] = useState<ContentReport | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(Boolean(initialCaseId));
  const focusRef = useRef<HTMLElement>(null);
  const now = useNow();
  const when = (report: ContentReport) => report.createdAt ? relativeTime(report.createdAt, now) : report.timeAgo;
  useEffect(() => setEvidenceOpen(Boolean(initialCaseId)), [initialCaseId]);
  useEffect(() => { if (initialReportId) setSelectedId(initialReportId); }, [initialReportId]);

  const open = useMemo(() => reports.filter(report => report.status === 'open'), [reports]);
  const needle = search.trim().toLowerCase();
  const shown = useMemo(() => reports.filter(report => report.status === tab && (type === 'all' || report.type === type)
    && (!needle || `${report.postedBy} ${report.contentSnippet}`.toLowerCase().includes(needle))), [reports, tab, type, needle]);
  const selected = shown.find(report => report.id === selectedId) || shown[0] || null;
  const index = selected ? shown.indexOf(selected) : -1;

  const cards = useMemo(() => tab === 'open' ? shown.map(report => ({
    id: report.id, tone: kindOf(report).tone, kind: kindOf(report).label, author: report.postedBy, snippet: report.contentSnippet, flags: report.flagCount,
  })) : [], [shown, tab]);

  const step = (delta: 1 | -1) => {
    if (!shown.length) return;
    setSelectedId(shown[(Math.max(0, index) + delta + shown.length) % shown.length].id);
  };

  async function resolve(report: ContentReport, action: Action) {
    // The next report is picked before this one leaves the list, so review flows straight on.
    const next = shown[index + 1] || shown[index - 1];
    setBusy(action);
    try { await firestoreService.resolveReport(report.id, action); }
    catch (error) { showToast(errorMessage(error, 'The action could not be completed.'), 'error'); setBusy(null); return; }
    setBusy(null);
    setSelectedId(next?.id ?? null);
    showToast(action === 'remove_and_ban' ? `Removed and ${report.postedBy} banned.` : action === 'remove' ? 'Message removed.' : 'Report closed. Message kept.',
      action === 'dismiss' ? 'info' : 'success');
  }

  // Keyboard triage: arrows move, K keeps, R removes, B bans. Ignored while typing or with a dialog open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select, dialog, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      else if (selected?.status === 'open' && !busy) {
        const key = event.key.toLowerCase();
        if (key === 'k') void resolve(selected, 'dismiss');
        else if (key === 'r') void resolve(selected, 'remove');
        else if (key === 'b') setBanTarget(selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pick = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia('(max-width: 900px)').matches) focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const k = selected ? kindOf(selected) : null;

  return (
    <div className="adp">
      <header className="adp-head">
        <span className="adp-giant" aria-hidden="true">Reports</span>
        <div className="adp-title">
          <h2><span className="adp-count">{open.length}</span> <span className="is-thin">to</span> review</h2>
          <p>Chat reports from viewers</p>
        </div>
        <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setEvidenceOpen(true)}><Flag size={16} aria-hidden="true" /> Match evidence</button>
      </header>

      <nav className="adp-kinds" aria-label="Filter by report type">
        {KINDS.map(key => {
          const count = open.filter(report => report.type === key).length;
          return <button key={key} type="button" className={`adp-kind is-${KIND[key].tone}`} aria-pressed={type === key} title={KIND[key].hint}
            onClick={() => { setType(type === key ? 'all' : key); setTab('open'); }}>
            <strong>{count}</strong><span>{KIND[key].label}</span>
          </button>;
        })}
      </nav>

      <section className={`adp-triage${tab === 'open' && !shown.length ? ' is-clear' : ''}`} aria-label="Review">
        <div className="adp-deck">
          <ReportDeck cards={cards} selectedId={selected?.id ?? null} onSelect={pick} onStep={step} />
          {shown.length > 1 && <div className="adp-deck-nav">
            <button type="button" className="adp-round" aria-label="Previous report" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
            <span role="status">{index + 1} / {shown.length}</span>
            <button type="button" className="adp-round" aria-label="Next report" onClick={() => step(1)}><ChevronRight size={18} /></button>
          </div>}
        </div>

        <article ref={focusRef} className={`adp-focus${k ? ` is-${k.tone}` : ''}`} aria-live="polite" aria-label="Selected report">
          {selected && k ? <>
            <div className="adp-focus-top">
              <span className={`adp-tag is-${k.tone}`}>{k.label}</span>
              <span className="adp-meta">{when(selected)}{selected.flagCount > 1 ? ` · ${selected.flagCount} flags` : ''}</span>
            </div>
            <blockquote className="adp-quote">“{selected.contentSnippet}”</blockquote>
            <dl className="adp-who">
              <div><dt>Posted by</dt><dd>{selected.postedBy}</dd></div>
              <div><dt>Flagged by</dt><dd>{selected.reportedBy}</dd></div>
            </dl>
            {selected.status === 'open' ? <div className="adp-actions">
              <button type="button" className="adp-act" disabled={Boolean(busy)} onClick={() => void resolve(selected, 'dismiss')}>
                <Check size={18} aria-hidden="true" /><span>Keep</span><kbd aria-hidden="true">K</kbd>
              </button>
              <button type="button" className="adp-act is-remove" disabled={Boolean(busy)} onClick={() => void resolve(selected, 'remove')}>
                <Trash2 size={18} aria-hidden="true" /><span>Remove</span><kbd aria-hidden="true">R</kbd>
              </button>
              <button type="button" className="adp-act is-ban" disabled={Boolean(busy)} onClick={() => setBanTarget(selected)}>
                <Ban size={18} aria-hidden="true" /><span>Ban</span><kbd aria-hidden="true">B</kbd>
              </button>
            </div> : <p className="adp-resolved"><ShieldCheck size={18} aria-hidden="true" /> Resolved</p>}
          </> : <div className="adp-clear">
            <ShieldCheck size={30} aria-hidden="true" />
            <strong>{tab === 'open' && !needle && type === 'all' ? 'All clear' : 'Nothing here'}</strong>
            <span>{tab === 'open' && !needle && type === 'all' ? 'No reports waiting.' : 'No reports match.'}</span>
          </div>}
        </article>
      </section>

      <div className="adp-toolbar">
        <div className="ah-chips" role="group" aria-label="Show open or resolved reports">
          <button type="button" className="ah-chip" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>Open <span className="ah-chip-count">{open.length}</span></button>
          <button type="button" className="ah-chip" aria-pressed={tab === 'resolved'} onClick={() => setTab('resolved')}>Resolved <span className="ah-chip-count">{reports.length - open.length}</span></button>
          {type !== 'all' && <button type="button" className="ah-chip" aria-pressed="true" onClick={() => setType('all')}>{KIND[type].label} <X size={13} aria-label="clear" /></button>}
        </div>
        <label className="page-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search reports" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" />
        </label>
      </div>

      {shown.length > 0 && <ol className="adp-queue" aria-label={tab === 'open' ? 'Reports that need review' : 'Resolved reports'}>
        {shown.map(report => {
          const item = kindOf(report);
          return <li key={report.id}>
            <button type="button" className={`adp-row is-${item.tone}`} aria-current={report.id === selected?.id || undefined} onClick={() => pick(report.id)}>
              <span className="adp-dot" aria-hidden="true" />
              <span className="adp-row-kind">{item.label}</span>
              <span className="adp-row-text"><strong>{report.postedBy}</strong> {report.contentSnippet}</span>
              <span className="adp-row-time">{report.flagCount > 1 && <b>{report.flagCount}x</b>}{when(report)}</span>
            </button>
          </li>;
        })}
      </ol>}

      <p className="adp-keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> move · <kbd>K</kbd> keep · <kbd>R</kbd> remove · <kbd>B</kbd> ban</p>

      <Modal open={evidenceOpen} title="Match reports and appeals" onClose={() => setEvidenceOpen(false)} className="feature-dialog feature-dialog-wide">
        {evidenceOpen && <Suspense fallback={<p role="status">Loading match reports…</p>}>
          <FairPlayCenter matches={matches} staff initialCaseId={initialCaseId} />
        </Suspense>}
      </Modal>

      <ConfirmModal
        isOpen={Boolean(banTarget)}
        title={`Ban ${banTarget?.postedBy}?`}
        description="The message is removed and the account loses access. You can restore it later in Users."
        confirmLabel="Remove and ban"
        isDestructive
        onConfirm={async () => { if (banTarget) await resolve(banTarget, 'remove_and_ban'); setBanTarget(null); }}
        onCancel={() => setBanTarget(null)}
      />
    </div>
  );
};
