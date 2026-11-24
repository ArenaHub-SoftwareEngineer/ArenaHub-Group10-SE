import React, { useState } from 'react';
import { BracketTeamBadge } from '../../common/BracketTeamBadge';
import { Image, LoaderCircle } from '../../ui/Icons';
import { Modal } from '../../ui/Modal';
import { bracketTeams } from '../../../lib/data/tournamentDocs';
import { errorMessage } from '../../../lib/errors';
import { prepareTeamImage, TEAM_IMAGE_TYPES } from '../../../lib/teamImage';
import type { BracketDraft } from '../../../lib/types';

export function TeamImagesDialog({ open, draft, onClose, onChange }: {
  open: boolean;
  draft: BracketDraft;
  onClose: () => void;
  onChange: (teamId: string, image?: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const teams = open ? bracketTeams(draft).sort((a, b) => a.seed - b.seed || a.name.localeCompare(b.name)) : [];
  const visible = teams.filter(team => team.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function choose(teamId: string, file?: File) {
    if (!file || busy) return;
    setBusy(teamId);
    setError('');
    try { onChange(teamId, await prepareTeamImage(file)); }
    catch (problem) { setError(errorMessage(problem, 'The team image could not be added.')); }
    finally { setBusy(''); }
  }

  return <Modal open={open} title="Team images" description="Add a logo or photo to any team. It will fit into a circular badge on every match the team plays."
    className="team-images-dialog" onClose={onClose} busy={!!busy}>
    {teams.length > 8 && <label className="team-images-search">Find a team
      <input type="search" value={query} disabled={!!busy} onChange={event => setQuery(event.target.value)} />
    </label>}
    {error && <p className="module-error" role="alert">{error}</p>}
    {visible.length ? <ul className="team-images-list">
      {visible.map(team => {
        const badge = draft.appearance?.teams?.[team.id];
        return <li key={team.id}>
          <BracketTeamBadge name={team.name} badge={badge} />
          <strong>{team.name || `Team ${team.seed}`}</strong>
          <div className="team-images-actions">
            <label className="arena-outline arena-sm team-image-picker">
              {busy === team.id ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Image size={15} aria-hidden="true" />}
              {badge?.image ? 'Replace' : 'Upload'}
              <input type="file" accept={TEAM_IMAGE_TYPES} aria-label={`${badge?.image ? 'Replace' : 'Upload'} image for ${team.name}`} disabled={!!busy}
                onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choose(team.id, file); }} />
            </label>
            {badge?.image && <button type="button" className="arena-outline arena-sm" disabled={!!busy}
              aria-label={`Remove image for ${team.name}`} onClick={() => { setError(''); onChange(team.id); }}>Remove</button>}
          </div>
        </li>;
      })}
    </ul> : <p className="studio-muted">{query.trim() ? 'No teams match your search.' : 'Add teams to the bracket first.'}</p>}
    <footer className="dialog-actions">
      <button type="button" className="arena-primary" onClick={onClose} disabled={!!busy}>Done</button>
    </footer>
  </Modal>;
}
