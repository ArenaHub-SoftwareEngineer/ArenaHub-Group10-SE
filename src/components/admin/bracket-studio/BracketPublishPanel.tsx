// Publish dialog: choose the game (and CODM mode) a bracket is published under.
import React, { useState, useEffect } from 'react';
import { BracketDraft } from '../../../lib/types';
import { Modal } from '../../ui/Modal';
import { publicationGameKey } from '../../../lib/bracketPublication';
import { scheduleDate, timeOrder } from '../../../lib/calendar';
import { Req } from '../../ui/Req';
import { Check, Plus } from '../../ui/Icons';

// ── Publish Bracket to Game Modal ─────────────────────────────────────────────
export interface PublishBracketModalProps {
  isOpen: boolean;
  draft: BracketDraft | null;
  onClose: () => void;
  onConfirm: (gameName: string, gameId: string) => Promise<void>;
}

export const PRESET_GAMES = [
  { id: 'game-mlbb', name: 'Mobile Legends: Bang Bang', image: '/fairplay-mlbb.webp' },
  { id: 'game-dota2', name: 'Dota 2', image: '/fairplay-dota2.jpg' },
  { id: 'codm', name: 'Call of Duty: Mobile', image: '/fairplay-codm.webp' },
];
export const CODM_MODES = [
  { id: 'game-codm-mp', name: 'Call of Duty: Mobile Multiplayer', label: 'Multiplayer' },
  { id: 'game-codm-br', name: 'Call of Duty: Mobile Battle Royale', label: 'Battle Royale' },
];

export const PublishBracketModal: React.FC<PublishBracketModalProps> = ({
  isOpen,
  draft,
  onClose,
  onConfirm,
}) => {
  const [selectedGameId, setSelectedGameId] = useState<string>('game-mlbb');
  const [customGameName, setCustomGameName] = useState<string>('');
  const [isCustom, setIsCustom] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  useEffect(() => {
    if (!isOpen || !draft) return;
    const key = publicationGameKey(draft);
    const game = [...PRESET_GAMES, ...CODM_MODES].find(option => option.id === key);
    const custom = !game && draft.status === 'published';
    setSelectedGameId(game?.id || PRESET_GAMES[0].id);
    setIsCustom(custom);
    setCustomGameName(custom ? draft.gameName : '');
    setPublishError('');
  }, [isOpen, draft]);

  if (!draft) return null;

  const scheduledMatches = draft.matches.filter(match =>
    scheduleDate(match.scheduledDate || '') && timeOrder(match.scheduledTime || '') !== 9999
  );
  const codmMode = CODM_MODES.find(mode => mode.id === selectedGameId);
  const codmSelected = !isCustom && (selectedGameId === 'codm' || Boolean(codmMode));
  const activeGame = codmMode ?? PRESET_GAMES.find(game => game.id === selectedGameId);
  const finalGameName = isCustom
    ? customGameName.trim() || 'Custom Esports'
    : activeGame?.name || 'Mobile Legends: Bang Bang';

  const submitPublish = async () => {
    if (publishing || (!isCustom && selectedGameId === 'codm')) return;
    setPublishing(true); setPublishError('');
    try {
      await onConfirm(finalGameName, isCustom ? 'game-custom' : selectedGameId);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : 'Publishing failed. Try again.');
    } finally { setPublishing(false); }
  };

  return (
    <Modal open={isOpen} title="Publish Bracket" description="Choose a game and review the bracket and schedule. ArenaHub saves the latest draft first, then publishes it live for the selected game or mode." className="studio-publish" onClose={onClose} busy={publishing}>
        {/* Body */}
        <fieldset disabled={publishing} className="studio-publish-body">
          {/* Game Selection */}
          <div>
            <h3 className="studio-label">Game</h3>
            <div className="studio-game-options">
              {PRESET_GAMES.map((game) => {
                const isSelected = game.id === 'codm' ? codmSelected : !isCustom && selectedGameId === game.id;
                return (
                  <button
                    aria-pressed={isSelected}
                    aria-label={game.name}
                    title={game.name}
                    key={game.id}
                    type="button"
                    onClick={() => {
                      if (game.id !== 'codm' || !codmMode) setSelectedGameId(game.id);
                      setIsCustom(false);
                    }}
                    className="studio-game-option"
                  >
                    <img src={game.image} alt="" />
                  </button>
                );
              })}
            </div>

            {codmSelected && <div className="module-form mt-3">
              <label><Req>CODM mode</Req>
                <select aria-required="true" value={codmMode?.id || ''} onChange={event => setSelectedGameId(event.target.value || 'codm')}>
                  <option value="">Choose a mode</option>
                  {CODM_MODES.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                </select>
              </label>
              {codmMode?.id === 'game-codm-br' && <p className="module-notice">This publishes the bracket and schedule under Battle Royale. This bracket uses head-to-head match results. For lobby games scored by placement and eliminations, create the event on the Battle Royale page instead.</p>}
            </div>}

            {/* Custom Game toggle */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setIsCustom(!isCustom)}
                className={`text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                  isCustom ? 'text-(--brand-ink)' : 'text-(--text-muted) hover:text-(--text-primary)'
                }`}
              >
                <Plus className="w-3 h-3" />
                <span>Use a custom game</span>
              </button>

              {isCustom && (
                <input
                  type="text"
                  aria-label="Custom game title"
                  aria-required="true"
                  maxLength={100}
                  value={customGameName}
                  onChange={(e) => setCustomGameName(e.target.value)}
                  placeholder="Enter game title (e.g., Tekken 8, CODM)..."
                  className="mt-2 w-full bg-(--surface) border border-(--border) focus:border-(--brand) rounded-[4px] px-3 py-2 text-xs text-(--text-primary) placeholder-(--text-muted) outline-none"
                  autoFocus
                />
              )}
            </div>
          </div>

          <section className="studio-publish-summary">
            <h3 className="studio-label">Bracket summary</h3>
            <dl>
              <dt>Tournament</dt>
              <dd>{draft.title}</dd>
              <dt>Game</dt>
              <dd>{codmSelected && !codmMode ? 'Choose a CODM mode' : finalGameName}</dd>
              <dt>Format</dt>
              <dd>{draft.format} · {[...new Set(draft.matches.map(match => match.matchFormat))].join(', ')}</dd>
              <dt>Teams and matches</dt>
              <dd>{draft.teamsCount} teams · {draft.matches.length} matches</dd>
              <dt>Scheduled matches</dt>
              <dd>{scheduledMatches.length} · Manila time</dd>
            </dl>
          </section>
          {scheduledMatches.length > 0 && <details className="studio-publish-summary">
            <summary>Review match times</summary>
            <ul className="stream-schedule-preview">
              {scheduledMatches.map(match => <li key={match.id}>
                <strong>{match.matchNumber}</strong><span>{match.scheduledDate} · {match.scheduledTime}</span>
              </li>)}
            </ul>
          </details>}
          <p className="studio-muted">The same bracket and schedule will appear in spectator views and Stream Manager.</p>
        </fieldset>
        {publishError && <p className="module-error" role="alert">{publishError}</p>}

        {/* Footer */}
        <div className="studio-publish-actions">
          <button
            type="button"
            disabled={publishing}
            onClick={onClose}
            className="arena-outline"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={publishing || (isCustom ? !customGameName.trim() : selectedGameId === 'codm')}
            onClick={submitPublish}
            className="arena-primary"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>{publishing ? 'Publishing…' : 'Publish Bracket'}</span>
          </button>
        </div>
    </Modal>
  );
};
