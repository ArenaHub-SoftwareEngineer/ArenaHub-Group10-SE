// Match editor dialog: teams, scores, schedule and stream for one match.
import React from 'react';
import { Match } from '../../../lib/types';
import { Modal } from '../../ui/Modal';

// ── Match Info Modal (matches Screenshot 2) ───────────────────────────────────

export interface MatchInfoModalProps {
  match: Match | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  onUpdateTeamName: (matchId: string, teamSlot: 1 | 2, newName: string) => void;
  onScoreChange: (matchId: string, teamSlot: 1 | 2, delta: number) => void;
}

export const MatchInfoModal: React.FC<MatchInfoModalProps> = ({
  match,
  isOpen,
  onClose,
  onSave,
  onUpdateTeamName,
  onScoreChange,
}) => {
  if (!isOpen || !match) return null;

  const t1Name = match.team1?.name ?? '';
  const t2Name = match.team2?.name ?? '';
  const isByeMatch = [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE');
  const s1 = match.score.team1Score;
  const s2 = match.score.team2Score;
  const t1Seed = match.team1?.seed ?? 1;
  const t2Seed = match.team2?.seed ?? 2;

  return (
    <Modal open={isOpen} title="Match details" description={`${match.roundName} · ${match.matchFormat}`} onClose={onClose}>
        {/* Content Table */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between text-xs font-bold text-(--text-muted) px-1">
            <span>PARTICIPANTS</span>
            <span>SCORE</span>
          </div>

          <div className="space-y-2">
            {/* Team 1 Row */}
            <div className="flex items-center justify-between p-2.5 rounded-[5px] bg-(--surface-soft) border border-(--border)">
              <div className="match-slot-fields flex flex-wrap items-center gap-2 flex-1 min-w-0 pr-3">
                <span className="w-5 h-5 rounded-[3px] bg-(--surface-elevated) text-xs font-bold text-(--text-secondary) flex items-center justify-center shrink-0">
                  {t1Seed}
                </span>
                <input
                  type="text"
                  value={t1Name}
                  onChange={(e) => onUpdateTeamName(match.id, 1, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onSave();
                    }
                  }}
                  aria-label="Team 1 name"
                  placeholder="Team 1 name"
                  className="min-w-0 flex-1 bg-(--surface) border border-(--border-strong) focus:border-(--brand) rounded-[3px] px-2.5 py-1 text-xs font-semibold text-(--text-primary) outline-none transition-colors"
                />
                <select
                  aria-label="Team 1 slot type"
                  value={match.team1?.isBye || t1Name === 'BYE' ? 'bye' : 'team'}
                  onChange={e => onUpdateTeamName(match.id, 1, e.target.value === 'bye' ? 'BYE' : '')}
                  className="match-slot-type"
                >
                  <option value="team">Team</option>
                  <option value="bye">BYE</option>
                </select>
              </div>

              {/* Score counter */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  aria-label={`Decrease ${match.team1?.name || 'Team 1'} score`}
                  disabled={isByeMatch}
                  onClick={() => onScoreChange(match.id, 1, -1)}
                  className="w-6 h-6 rounded-[3px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-xs text-(--text-primary) font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  -
                </button>
                <span className="w-7 text-center text-sm font-bold text-(--text-primary) tabular-nums">
                  {s1}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${match.team1?.name || 'Team 1'} score`}
                  disabled={isByeMatch}
                  onClick={() => onScoreChange(match.id, 1, 1)}
                  className="w-6 h-6 rounded-[3px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-xs text-(--text-primary) font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* Team 2 Row */}
            <div className="flex items-center justify-between p-2.5 rounded-[5px] bg-(--surface-soft) border border-(--border)">
              <div className="match-slot-fields flex flex-wrap items-center gap-2 flex-1 min-w-0 pr-3">
                <span className="w-5 h-5 rounded-[3px] bg-(--surface-elevated) text-xs font-bold text-(--text-secondary) flex items-center justify-center shrink-0">
                  {t2Seed}
                </span>
                <input
                  type="text"
                  value={t2Name}
                  onChange={(e) => onUpdateTeamName(match.id, 2, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onSave();
                    }
                  }}
                  aria-label="Team 2 name"
                  placeholder="Team 2 name"
                  className="min-w-0 flex-1 bg-(--surface) border border-(--border-strong) focus:border-(--brand) rounded-[3px] px-2.5 py-1 text-xs font-semibold text-(--text-primary) outline-none transition-colors"
                />
                <select
                  aria-label="Team 2 slot type"
                  value={match.team2?.isBye || t2Name === 'BYE' ? 'bye' : 'team'}
                  onChange={e => onUpdateTeamName(match.id, 2, e.target.value === 'bye' ? 'BYE' : '')}
                  className="match-slot-type"
                >
                  <option value="team">Team</option>
                  <option value="bye">BYE</option>
                </select>
              </div>

              {/* Score counter */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  aria-label={`Decrease ${match.team2?.name || 'Team 2'} score`}
                  disabled={isByeMatch}
                  onClick={() => onScoreChange(match.id, 2, -1)}
                  className="w-6 h-6 rounded-[3px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-xs text-(--text-primary) font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  -
                </button>
                <span className="w-7 text-center text-sm font-bold text-(--text-primary) tabular-nums">
                  {s2}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${match.team2?.name || 'Team 2'} score`}
                  disabled={isByeMatch}
                  onClick={() => onScoreChange(match.id, 2, 1)}
                  className="w-6 h-6 rounded-[3px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-xs text-(--text-primary) font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-(--border) bg-(--surface-soft)">
          <span className="text-xs text-(--text-muted)">
            Select or type BYE to advance the other team.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-[4px] border border-(--border-strong) text-(--text-secondary) hover:text-(--text-primary) text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              className="px-4 py-1.5 rounded-[4px] bg-(--brand) hover:bg-(--brand-hover) text-black text-xs font-bold transition-colors cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
    </Modal>
  );
};
