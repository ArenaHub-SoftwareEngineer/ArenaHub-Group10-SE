import { PageHeading } from '../ui/PageHeading';
import React, { lazy, Suspense, useEffect, useState } from 'react';
import type { ContentReport, Match } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { Trash2, Ban, ShieldCheck, Search, Flag } from '../ui/Icons';
import { errorMessage } from '../../lib/errors';
import type { Tone } from '../../lib/adminInsights';
import './adminOverview.css';

const FairPlayCenter = lazy(() => import('../common/FairPlayCenter').then(module => ({ default: module.FairPlayCenter })));

interface ReportsViewProps {
  reports: ContentReport[];
  matches: Match[];
  initialCaseId: string | null;
}

/** Each report type keeps one colour everywhere: the summary tile, the tag and the quoted message. */
const TYPE_TONE: Record<ContentReport['type'], { tone: Tone; hint: string }> = {
  HARASSMENT: { tone: 'danger', hint: 'Insults, threats or targeting a player' },
  'SPAM / SCAM': { tone: 'warning', hint: 'Repeated posts, links or scams' },
  'STOLEN CONTENT': { tone: 'violet', hint: 'Clips or art posted without credit' },
  MISINFORMATION: { tone: 'info', hint: 'False results or schedules' },
};
const TYPE_LABEL: Record<ContentReport['type'], string> = {
  HARASSMENT: 'Harassment', 'SPAM / SCAM': 'Spam or scam', 'STOLEN CONTENT': 'Stolen content', MISINFORMATION: 'Misinformation',
};

