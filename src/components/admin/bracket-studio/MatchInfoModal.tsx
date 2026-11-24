// Match editor dialog for participants, team images, and scores.
import React, { useState } from 'react';
import type { Match } from '../../../lib/types';
import type { BracketAppearance } from '../../../lib/bracketAppearance';
import { errorMessage } from '../../../lib/errors';
import { prepareTeamImage, TEAM_IMAGE_TYPES } from '../../../lib/teamImage';
import { BracketTeamBadge } from '../../common/BracketTeamBadge';
import { LoaderCircle } from '../../ui/Icons';
import { Modal } from '../../ui/Modal';

export interface MatchInfoModalProps {
  match: Match | null;
  appearance?: BracketAppearance;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  onUpdateTeamImage: (teamId: string, image?: string) => void;
  onUpdateTeamName: (matchId: string, teamSlot: 1 | 2, newName: string) => void;
  onScoreChange: (matchId: string, teamSlot: 1 | 2, delta: number) => void;
}

export const MatchInfoModal: React.FC<MatchInfoModalProps> = ({
  match,
  appearance,
  isOpen,
  onClose,
  onSave,
  onUpdateTeamImage,
  onUpdateTeamName,
  onScoreChange,
}) => {
  const [uploading, setUploading] = useState('');
  const [imageError, setImageError] = useState('');
  if (!isOpen || !match) return null;

  const isBye = (team: Match['team1']) => Boolean(team?.isBye || team?.name === 'BYE');
  const isByeMatch = isBye(match.team1) || isBye(match.team2);
  const busy = Boolean(uploading);

  async function upload(teamId: string, file?: File) {
    if (!file || busy) return;
    setImageError('');
    setUploading(teamId);
    try {
      onUpdateTeamImage(teamId, await prepareTeamImage(file));
    } catch (error) {
      setImageError(errorMessage(error, 'The team image could not be added.'));
    } finally {
      setUploading('');
    }
  }

  function close() {
    setImageError('');
    onClose();
  }

  return (
    <Modal open={isOpen} title="Match details" description={`${match.roundName} · ${match.matchFormat}`} onClose={close} busy={busy}>
      <div className="match-details-content p-5 space-y-4">
        <div className="flex items-center justify-between text-xs font-bold text-(--text-muted) px-1">
          <span>PARTICIPANTS</span>
          <span>SCORE</span>
        </div>

        {imageError && <p className="module-error" role="alert">{imageError}</p>}
        <fieldset disabled={busy} className="space-y-2 min-w-0">
          {([1, 2] as const).map(slot => {
            const team = slot === 1 ? match.team1 : match.team2;
            const score = slot === 1 ? match.score.team1Score : match.score.team2Score;
            const bye = isBye(team);
            const label = team?.name || `Team ${slot}`;
            const badge = team && appearance?.teams?.[team.id];
            const imageAction = badge?.image ? 'Replace' : 'Upload';
            return <div key={slot} className="match-details-participant p-2.5 rounded-[5px] bg-(--surface-soft) border border-(--border)">
              <div className="match-details-image">
                {team && !bye ? <>
                  <label className="team-image-picker match-details-upload">
                    {uploading === team.id ? <LoaderCircle size={20} className="animate-spin" aria-hidden="true" />
                      : <BracketTeamBadge name={team.name} badge={badge} />}
                    <span>{imageAction}</span>
                    <input type="file" accept={TEAM_IMAGE_TYPES} aria-label={`${imageAction} image for ${label}`}
                      onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        void upload(team.id, file);
                      }} />
                  </label>
                  {badge?.image && <button type="button" className="match-details-remove"
                    aria-label={`Remove image for ${label}`} onClick={() => { setImageError(''); onUpdateTeamImage(team.id); }}>Remove</button>}
                </> : <BracketTeamBadge empty />}
              </div>
              <div className="match-slot-fields flex flex-wrap items-center gap-2 min-w-0">
                <span className="w-5 h-5 rounded-[3px] bg-(--surface-elevated) text-xs font-bold text-(--text-secondary) flex items-center justify-center shrink-0">
                  {team?.seed ?? slot}
                </span>
                <input
                  type="text"
                  value={team?.name ?? ''}
                  onChange={event => onUpdateTeamName(match.id, slot, event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSave();
                    }
                  }}
                  aria-label={`Team ${slot} name`}
                  placeholder={`Team ${slot} name`}
                  className="min-w-0 flex-1 bg-(--surface) border border-(--border-strong) focus:border-(--brand) rounded-[3px] px-2.5 py-1 text-xs font-semibold text-(--text-primary) outline-none transition-colors"
                />
                <select
                  aria-label={`Team ${slot} slot type`}
                  value={bye ? 'bye' : 'team'}
                  onChange={event => onUpdateTeamName(match.id, slot, event.target.value === 'bye' ? 'BYE' : '')}
                  className="match-slot-type"
                >
                  <option value="team">Team</option>
                  <option value="bye">BYE</option>
                </select>
              </div>
              <div className="match-details-score flex items-center gap-1.5">
                <button type="button" aria-label={`Decrease ${label} score`} disabled={isByeMatch}
                  onClick={() => onScoreChange(match.id, slot, -1)}
                  className="w-6 h-6 rounded-[3px] bg-(--surface-elevated) text-xs text-(--text-primary) font-bold flex items-center justify-center cursor-pointer">-</button>
                <span className="w-7 text-center text-sm font-bold text-(--text-primary) tabular-nums">{score}</span>
                <button type="button" aria-label={`Increase ${label} score`} disabled={isByeMatch}
                  onClick={() => onScoreChange(match.id, slot, 1)}
                  className="w-6 h-6 rounded-[3px] bg-(--surface-elevated) text-xs text-(--text-primary) font-bold flex items-center justify-center cursor-pointer">+</button>
              </div>
            </div>;
          })}
        </fieldset>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-(--border) bg-(--surface-soft)">
        <span className="text-xs text-(--text-muted)">Select or type BYE to advance the other team.</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={close} disabled={busy}
            className="px-3 py-1.5 rounded-[4px] border border-(--border-strong) text-(--text-secondary) hover:text-(--text-primary) text-xs font-semibold transition-colors cursor-pointer">Cancel</button>
          <button type="button" onClick={onSave} disabled={busy}
            className="px-4 py-1.5 rounded-[4px] bg-(--brand) hover:bg-(--brand-hover) text-black text-xs font-bold transition-colors cursor-pointer">Save</button>
        </div>
      </div>
    </Modal>
  );
};
