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
          <h2 className="text-2xl font-heading font-black text-white tracking-tight">
            Reports
          </h2>
          <span className="text-xs text-[#888888]">
            Community-flagged content awaiting review
          </span>
        </div>

        {/* Segmented Filter */}
        <div className="flex items-center bg-[#222222] p-1 rounded-[4px] border border-[#333333]">
          <button
            onClick={() => setActiveTab('open')}
            className={`px-3 py-1 rounded-[3px] text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              activeTab === 'open'
                ? 'bg-[#191919] text-[#ff6600] shadow-xs'
                : 'text-[#888888] hover:text-white'
            }`}
          >
            <span>Open</span>
            <span className="w-4 h-4 rounded-full bg-[#E8544B] text-white text-[9px] font-bold flex items-center justify-center font-mono">
              {reports.filter((r) => r.status === 'open').length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('resolved')}
            className={`px-3 py-1 rounded-[3px] text-xs font-semibold transition-colors ${
              activeTab === 'resolved'
                ? 'bg-[#191919] text-white shadow-xs'
                : 'text-[#888888] hover:text-white'
            }`}
          >
            Resolved
          </button>
        </div>
      </div>

      {/* Reports List */}
      <div className="space-y-4">
        {filteredReports.length === 0 ? (
          <div className="p-12 text-center rounded-[4px] bg-[#222222] border border-[#333333] text-xs text-[#888888]">
            <ShieldCheck className="w-8 h-8 text-[#3DD68C] mx-auto mb-2" />
            No {activeTab} reports in the moderation queue.
          </div>
        ) : (
          filteredReports.map((report) => (
            <div
              key={report.id}
              className="rounded-[4px] bg-[#222222] border border-[#333333] p-5 space-y-4 shadow-xl hover:border-[#444444] transition-colors"
            >
              {/* Header row: ID, Tag, Content Type, Timestamp */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-medium text-[#888888]">
                    {report.id}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider ${
                      report.type === 'HARASSMENT'
                        ? 'bg-[#3A2A1A] text-[#F59E0B] border border-[#523B22]'
                        : report.type === 'SPAM / SCAM'
                        ? 'bg-[#2E1818] text-[#E8544B] border border-[#522525]'
                        : 'bg-[#2A2A2A] text-[#B3B3B3] border border-[#444444]'
                    }`}
                  >
                    {report.type}
                  </span>
                  <span className="text-[#CCCCCC] font-medium">
                    {report.contentType}
                  </span>
                </div>

                <div className="text-[11px] text-[#888888]">
                  <span>{report.timeAgo}</span>
                  <span className="mx-1.5">·</span>
                  <span className="font-mono text-white">{report.flagCount} reports</span>
                </div>
              </div>

              {/* Flagged Quote */}
              <div className="p-3.5 rounded-[4px] bg-[#1A1A1A] border-l-2 border-[#E8544B] text-xs text-white font-medium">
                "{report.contentSnippet}"
              </div>

              {/* Attribution & Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="text-xs text-[#888888]">
                  Posted by <strong className="text-white font-semibold">{report.postedBy}</strong>
                  <span className="mx-1.5">·</span>
                  flagged by <strong className="text-[#CCCCCC]">{report.reportedBy}</strong>
                </div>

                {report.status === 'open' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedReport(report);
                        setActionType('remove');
                      }}
                      className="px-3 py-1.5 rounded-[3px] bg-[#191919] hover:bg-[#252525] border border-[#333333] text-xs font-semibold text-[#CCCCCC] hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-[#E8544B]" />
                      <span>Remove content</span>
                    </button>

                    <button
                      onClick={() => {
                        setSelectedReport(report);
                        setActionType('remove_and_ban');
                      }}
                      className="px-3 py-1.5 rounded-[3px] bg-[#2E1818] hover:bg-[#3D1E1E] border border-[#522525] text-xs font-semibold text-[#E8544B] flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Remove & ban</span>
                    </button>

                    <button
                      onClick={() => {
                        setSelectedReport(report);
                        setActionType('dismiss');
                      }}
                      className="px-3 py-1.5 rounded-[3px] bg-[#191919] hover:bg-[#252525] border border-[#333333] text-xs font-semibold text-[#888888] hover:text-white transition-colors cursor-pointer"
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
