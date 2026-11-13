import React, { useState } from 'react';
import { ContentReport } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useToast } from '../ui/Toast';
import { Trash2, Ban, Check, ShieldCheck } from '../ui/Icons';

interface ReportsViewProps {
  reports: ContentReport[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({ reports }) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'open' | 'resolved'>('open');
  const [selectedReport, setSelectedReport] = useState<ContentReport | null>(null);
  const [actionType, setActionType] = useState<'remove' | 'remove_and_ban' | 'dismiss' | null>(null);

  const filteredReports = reports.filter((r) => r.status === activeTab);

  const handleConfirmAction = async () => {
    if (!selectedReport || !actionType) return;

    try { await firestoreService.resolveReport(selectedReport.id, actionType); }
    catch (error) { showToast(error instanceof Error ? error.message : 'The action could not be completed.', 'error'); throw error; }

    if (actionType === 'remove_and_ban') {
      showToast(`Content removed and user ${selectedReport.postedBy} banned!`, 'error');
    } else if (actionType === 'remove') {
      showToast(`Content removed for report ${selectedReport.id}`, 'info');
    } else {
      showToast(`Report ${selectedReport.id} dismissed`, 'info');
    }

    setSelectedReport(null);
    setActionType(null);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-(--text-primary) tracking-tight">
            Reports
          </h2>
          <span className="text-xs text-(--text-muted)">
            Community-flagged content awaiting review
          </span>
        </div>

        {/* Segmented Filter */}
        <div className="flex items-center bg-(--surface-soft) p-1 rounded-[4px] border border-(--border)">
          <button
            onClick={() => setActiveTab('open')}
            className={`px-3 py-1 rounded-[3px] text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              activeTab === 'open'
                ? 'bg-(--surface) text-(--brand-ink) shadow-xs'
                : 'text-(--text-muted) hover:text-(--text-primary)'
            }`}
          >
            <span>Open</span>
            <span className="w-4 h-4 rounded-full bg-(--danger) text-white text-xs font-bold flex items-center justify-center tabular-nums">
              {reports.filter((r) => r.status === 'open').length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('resolved')}
            className={`px-3 py-1 rounded-[3px] text-xs font-semibold transition-colors ${
              activeTab === 'resolved'
                ? 'bg-(--surface) text-(--text-primary) shadow-xs'
                : 'text-(--text-muted) hover:text-(--text-primary)'
            }`}
          >
            Resolved
          </button>
        </div>
      </div>

      {/* Reports List */}
      <div className="space-y-4">
        {filteredReports.length === 0 ? (
          <div className="p-12 text-center rounded-[4px] bg-(--surface-soft) border border-(--border) text-xs text-(--text-muted)">
            <ShieldCheck className="w-8 h-8 text-(--success) mx-auto mb-2" />
            No {activeTab} reports in the moderation queue.
          </div>
        ) : (
          filteredReports.map((report) => (
            <div
              key={report.id}
              className="rounded-[4px] bg-(--surface-soft) border border-(--border) p-5 space-y-4 shadow-xl hover:border-(--border-strong) transition-colors"
            >
              {/* Header row: ID, Tag, Content Type, Timestamp */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="tabular-nums font-medium text-(--text-muted)">
                    {report.id}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-[2px] text-xs font-bold ${
                      report.type === 'HARASSMENT'
                        ? 'bg-(--brand-soft) text-(--warning) border border-(--brand-border)'
                        : report.type === 'SPAM / SCAM'
                        ? 'bg-(--surface-soft) text-(--danger) border border-(--danger-border)'
                        : 'bg-(--surface-elevated) text-(--text-secondary) border border-(--border-strong)'
                    }`}
                  >
                    {report.type}
                  </span>
                  <span className="text-(--text-secondary) font-medium">
                    {report.contentType}
                  </span>
                </div>

                <div className="text-xs text-(--text-muted)">
                  <span>{report.timeAgo}</span>
                  <span className="mx-1.5">·</span>
                  <span className="tabular-nums text-(--text-primary)">{report.flagCount} reports</span>
                </div>
              </div>

              {/* Flagged Quote */}
              <div className="p-3.5 rounded-[4px] bg-(--surface) border-l-2 border-(--danger) text-xs text-(--text-primary) font-medium">
                "{report.contentSnippet}"
              </div>

              {/* Attribution & Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="text-xs text-(--text-muted)">
                  Posted by <strong className="text-(--text-primary) font-semibold">{report.postedBy}</strong>
                  <span className="mx-1.5">·</span>
                  flagged by <strong className="text-(--text-secondary)">{report.reportedBy}</strong>
                </div>

                {report.status === 'open' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedReport(report);
                        setActionType('remove');
                      }}
                      className="px-3 py-1.5 rounded-[3px] bg-(--surface) hover:bg-(--surface-soft) border border-(--border) text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-(--danger)" />
                      <span>Remove content</span>
                    </button>

                    <button
                      onClick={() => {
                        setSelectedReport(report);
                        setActionType('remove_and_ban');
                      }}
                      className="px-3 py-1.5 rounded-[3px] bg-(--surface-soft) hover:bg-(--danger-soft) border border-(--danger-border) text-xs font-semibold text-(--danger) flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Remove & ban</span>
                    </button>

                    <button
                      onClick={() => {
                        setSelectedReport(report);
                        setActionType('dismiss');
                      }}
                      className="px-3 py-1.5 rounded-[3px] bg-(--surface) hover:bg-(--surface-soft) border border-(--border) text-xs font-semibold text-(--text-muted) hover:text-(--text-primary) transition-colors cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={!!selectedReport && !!actionType}
        title={
          actionType === 'remove_and_ban'
            ? `Remove Content & Ban ${selectedReport?.postedBy}?`
            : actionType === 'remove'
            ? 'Remove Flagged Content?'
            : 'Dismiss Report?'
        }
        description={
          actionType === 'remove_and_ban'
            ? `Are you sure you want to delete this flagged content and ban user ${selectedReport?.postedBy} from WMSU Palaro?`
            : actionType === 'remove'
            ? 'Are you sure you want to delete this content from public match chat / posts?'
            : 'Are you sure you want to dismiss this report? No disciplinary action will be taken.'
        }
        confirmLabel={
          actionType === 'remove_and_ban'
            ? 'Remove & Ban User'
            : actionType === 'remove'
            ? 'Remove Content'
            : 'Dismiss Report'
        }
        isDestructive={actionType === 'remove' || actionType === 'remove_and_ban'}
        onConfirm={handleConfirmAction}
        onCancel={() => {
          setSelectedReport(null);
          setActionType(null);
        }}
      />
    </div>
  );
};
