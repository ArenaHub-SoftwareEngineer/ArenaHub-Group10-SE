// Manual bracket setup: title, format, match format and team count.
import React, { useState } from 'react';
import { MatchFormat, MATCH_FORMATS, seriesWinsNeeded } from '../../../lib/types';
import { Modal } from '../../ui/Modal';
import { Req } from '../../ui/Req';
import { MAX_BRACKET_TEAMS } from '../../../lib/bracketUtils';
import { ChevronRight } from '../../ui/Icons';
import { BracketFormat } from './shared';

// ── Manual Bracket Setup Modal (Quick Pop-Up) ────────────────────────────────

export interface ManualBracketSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceed: (config: {
    title: string;
    format: BracketFormat;
    matchFormat: MatchFormat;
    teamCount: number;
  }) => void;
}

export const ManualBracketSetupModal: React.FC<ManualBracketSetupModalProps> = ({
  isOpen,
  onClose,
  onProceed,
}) => {
  const [title, setTitle] = useState('Untitled Bracket');
  const [format, setFormat] = useState<BracketFormat>('Single Elimination');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('Bo3');
  const [teamCount, setTeamCount] = useState('');
  const parsedTeamCount = Number(teamCount);
  const formatTeamLimit = format === 'Round Robin' ? 32 : MAX_BRACKET_TEAMS;
  const validTeamCount = Number.isInteger(parsedTeamCount) && parsedTeamCount >= 2 && parsedTeamCount <= formatTeamLimit;


  return (
    <Modal open={isOpen} title="Create Manual Bracket" description="Choose the tournament format and team count. Fill in team names on the canvas." onClose={onClose}>
        {/* Form Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* Bracket Name */}
          <div>
            <label className="block text-xs font-semibold text-(--text-muted) mb-1.5">
              Bracket Name
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. WMSU Palaro 2026 - MLBB"
              className="w-full bg-(--surface) border border-(--border) focus:border-(--brand) rounded-[4px] px-3 py-2 text-xs text-(--text-primary) placeholder-(--text-muted) outline-none transition-colors font-medium"
            />
          </div>

          {/* Bracket Format */}
          <div>
            <label className="block text-xs font-semibold text-(--text-muted) mb-2">
              Bracket Format
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['Single Elimination', 'Double Elimination', 'Round Robin'] as BracketFormat[]).map((f) => {
                const active = format === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={`py-2.5 px-3 rounded-[5px] border text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-(--brand)/10 border-(--brand) text-(--brand-ink)'
                        : 'bg-(--bg-base) border-(--border) text-(--text-muted) hover:text-white hover:border-(--border-strong)'
                    }`}
                  >
                    <span className="block font-bold text-xs">{f}</span>
                    <span className="text-xs opacity-60">
                      {f === 'Single Elimination' ? '1 loss and out' : f === 'Double Elimination' ? 'Upper, lower, and reset final' : 'Every team plays every opponent'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Match Format */}
          <div>
            <label className="block text-xs font-semibold text-(--text-muted) mb-2">
              Match Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              {MATCH_FORMATS.map((mf) => {
                const active = matchFormat === mf;
                return (
                  <button
                    key={mf}
                    type="button"
                    onClick={() => setMatchFormat(mf)}
                    className={`py-2 px-3 rounded-[5px] border text-center transition-all cursor-pointer ${
                      active
                        ? 'bg-(--brand)/10 border-(--brand) text-(--brand-ink)'
                        : 'bg-(--bg-base) border-(--border) text-(--text-muted) hover:text-white hover:border-(--border-strong)'
                    }`}
                  >
                    <span className="font-bold text-xs block">{mf}</span>
                    <span className="text-xs opacity-60">
                      {`First to ${seriesWinsNeeded(mf)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Number of Teams */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-(--text-muted)">
                Number of Teams<Req />
              </label>
              <span className="text-xs text-(--success) font-semibold">
                Choose any whole number from 2 to {MAX_BRACKET_TEAMS}
              </span>
            </div>

            <input
              id="manual-team-count"
              aria-required="true"
              type="number"
              min={2}
              max={formatTeamLimit}
              step={1}
              value={teamCount}
              onChange={(e) => setTeamCount(e.target.value)}
              placeholder="Enter team count"
              aria-invalid={teamCount !== '' && !validTeamCount}
              aria-describedby="manual-team-count-feedback"
              className="w-full bg-(--surface) border border-(--border-strong) focus:border-(--brand) rounded-[4px] px-3 py-2 text-sm font-semibold text-(--text-primary) outline-none"
            />
            <p id="manual-team-count-feedback" className={`mt-2 text-xs ${teamCount !== '' && !validTeamCount ? 'text-(--danger)' : 'text-(--text-muted)'}`} role="status">
              {teamCount !== '' && !validTeamCount ? `Enter a whole number from 2 to ${formatTeamLimit}.` : format === 'Round Robin' ? 'Every team meets each opponent once, with one fixture per team per round.' : 'Your count determines the full bracket and any earned BYEs.'}
            </p>

            {validTeamCount && format !== 'Round Robin' && <div className="p-2.5 rounded-[4px] bg-(--surface) border border-(--border) text-xs text-(--text-muted)">
              {parsedTeamCount % 2 === 0 && (parsedTeamCount & (parsedTeamCount - 1)) === 0 ? (
                <span>Perfect balanced bracket: <strong>{teamCount} teams</strong> play in a power-of-2 tournament with no byes needed.</span>
              ) : (
                <span>
                  Automatic BYE seeding active: With <strong>{teamCount} teams</strong>, the top{' '}
                  <strong className="text-(--brand-ink)">
                    {Math.pow(2, Math.ceil(Math.log2(parsedTeamCount))) - parsedTeamCount}
                  </strong>{' '}
                  seeds automatically receive earned BYEs directly into the next round.
                </span>
              )}
            </div>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-(--border) bg-(--surface-soft)">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[4px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-(--text-primary) text-xs font-semibold cursor-pointer transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!validTeamCount}
            onClick={() =>
              onProceed({
                title: title.trim() || 'Untitled Bracket',
                format,
                matchFormat,
                teamCount: parsedTeamCount,
              })
            }
            className="px-5 py-2 rounded-[4px] bg-(--brand) hover:bg-(--brand-hover) text-black text-xs font-bold flex items-center gap-2 shadow-md cursor-pointer transition-colors"
          >
            <span>Proceed to Preview</span>
            <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>
    </Modal>
  );
};