export const ReportsView: React.FC<ReportsViewProps> = ({ reports, matches, initialCaseId }) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'open' | 'resolved'>('open');
  const [type, setType] = useState<ContentReport['type'] | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedReport, setSelectedReport] = useState<ContentReport | null>(null);
  const [actionType, setActionType] = useState<'remove' | 'remove_and_ban' | 'dismiss' | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(Boolean(initialCaseId));
  useEffect(() => setEvidenceOpen(Boolean(initialCaseId)), [initialCaseId]);

  const open = reports.filter(report => report.status === 'open');
  const needle = search.trim().toLowerCase();
  const filteredReports = reports.filter(report => report.status === activeTab && (type === 'all' || report.type === type)
    && (!needle || `${report.postedBy} ${report.contentSnippet}`.toLowerCase().includes(needle)));

  const handleConfirmAction = async () => {
    if (!selectedReport || !actionType) return;

    try { await firestoreService.resolveReport(selectedReport.id, actionType); }
    catch (error) { showToast(errorMessage(error, 'The action could not be completed.'), 'error'); throw error; }

    if (actionType === 'remove_and_ban') {
      showToast(`Message removed and ${selectedReport.postedBy} banned.`, 'success');
    } else if (actionType === 'remove') {
      showToast('Message removed from match chat.', 'success');
    } else {
      showToast('Report dismissed. No action taken.', 'info');
    }

    setSelectedReport(null);
    setActionType(null);
  };

  const act = (report: ContentReport, action: NonNullable<typeof actionType>) => { setSelectedReport(report); setActionType(action); };

  return (
    <div className="ov-page">
      <PageHeading title="Community reports" description="Review flagged chat messages."
        actions={<button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setEvidenceOpen(true)}>Match evidence</button>} />

      <nav className="fb-summary" aria-label="Open reports by type">
        {(Object.keys(TYPE_TONE) as ContentReport['type'][]).map(key => {
          const count = open.filter(report => report.type === key).length;
          return <button key={key} type="button" className={`ov-kpi is-link ov-tone is-${count ? TYPE_TONE[key].tone : 'neutral'}`} aria-pressed={type === key}
            onClick={() => { setType(type === key ? 'all' : key); setActiveTab('open'); }}>
            <span>{TYPE_LABEL[key]}</span><strong>{count}</strong><small>{TYPE_TONE[key].hint}</small>
          </button>;
        })}
      </nav>

      <div className="page-toolbar">
        <div className="ah-chips" role="group" aria-label="Show open or resolved reports">
          <button type="button" className="ah-chip" aria-pressed={activeTab === 'open'} onClick={() => setActiveTab('open')}>
            Needs review <span className="ov-chip-count">{open.length}</span>
          </button>
          <button type="button" className="ah-chip" aria-pressed={activeTab === 'resolved'} onClick={() => setActiveTab('resolved')}>
            Resolved <span className="ov-chip-count">{reports.length - open.length}</span>
          </button>
          {type !== 'all' && <button type="button" className="ah-chip" aria-pressed="true" onClick={() => setType('all')}>{TYPE_LABEL[type]} · clear</button>}
        </div>
        <label className="page-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search reports" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search author or message" />
        </label>
      </div>

      {filteredReports.length === 0 ? (
          <p className="ov-all-clear ov-tone is-success" role="status">
            <ShieldCheck size={18} aria-hidden="true" />
            {activeTab === 'open' && !needle && type === 'all' ? 'All clear. No reports are waiting for review.' : 'No reports match these filters.'}
          </p>
        ) : <div className="ov-page" role="list" aria-label={activeTab === 'open' ? 'Reports that need review' : 'Resolved reports'}>{filteredReports.map(report => {
          const tone = report.status === 'open' ? TYPE_TONE[report.type]?.tone || 'neutral' : 'neutral';
          return <article key={report.id} role="listitem" className={`fb-card ov-tone is-${tone}${report.status === 'resolved' ? ' is-resolved' : ''}`}>
            <div className="fb-card-head">
              <span className="fb-type"><Flag size={13} aria-hidden="true" />{TYPE_LABEL[report.type] || report.type}</span>
              <span className="fb-meta">{report.contentType} · {report.timeAgo}{report.flagCount > 1 ? ` · ${report.flagCount} reports` : ''}</span>
            </div>
            <blockquote className="fb-quote">“{report.contentSnippet}”</blockquote>
            <div className="fb-card-head">
              <p className="fb-meta">Posted by <strong>{report.postedBy}</strong> · flagged by {report.reportedBy}</p>
              {report.status === 'open' ? <div className="fb-actions">
                <button type="button" className="arena-outline arena-sm" onClick={() => act(report, 'dismiss')}>Dismiss</button>
                <button type="button" className="arena-outline arena-sm" onClick={() => act(report, 'remove')}><Trash2 size={14} aria-hidden="true" /> Remove message</button>
                <button type="button" className="arena-outline arena-sm arena-danger-text" onClick={() => act(report, 'remove_and_ban')}><Ban size={14} aria-hidden="true" /> Remove and ban</button>
              </div> : <span className="status-pill is-success">Resolved</span>}
            </div>
          </article>;
        })}</div>}

      <Modal open={evidenceOpen} title="Match reports and appeals" onClose={() => setEvidenceOpen(false)} className="feature-dialog feature-dialog-wide">
        {evidenceOpen && <Suspense fallback={<p role="status">Loading match reports…</p>}>
          <FairPlayCenter matches={matches} staff initialCaseId={initialCaseId} />
        </Suspense>}
      </Modal>

      <ConfirmModal
        isOpen={!!selectedReport && !!actionType}
        title={actionType === 'remove_and_ban' ? `Remove the message and ban ${selectedReport?.postedBy}?` : actionType === 'remove' ? 'Remove this message?' : 'Dismiss this report?'}
        description={actionType === 'remove_and_ban'
          ? `The message is deleted from match chat and ${selectedReport?.postedBy} loses access to ArenaHub. You can restore the account later from Users.`
          : actionType === 'remove'
          ? 'The message is deleted from match chat. The author keeps their account.'
          : 'The report is closed and the message stays. No one is notified.'}
        confirmLabel={actionType === 'remove_and_ban' ? 'Remove and ban' : actionType === 'remove' ? 'Remove message' : 'Dismiss report'}
        isDestructive={actionType === 'remove' || actionType === 'remove_and_ban'}
        onConfirm={handleConfirmAction}
        onCancel={() => { setSelectedReport(null); setActionType(null); }}
      />
    </div>
  );
};
