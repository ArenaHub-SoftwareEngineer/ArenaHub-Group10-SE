import React, { useState, useRef, useEffect } from 'react';
import { BracketDraft, Match, Team, MatchFormat, MATCH_FORMATS, seriesWinsNeeded } from '../../lib/types';
import { validateScore } from '../../lib/integrityChecks';
import { aiService } from '../../lib/ai';
import { firestoreService } from '../../lib/firestore';
import { CleanFormattedText } from '../common/CleanFormattedText';
import { TournamentStageBoard } from '../common/TournamentStageBoard';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Modal } from '../ui/Modal';
import { StreamScheduleEditor } from './StreamScheduleEditor';
import { publicationGameKey } from '../../lib/bracketPublication';
import { scheduleDate, timeOrder } from '../../lib/calendar';
import { SuccessDialog } from '../ui/SuccessDialog';
import { useToast } from '../ui/Toast';
import { Req } from '../ui/Req';
import {
  BracketGenerationFeedbackModal,
  GenerationFeedbackData,
} from './BracketGenerationFeedbackModal';
import {
  extractTeamsFromPrompt,
  extractTournamentTitle,
  createBracketFromTeams,
  createPrebuiltManualBracket,
  updateMatchAndAdvance,
  parseTeamsFromCSV,
  MAX_BRACKET_TEAMS,
  detectTournamentSizeFromPrompt,
  ExtractedTeam,
} from '../../lib/bracketUtils';
import {
  Sparkles,
  Upload,
  Grid,
  Check,
  Trash2,
  X,
  Plus,
  Trophy,
  Users,
  Edit2,
  CheckCircle2,
  Layers,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  LoaderCircle,
  FileText,
  Save,
} from '../ui/Icons';

// ── Types ────────────────────────────────────────────────────────────────────

type BracketFormat = 'Single Elimination' | 'Double Elimination' | 'Round Robin';
type SeedingRule = 'Win Rate' | 'Skill Rating' | 'Random Draw';

function getBracketSyncErrorMessage(error: unknown, action: 'Saved' | 'Published' | 'Unpublished'): string {
  const details = error && typeof error === 'object'
    ? `${'code' in error ? String(error.code) : ''} ${'message' in error ? String(error.message) : ''}`.toLowerCase()
    : String(error || '').toLowerCase();

  if (details.includes('unauthenticated') || details.includes('not signed in')) {
    return `${action} on this device, but live sync requires an active sign-in. Sign in again and retry.`;
  }
  if (details.includes('permission-denied') || details.includes('missing or insufficient permissions')) {
    return `${action} on this device, but Firebase denied the write. Sign in again with an admin account and retry.`;
  }
  if (details.includes('resource-exhausted') || details.includes('too large')) {
    return `${action} on this device, but the cloud bracket storage limit was reached. Remove an older published bracket and retry.`;
  }
  if (details.includes('unavailable') || details.includes('network') || details.includes('offline')) {
    return `${action} on this device, but Firebase is currently unreachable. Check the connection and retry.`;
  }
  return `${action} on this device, but live sync failed. Retry, then check the browser console for the Firebase error.`;
}

interface StreamMessage {
  id: string;
  sender: 'assistant' | 'user';
  text: string;
}



// ── Constants for Horizontal Tree Layout ──────────────────────────────────────
const CARD_WIDTH = 210;
const CARD_HEIGHT = 74;
const BASE_GAP = 28;
const CONNECTOR_WIDTH = 40;
const BRACKET_LINE_COLOR = '#606672';

function getMatchCenterY(roundIdx: number, matchIdx: number): number {
  const slotHeight = CARD_HEIGHT + BASE_GAP;
  const factor = Math.pow(2, roundIdx);
  const offset = ((factor - 1) * slotHeight) / 2;
  return offset + matchIdx * factor * slotHeight + CARD_HEIGHT / 2;
}

// ── Match Info Modal (matches Screenshot 2) ───────────────────────────────────

interface MatchInfoModalProps {
  match: Match | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  onUpdateTeamName: (matchId: string, teamSlot: 1 | 2, newName: string) => void;
  onScoreChange: (matchId: string, teamSlot: 1 | 2, delta: number) => void;
}

const MatchInfoModal: React.FC<MatchInfoModalProps> = ({
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
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#888888] px-1">
            <span>PARTICIPANTS</span>
            <span>SCORE</span>
          </div>

          <div className="space-y-2">
            {/* Team 1 Row */}
            <div className="flex items-center justify-between p-2.5 rounded-[5px] bg-[#1e1e1e] border border-[#333333]">
              <div className="match-slot-fields flex flex-wrap items-center gap-2 flex-1 min-w-0 pr-3">
                <span className="w-5 h-5 rounded-[3px] bg-[#333333] text-[10px] font-bold text-[#aaaaaa] flex items-center justify-center shrink-0">
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
                  className="min-w-0 flex-1 bg-[#191919] border border-[#383838] focus:border-[#ff6600] rounded-[3px] px-2.5 py-1 text-xs font-semibold text-white outline-none transition-colors"
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
                  className="w-6 h-6 rounded-[3px] bg-[#333333] hover:bg-[#3a3a3a] text-xs text-white font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  -
                </button>
                <span className="w-7 text-center text-sm font-bold text-white tabular-nums">
                  {s1}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${match.team1?.name || 'Team 1'} score`}
                  disabled={isByeMatch}
                  onClick={() => onScoreChange(match.id, 1, 1)}
                  className="w-6 h-6 rounded-[3px] bg-[#333333] hover:bg-[#3a3a3a] text-xs text-white font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* Team 2 Row */}
            <div className="flex items-center justify-between p-2.5 rounded-[5px] bg-[#1e1e1e] border border-[#333333]">
              <div className="match-slot-fields flex flex-wrap items-center gap-2 flex-1 min-w-0 pr-3">
                <span className="w-5 h-5 rounded-[3px] bg-[#333333] text-[10px] font-bold text-[#aaaaaa] flex items-center justify-center shrink-0">
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
                  className="min-w-0 flex-1 bg-[#191919] border border-[#383838] focus:border-[#ff6600] rounded-[3px] px-2.5 py-1 text-xs font-semibold text-white outline-none transition-colors"
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
                  className="w-6 h-6 rounded-[3px] bg-[#333333] hover:bg-[#3a3a3a] text-xs text-white font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  -
                </button>
                <span className="w-7 text-center text-sm font-bold text-white tabular-nums">
                  {s2}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${match.team2?.name || 'Team 2'} score`}
                  disabled={isByeMatch}
                  onClick={() => onScoreChange(match.id, 2, 1)}
                  className="w-6 h-6 rounded-[3px] bg-[#333333] hover:bg-[#3a3a3a] text-xs text-white font-bold flex items-center justify-center cursor-pointer transition-colors"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[#333333] bg-[#202020]">
          <span className="text-[10px] text-[#777777]">
            Select or type BYE to advance the other team.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-[4px] border border-[#3a3a3a] text-[#aaaaaa] hover:text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              className="px-4 py-1.5 rounded-[4px] bg-[#ff6600] hover:bg-[#e65c00] text-black text-xs font-bold transition-colors cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
    </Modal>
  );
};

// ── Manual Bracket Setup Modal (Quick Pop-Up) ────────────────────────────────

interface ManualBracketSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceed: (config: {
    title: string;
    format: BracketFormat;
    matchFormat: MatchFormat;
    teamCount: number;
  }) => void;
}

const ManualBracketSetupModal: React.FC<ManualBracketSetupModalProps> = ({
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
            <label className="block text-[11px] font-semibold text-[#888888] uppercase tracking-wider mb-1.5">
              Bracket Name
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. WMSU Palaro 2026 - MLBB"
              className="w-full bg-[#191919] border border-[#333333] focus:border-[#ff6600] rounded-[4px] px-3 py-2 text-xs text-white placeholder-[#555566] outline-none transition-colors font-medium"
            />
          </div>

          {/* Bracket Format */}
          <div>
            <label className="block text-[11px] font-semibold text-[#888888] uppercase tracking-wider mb-2">
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
                        ? 'bg-[#ff6600]/10 border-[#ff6600] text-[#ff6600]'
                        : 'bg-[#181818] border-[#333333] text-[#888888] hover:text-white hover:border-[#444]'
                    }`}
                  >
                    <span className="block font-bold text-xs">{f}</span>
                    <span className="text-[10px] opacity-60">
                      {f === 'Single Elimination' ? '1 loss and out' : f === 'Double Elimination' ? 'Upper, lower, and reset final' : 'Every team plays every opponent'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Match Format */}
          <div>
            <label className="block text-[11px] font-semibold text-[#888888] uppercase tracking-wider mb-2">
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
                        ? 'bg-[#ff6600]/10 border-[#ff6600] text-[#ff6600]'
                        : 'bg-[#181818] border-[#333333] text-[#888888] hover:text-white hover:border-[#444]'
                    }`}
                  >
                    <span className="font-bold text-xs block">{mf}</span>
                    <span className="text-[9px] opacity-60">
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
              <label className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                Number of Teams<Req />
              </label>
              <span className="text-[10px] text-[#3DD68C] font-semibold">
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
              className="w-full bg-[#191919] border border-[#3A3E50] focus:border-[#ff6600] rounded-[4px] px-3 py-2 text-sm font-semibold text-white outline-none"
            />
            <p id="manual-team-count-feedback" className={`mt-2 text-[11px] ${teamCount !== '' && !validTeamCount ? 'text-[#E8544B]' : 'text-[#888888]'}`} role="status">
              {teamCount !== '' && !validTeamCount ? `Enter a whole number from 2 to ${formatTeamLimit}.` : format === 'Round Robin' ? 'Every team meets each opponent once, with one fixture per team per round.' : 'Your count determines the full bracket and any earned BYEs.'}
            </p>

            {validTeamCount && format !== 'Round Robin' && <div className="p-2.5 rounded-[4px] bg-[#181922] border border-[#333333] text-[11px] text-[#888888]">
              {parsedTeamCount % 2 === 0 && (parsedTeamCount & (parsedTeamCount - 1)) === 0 ? (
                <span>Perfect balanced bracket: <strong>{teamCount} teams</strong> play in a power-of-2 tournament with no byes needed.</span>
              ) : (
                <span>
                  Automatic BYE seeding active: With <strong>{teamCount} teams</strong>, the top{' '}
                  <strong className="text-[#ff6600]">
                    {Math.pow(2, Math.ceil(Math.log2(parsedTeamCount))) - parsedTeamCount}
                  </strong>{' '}
                  seeds automatically receive earned BYEs directly into the next round.
                </span>
              )}
            </div>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#333333] bg-[#202020]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[4px] bg-[#2a2a2a] hover:bg-[#353535] text-white text-xs font-semibold cursor-pointer transition-colors"
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
            className="px-5 py-2 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] text-black text-xs font-bold flex items-center gap-2 shadow-md cursor-pointer transition-colors"
          >
            <span>Proceed to Preview</span>
            <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>
    </Modal>
  );
};

// ── Publish Bracket to Game Modal ─────────────────────────────────────────────
interface PublishBracketModalProps {
  isOpen: boolean;
  draft: BracketDraft | null;
  onClose: () => void;
  onConfirm: (gameName: string, gameId: string) => Promise<void>;
}

const PRESET_GAMES = [
  { id: 'game-mlbb', name: 'Mobile Legends: Bang Bang', image: '/fairplay-mlbb.webp' },
  { id: 'game-dota2', name: 'Dota 2', image: '/fairplay-dota2.jpg' },
  { id: 'codm', name: 'Call of Duty: Mobile', image: '/fairplay-codm.webp' },
];
const CODM_MODES = [
  { id: 'game-codm-mp', name: 'Call of Duty: Mobile Multiplayer', label: 'Multiplayer' },
  { id: 'game-codm-br', name: 'Call of Duty: Mobile Battle Royale', label: 'Battle Royale' },
];

const PublishBracketModal: React.FC<PublishBracketModalProps> = ({
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
    <Modal open={isOpen} title="Publish bracket" description="Ready to publish live? Choose a game and review the bracket and schedule. Publishing replaces the live version for the selected game or mode." className="studio-publish" onClose={onClose} busy={publishing}>
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
              {codmMode?.id === 'game-codm-br' && <p className="module-notice">This publishes the bracket and schedule under Battle Royale. The bracket still uses head-to-head match results. Lobby placement scoring is unavailable.</p>}
            </div>}

            {/* Custom Game toggle */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setIsCustom(!isCustom)}
                className={`text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                  isCustom ? 'text-[#ff6600]' : 'text-[#888888] hover:text-white'
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
                  className="mt-2 w-full bg-[#191919] border border-[#333333] focus:border-[#ff6600] rounded-[4px] px-3 py-2 text-xs text-white placeholder-[#555566] outline-none"
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
            <span>{publishing ? 'Publishing…' : 'Confirm and publish'}</span>
          </button>
        </div>
    </Modal>
  );
};

// ── Horizontal Bracket Tree Component ─────────────────────────────────────────

function canEditRoundFormat(matches: Match[]): boolean {
  return matches.every(match => [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE')
    || (['upcoming', 'pre-match'].includes(match.status)
      && !match.winnerId && match.score.team1Score === 0 && match.score.team2Score === 0));
}

interface HorizontalBracketTreeProps {
  onRoundFormatChange: (round: number, format: MatchFormat) => void;
  draft: BracketDraft;
  selectedMatchId: string | null;
  onSelectMatch: (match: Match) => void;
  onUpdateTeamName: (matchId: string, teamSlot: 1 | 2, newName: string) => void;
  onScoreChange: (matchId: string, teamSlot: 1 | 2, delta: number) => void;
}

const HorizontalBracketTree: React.FC<HorizontalBracketTreeProps> = ({
  draft,
  selectedMatchId,
  onSelectMatch,
  onUpdateTeamName,
  onScoreChange,
  onRoundFormatChange,
}) => {
  const maxRound = Math.max(...draft.matches.map((m) => m.round), 1);
  if (draft.matches[0]?.tournamentFormat) return <TournamentStageBoard matches={draft.matches} onSelectMatch={onSelectMatch} onScoreChange={onScoreChange} onRoundFormatChange={onRoundFormatChange} onUpdateTeamName={onUpdateTeamName} />;
  const rounds: Match[][] = [];
  for (let r = 1; r <= maxRound; r++) {
    rounds.push(draft.matches.filter((m) => m.round === r));
  }

  const finalMatch = rounds[rounds.length - 1]?.[0];
  const championTeam = finalMatch?.status === 'completed'
    ? [finalMatch.team1, finalMatch.team2].find(team => team && team.id === finalMatch.winnerId)
      ?? (finalMatch.score.team2Score > finalMatch.score.team1Score ? finalMatch.team2 : finalMatch.team1)
    : undefined;

  const round1Count = rounds[0]?.length || 1;
  const totalTreeHeight = Math.max(round1Count * (CARD_HEIGHT + BASE_GAP) + 30, 380);

  return (
    <div className="studio-tree w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Tournament bracket. Scroll horizontally to see more rounds.">
      <div
        className="flex items-start min-w-max px-2 relative"
        style={{ height: `${totalTreeHeight}px` }}
      >
        {rounds.map((roundMatches, roundIdx) => {
          const isGrandFinal = roundIdx === rounds.length - 1;
          const roundName = roundMatches[0]?.roundName || `Round ${roundIdx + 1}`;
          const currentFmt = roundMatches[0]?.matchFormat || (isGrandFinal ? 'Bo5' : 'Bo3');

          return (
            <React.Fragment key={roundIdx}>
              {/* Column for this Round */}
              <div
                className="flex flex-col relative shrink-0"
                style={{ width: `${CARD_WIDTH}px`, height: `${totalTreeHeight}px` }}
              >
                {/* Round Header */}
                <div className="absolute -top-1 left-0 right-0 z-10 flex items-center justify-between pb-1 border-b border-[#2C2C30] text-[10px] font-bold uppercase tracking-wider">
                  <span className={isGrandFinal ? 'text-[#ff6600]' : 'text-[#888888]'}>
                    {roundName}
                  </span>
                  <select
                    className="studio-round-format"
                    aria-label={`Series format for ${roundName}`}
                    title={canEditRoundFormat(roundMatches) ? 'Change series format' : 'This round already has a match in progress or a result'}
                    value={currentFmt}
                    disabled={!canEditRoundFormat(roundMatches)}
                    onChange={event => onRoundFormatChange(roundIdx + 1, event.target.value as MatchFormat)}
                  >
                    {MATCH_FORMATS.map(format => <option key={format} value={format}>{format}</option>)}
                  </select>
                </div>

                {/* Match Cards */}
                {roundMatches.map((match, matchIdx) => {
                  const centerY = getMatchCenterY(roundIdx, matchIdx);
                  const topY = centerY - CARD_HEIGHT / 2 + 24;

                  const isSelected = selectedMatchId === match.id;
                  const team1Bye = match.team1?.isBye || match.team1?.name === 'BYE';
                  const team2Bye = match.team2?.isBye || match.team2?.name === 'BYE';
                  const isByeMatch = team1Bye || team2Bye;
                  const t1Name = match.team1?.name ?? (roundIdx === 0 ? `Team ${matchIdx * 2 + 1}` : 'TBD');
                  const t2Name = team2Bye ? 'BYE' : (match.team2?.name ?? (roundIdx === 0 ? `Team ${matchIdx * 2 + 2}` : 'TBD'));
                  const t1Seed = match.team1?.seed ?? matchIdx * 2 + 1;
                  const t2Seed = match.team2?.seed ?? matchIdx * 2 + 2;

                  const s1 = match.score.team1Score;
                  const s2 = match.score.team2Score;
                  const t1Winning = (s1 > s2 && s1 > 0) || team2Bye;
                  const t2Winning = (s2 > s1 && s2 > 0) || team1Bye;

                  return (
                    <div
                      key={match.id}
                      onClick={() => onSelectMatch(match)}
                      className={`absolute left-0 right-0 rounded-[6px] border bg-[#202024] shadow-md transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#ff6600] ring-2 ring-[#ff6600]/40 bg-[#242424]'
                          : isGrandFinal
                          ? 'border-[#ff6600]/60 bg-[#1D1E16] shadow-[#ff6600]/10 shadow-lg'
                          : 'border-[#333338] hover:border-[#4C4C55]'
                      }`}
                      style={{ top: `${topY}px`, height: `${CARD_HEIGHT}px` }}
                    >
                      {/* Team 1 Row */}
                      <div className="flex items-center justify-between h-[36px] px-2 border-b border-[#2A2A2E]">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                          <span className="w-4 h-4 rounded-[3px] bg-[#2A2A30] text-[9px] font-bold text-[#888888] flex items-center justify-center shrink-0">
                            {t1Seed}
                          </span>
                          <input
                            type="text"
                            value={t1Name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => onUpdateTeamName(match.id, 1, e.target.value)}
                            title="Click to edit team name"
                            className={`w-full bg-transparent px-1 py-0.5 rounded text-xs font-semibold truncate outline-none transition-colors ${
                              t1Winning
                                ? 'text-[#ff6600] font-bold'
                                : 'text-white hover:bg-[#18181A] focus:bg-[#141416] focus:ring-1 focus:ring-[#ff6600]'
                            }`}
                          />
                        </div>

                        {/* Score or BYE advance tag */}
                        {team2Bye ? (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-[#3DD68C]/20 border border-[#3DD68C]/40 text-[9px] font-bold text-[#3DD68C] uppercase shrink-0">
                            ADVANCED
                          </span>
                        ) : !team1Bye && (
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              aria-label={`Decrease ${match.team1?.name || 'Team 1'} score`}
                  onClick={() => onScoreChange(match.id, 1, -1)}
                              className="w-4 h-4 rounded-[2px] bg-[#2A2A30] hover:bg-[#383842] text-[10px] text-[#888888] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                            >
                              -
                            </button>
                            <span
                              className={`w-5 text-center text-xs font-bold tabular-nums ${
                                t1Winning ? 'text-[#ff6600]' : 'text-white'
                              }`}
                            >
                              {s1}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${match.team1?.name || 'Team 1'} score`}
                  onClick={() => onScoreChange(match.id, 1, 1)}
                              className="w-4 h-4 rounded-[2px] bg-[#2A2A30] hover:bg-[#383842] text-[10px] text-[#888888] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Team 2 Row */}
                      <div className="flex items-center justify-between h-[36px] px-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                          <span className="w-4 h-4 rounded-[3px] bg-[#2A2A30] text-[9px] font-bold text-[#888888] flex items-center justify-center shrink-0">
                            {t2Seed}
                          </span>
                          {team2Bye ? (
                            <span className="text-xs text-[#80859A] font-semibold uppercase text-[10px] tracking-wider px-1">
                              BYE (Automatic Advance)
                            </span>
                          ) : (
                            <input
                              type="text"
                              value={t2Name}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => onUpdateTeamName(match.id, 2, e.target.value)}
                              title="Click to edit team name"
                              className={`w-full bg-transparent px-1 py-0.5 rounded text-xs font-semibold truncate outline-none transition-colors ${
                                t2Winning
                                  ? 'text-[#ff6600] font-bold'
                                  : 'text-white hover:bg-[#18181A] focus:bg-[#141416] focus:ring-1 focus:ring-[#ff6600]'
                              }`}
                            />
                          )}
                        </div>

                        {/* Score and +/- buttons */}
                        {team1Bye && <span className="px-1.5 py-0.5 rounded-[2px] bg-[#3DD68C]/20 border border-[#3DD68C]/40 text-[9px] font-bold text-[#3DD68C] uppercase shrink-0">Advanced</span>}
                        {!isByeMatch && (
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              aria-label={`Decrease ${match.team2?.name || 'Team 2'} score`}
                  onClick={() => onScoreChange(match.id, 2, -1)}
                              className="w-4 h-4 rounded-[2px] bg-[#2A2A30] hover:bg-[#383842] text-[10px] text-[#888888] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                            >
                              -
                            </button>
                            <span
                              className={`w-5 text-center text-xs font-bold tabular-nums ${
                                t2Winning ? 'text-[#ff6600]' : 'text-white'
                              }`}
                            >
                              {s2}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${match.team2?.name || 'Team 2'} score`}
                  onClick={() => onScoreChange(match.id, 2, 1)}
                              className="w-4 h-4 rounded-[2px] bg-[#2A2A30] hover:bg-[#383842] text-[10px] text-[#888888] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* SVG Bracket Connector lines */}
              {roundIdx < rounds.length - 1 && (
                <div
                  className="relative shrink-0"
                  style={{ width: `${CONNECTOR_WIDTH}px`, height: `${totalTreeHeight}px` }}
                >
                  <svg
                    className="absolute inset-0 pointer-events-none"
                    width={CONNECTOR_WIDTH}
                    height={totalTreeHeight}
                  >
                    {rounds[roundIdx + 1].map((_, nextMatchIdx) => {
                      const topCenterY = getMatchCenterY(roundIdx, nextMatchIdx * 2) + 24;
                      const botCenterY = getMatchCenterY(roundIdx, nextMatchIdx * 2 + 1) + 24;
                      const childCenterY = getMatchCenterY(roundIdx + 1, nextMatchIdx) + 24;
                      const midX = CONNECTOR_WIDTH / 2;

                      return (
                        <g key={nextMatchIdx}>
                          <path
                            d={`M 0 ${topCenterY} H ${midX}`}
                            stroke={BRACKET_LINE_COLOR}
                            strokeWidth="2"
                            fill="none"
                          />
                          <path
                            d={`M 0 ${botCenterY} H ${midX}`}
                            stroke={BRACKET_LINE_COLOR}
                            strokeWidth="2"
                            fill="none"
                          />
                          <path
                            d={`M ${midX} ${topCenterY} V ${botCenterY}`}
                            stroke={BRACKET_LINE_COLOR}
                            strokeWidth="2"
                            fill="none"
                          />
                          <path
                            d={`M ${midX} ${childCenterY} H ${CONNECTOR_WIDTH}`}
                            stroke={BRACKET_LINE_COLOR}
                            strokeWidth="2"
                            fill="none"
                          />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* ── Champion Slot ── */}
        <div
          className="relative shrink-0"
          style={{ width: `${CONNECTOR_WIDTH}px`, height: `${totalTreeHeight}px` }}
          aria-hidden="true"
        >
          <svg
            className="absolute inset-0 pointer-events-none"
            width={CONNECTOR_WIDTH}
            height={totalTreeHeight}
          >
            <path
              d={`M 0 ${getMatchCenterY(rounds.length - 1, 0) + 24} H ${CONNECTOR_WIDTH}`}
              stroke={BRACKET_LINE_COLOR}
              strokeWidth="2"
              fill="none"
            />
            <circle
              cx={CONNECTOR_WIDTH}
              cy={getMatchCenterY(rounds.length - 1, 0) + 24}
              r="3"
              fill={championTeam ? '#F7B731' : BRACKET_LINE_COLOR}
            />
          </svg>
        </div>

        <div
          className="relative shrink-0"
          style={{ width: '150px', height: `${totalTreeHeight}px` }}
        >
          <div className="absolute top-0 left-0 right-0 z-10 pb-1 border-b border-[#2C2C30] text-[10px] font-bold uppercase tracking-wider text-[#F7B731]">
            Champion
          </div>

          {(() => {
            const finalCenterY = getMatchCenterY(rounds.length - 1, 0) + 24;
            const topY = finalCenterY - 40;

            return (
              <div
                className="absolute left-0 right-0 rounded-[6px] border border-[#F7B731]/40 bg-[#1D1A10] p-3 text-center shadow-lg shadow-[#F7B731]/10"
                style={{ top: `${topY}px` }}
              >
                <Trophy className="w-6 h-6 text-[#F7B731] mx-auto mb-1" />
                <span className="text-[10px] uppercase font-bold text-[#F7B731] block">
                  WINNER
                </span>
                <span className="text-xs font-bold text-white block truncate mt-0.5">
                  {championTeam?.name || 'TBD'}
                </span>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const BracketStudioView: React.FC<{ initialBracketId?: string | null }> = ({ initialBracketId }) => {
  const { showToast } = useToast();

  // Mode
  const [buildMode, setBuildMode] = useState<'prompt' | 'manual' | 'upload'>('prompt');

  // Bracket state
  const [currentDraft, setCurrentDraft] = useState<BracketDraft | null>(() => {
    if (initialBracketId) {
      const bracket = firestoreService.getPublishedBracketById(initialBracketId);
      if (bracket) return bracket;
    }
    try {
      const handoff = localStorage.getItem('arenahub_ai_bracket_handoff');
      if (handoff) {
        localStorage.removeItem('arenahub_ai_bracket_handoff');
        return JSON.parse(handoff) as BracketDraft;
      }
    } catch {
      // Continue with the persisted ArenaHub draft.
    }
    return firestoreService.getSavedBracketDraft();
  });
  const loadedBracket = useRef(currentDraft?.status === 'saved' || currentDraft?.status === 'published' ? currentDraft : null);
  const [drafts, setDrafts] = useState(() => firestoreService.getSavedBracketDrafts());
  const [bracketToLoad, setBracketToLoad] = useState<BracketDraft | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<BracketDraft | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [draftBeforeMatchEdit, setDraftBeforeMatchEdit] = useState<BracketDraft | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // Modals
  const [showManualModal, setShowManualModal] = useState(false);
  const [showConfirmProceed, setShowConfirmProceed] = useState(false);
  const [pendingManualConfig, setPendingManualConfig] = useState<{
    title: string;
    format: BracketFormat;
    matchFormat: MatchFormat;
    teamCount: number;
  } | null>(null);

  const [showConfirmPublish, setShowConfirmPublish] = useState(false);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [generationFeedback, setGenerationFeedback] = useState<GenerationFeedbackData | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  // CSV Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvRawText, setCsvRawText] = useState('');
  const [showCsvPaste, setShowCsvPaste] = useState(false);
  const [isRosterDragOver, setIsRosterDragOver] = useState(false);

  // AI Prompt Mode State
  const [bracketFormat, setBracketFormat] = useState<BracketFormat>('Single Elimination');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('Bo3');
  const [seedingRule, setSeedingRule] = useState<SeedingRule>('Win Rate');
  const [keepCollegesApart, setKeepCollegesApart] = useState(true);
  const [promptText, setPromptText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [isThinkingOpen, setIsThinkingOpen] = useState(true);
  const [generationActivity, setGenerationActivity] = useState<string[]>([]);
  const [generationSeconds, setGenerationSeconds] = useState(0);

  // AI Chat messages
  const [aiMessages, setAiMessages] = useState<StreamMessage[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages, streamingId]);

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = Date.now();
    setGenerationSeconds(0);
    const timer = window.setInterval(() => {
      setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  // ── AI Prompt Submit ──────────────────────────────────────────────────────
  const handleAIGenerate = async () => {
    const rawInput = promptText.trim();
    if (!rawInput) {
      showToast('Please type your tournament instructions or teams in the prompt box.', 'error');
      return;
    }
    const requestedCount = detectTournamentSizeFromPrompt(rawInput, 0);
    const listedCount = extractTeamsFromPrompt(rawInput).length;
    if (requestedCount > MAX_BRACKET_TEAMS || listedCount > MAX_BRACKET_TEAMS) {
      showToast(`Brackets support 2 to ${MAX_BRACKET_TEAMS} teams. Enter a smaller count or roster.`, 'error');
      return;
    }

    const userMsg: StreamMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: rawInput,
    };

    const assistantId = `a-${Date.now() + 1}`;
    const assistantPlaceholder: StreamMessage = {
      id: assistantId,
      sender: 'assistant',
      text: 'Analyzing tournament requirements and drafting bracket...',
    };

    setAiMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setStreamingId(assistantId);
    setIsGenerating(true);
    setIsThinkingOpen(true);
    setGenerationActivity([
      'Reading the requested format, roster, and match rules',
      'Checking the participant count and seed order',
    ]);

    try {
      // Extract the requested team count and roster from the prompt.
      const { draft, explanation } = await aiService.generateBracketFromPrompt(rawInput);

      setGenerationActivity((steps) => [
        ...steps,
        'Applying the standard seeded knockout placement',
        'Validating rounds, advancement paths, and required BYEs',
      ]);

      setAiMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: explanation }
            : m
        )
      );

      setCurrentDraft(draft);

      const treeSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(draft.teamsCount))));
      const byesCount = Math.max(0, treeSize - draft.teamsCount);
      setGenerationFeedback({
        source: 'ai',
        draft,
        teams: draft.teams,
        teamCount: draft.teamsCount,
        treeSize,
        byesCount,
        format: draft.format,
        matchFormat: draft.matchFormat || 'Bo3',
        explanation:
          explanation ||
          `Generated an ${draft.teamsCount}-team ${draft.format} tournament bracket based on your prompt.`,
      });
      showToast(
        `The rules engine generated a ${draft.teamsCount}-team ${draft.format} bracket.`,
        'success'
      );
    } catch {
      // Deterministic fallback
      setGenerationActivity((steps) => [
        ...steps,
        'Model response exceeded the fast limit; switched to ArenaHub rules',
        'Validated the connected bracket locally',
      ]);
      const draft = aiService.generateBracketDraft(rawInput);
      setCurrentDraft(draft);

      const treeSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(draft.teamsCount))));
      const byesCount = Math.max(0, treeSize - draft.teamsCount);
      const fallbackExplanation = `Generated a ${draft.teamsCount}-team ${draft.format} bracket accommodating all participants with standard competitive seeding.`;

      setAiMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                text: fallbackExplanation,
              }
            : m
        )
      );

      setGenerationFeedback({
        source: 'ai',
        draft,
        teams: draft.teams,
        teamCount: draft.teamsCount,
        treeSize,
        byesCount,
        format: draft.format,
        matchFormat: draft.matchFormat || 'Bo3',
        explanation: fallbackExplanation,
      });
      showToast(`Generated a ${draft.teamsCount}-team bracket.`, 'success');
    } finally {
      setIsGenerating(false);
      setStreamingId(null);
    }
  };

  // ── Manual Modal Flow ─────────────────────────────────────────────────────
  const handleManualProceed = (config: {
    title: string;
    format: BracketFormat;
    matchFormat: MatchFormat;
    teamCount: number;
  }) => {
    setPendingManualConfig(config);
    setShowManualModal(false);
    setShowConfirmProceed(true);
  };

  const handleConfirmCreateManual = () => {
    if (!pendingManualConfig) return;

    const draft = createPrebuiltManualBracket({
      title: pendingManualConfig.title,
      teamCount: pendingManualConfig.teamCount,
      format: pendingManualConfig.format,
      matchFormat: pendingManualConfig.matchFormat,
    });

    setCurrentDraft(draft);
    setShowConfirmProceed(false);
    setPendingManualConfig(null);
    showToast('Success! Prebuilt bracket created. Click any box to set team names.', 'success');
  };

  // ── CSV Upload & Parsing Flow ─────────────────────────────────────────────
  const processCsvContent = (content: string, fileName?: string) => {
    const teams = parseTeamsFromCSV(content);
    if (teams.length < 2) {
      showToast('Could not find enough teams in the CSV. Need at least 2 teams.', 'error');
      return false;
    }
    if (teams.length > MAX_BRACKET_TEAMS) {
      showToast(`The roster has ${teams.length} teams. The current bracket limit is ${MAX_BRACKET_TEAMS}.`, 'error');
      return false;
    }

    const title = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'WMSU CSV Roster Tournament';
    const draft = createBracketFromTeams({
      title,
      teams,
      gameName: 'Esports Tournament',
      format: 'Single Elimination',
      matchFormat: 'Bo3',
      explicitBracketSize: teams.length,
    });

    setCurrentDraft(draft);

    const treeSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(teams.length))));
    const byesCount = Math.max(0, treeSize - teams.length);
    const explanation = byesCount > 0
      ? `Parsed ${teams.length} teams from CSV into an ${treeSize}-slot bracket. The top ${byesCount} seed${byesCount > 1 ? 's' : ''} earned automatic Round 1 BYEs into Round 2.`
      : `Parsed ${teams.length} teams from CSV into a balanced ${treeSize}-slot bracket with full Round 1 matchups.`;

    setGenerationFeedback({
      source: 'csv',
      draft,
      teams: draft.teams,
      teamCount: teams.length,
      treeSize,
      byesCount,
      format: draft.format,
      matchFormat: draft.matchFormat || 'Bo3',
      explanation,
      fileName: fileName || 'CSV Roster',
    });
    setShowFeedbackModal(true);

    showToast(`Imported ${teams.length} teams. Review your bracket preview.`, 'success');
    return true;
  };

  const readRosterFile = async (file: File) => {
    try {
      processCsvContent(await file.text(), file.name);
    } catch {
      showToast('Could not read this roster file.', 'error');
    }
  };

  // ── Inline Team Name Edit ─────────────────────────────────────────────────
  const handleUpdateTeamName = (matchId: string, teamSlot: 1 | 2, newName: string) => {
    if (!currentDraft) return;

    const targetMatch = currentDraft.matches.find((m) => m.id === matchId);
    if (!targetMatch) return;

    const oldTeam = teamSlot === 1 ? targetMatch.team1 : targetMatch.team2;
    const otherTeam = teamSlot === 1 ? targetMatch.team2 : targetMatch.team1;
    const isBye = newName.trim().toUpperCase() === 'BYE';

    if (isBye && (!otherTeam?.name.trim() || otherTeam.isBye || otherTeam.name === 'BYE')) {
      showToast('A BYE needs one active team in the match to advance.', 'error');
      return;
    }

    const editableTeam: Team = isBye
      ? {
          id: oldTeam?.isBye ? oldTeam.id : `bye-${matchId}-${teamSlot}`,
          name: 'BYE',
          collegeId: 'bye',
          collegeCode: 'BYE',
          gameId: targetMatch.gameId,
          seed: oldTeam?.seed ?? 0,
          winRate: 0,
          record: '0W-0L',
          players: [],
          isBye: true,
        }
      : {
          ...(oldTeam && !oldTeam.isBye
            ? oldTeam
            : {
                id: `manual-${currentDraft.id}-${matchId}-${teamSlot}`,
                collegeId: 'manual-entry',
                collegeCode: 'TBD',
                gameId: targetMatch.gameId,
                seed: oldTeam?.seed ?? 0,
                winRate: 0,
                record: '0W-0L',
                players: [],
              }),
          name: newName,
          isBye: false,
        };

    const baseMatches = currentDraft.matches.map((match) => {
      if (!oldTeam || oldTeam.isBye || isBye) return match;
      return {
        ...match,
        team1: match.team1?.id === oldTeam.id ? { ...match.team1, name: newName } : match.team1,
        team2: match.team2?.id === oldTeam.id ? { ...match.team2, name: newName } : match.team2,
      };
    });

    const editedTarget = baseMatches.find((match) => match.id === matchId) || targetMatch;
    const updatedTarget: Match = {
      ...editedTarget,
      ...(teamSlot === 1 ? { team1: editableTeam } : { team2: editableTeam }),
      ...(isBye
        ? {
            score: teamSlot === 1
              ? { team1Score: 0, team2Score: 1 }
              : { team1Score: 1, team2Score: 0 },
            status: 'completed' as const,
            winnerId: otherTeam?.id,
            scheduledTime: 'Automatic Advance',
          }
        : oldTeam?.isBye
        ? {
            score: { team1Score: 0, team2Score: 0 },
            status: 'upcoming' as const,
            winnerId: undefined,
            scheduledTime: editedTarget.roundName,
          }
        : {}),
    };

    const updatedMatches = updateMatchAndAdvance(baseMatches, updatedTarget);
    const rosterById = new Map<string, Team>();
    updatedMatches
      .filter((match) => match.round === 1 || match.tournamentFormat === 'round-robin')
      .forEach((match) => {
        [match.team1, match.team2].forEach((team) => {
          if (team && !team.isBye && team.name.trim()) rosterById.set(team.id, team);
        });
      });
    const roster = Array.from(rosterById.values()).sort((a, b) => a.seed - b.seed);

    setCurrentDraft({
      ...currentDraft,
      matches: updatedMatches,
      teamsCount: roster.length,
      teams: roster.map((team) => ({
        name: team.name,
        college: team.collegeCode === 'TBD' ? undefined : team.collegeCode,
        seed: team.seed,
      })),
    });

    if (selectedMatch?.id === matchId) {
      setSelectedMatch(updatedMatches.find((match) => match.id === matchId) || null);
    }
  };

  const handleOpenMatchEditor = (match: Match) => {
    setDraftBeforeMatchEdit(currentDraft);
    setSelectedMatch(match);
  };

  const handleCancelMatchEdit = () => {
    if (draftBeforeMatchEdit) setCurrentDraft(draftBeforeMatchEdit);
    setDraftBeforeMatchEdit(null);
    setSelectedMatch(null);
    showToast('Match edit cancelled. No changes were saved.', 'info');
  };

  const handleRequestMatchSave = () => {
    setDraftBeforeMatchEdit(null);
    setSelectedMatch(null);
    setShowConfirmSave(true);
  };

  const handleRoundFormatChange = (round: number, format: MatchFormat) => {
    setCurrentDraft(draft => {
      if (!draft || !canEditRoundFormat(draft.matches.filter(match => match.round === round))) return draft;
      return {
        ...draft,
        matchFormat: round === 1 ? format : draft.matchFormat,
        matches: draft.matches.map(match => match.round === round ? { ...match, matchFormat: format } : match),
      };
    });
  };

  // ── Score & Advancement ───────────────────────────────────────────────────
  const handleScoreChange = (matchId: string, teamSlot: 1 | 2, delta: number) => {
    if (!currentDraft) return;

    const match = currentDraft.matches.find((m) => m.id === matchId);
    if (!match || !match.team1 || !match.team2 || match.inactive || [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE')) return;

    const newScore1 =
      teamSlot === 1
        ? Math.max(0, match.score.team1Score + delta)
        : match.score.team1Score;
    const newScore2 =
      teamSlot === 2
        ? Math.max(0, match.score.team2Score + delta)
        : match.score.team2Score;

    try { validateScore(match.matchFormat, newScore1, newScore2); }
    catch (error) { showToast(error instanceof Error ? error.message : 'Invalid score.', 'error'); return; }
    const winsNeeded = seriesWinsNeeded(match.matchFormat);
    const winningTeam =
      newScore1 >= winsNeeded && newScore1 > newScore2
        ? match.team1
        : newScore2 >= winsNeeded && newScore2 > newScore1
        ? match.team2
        : undefined;

    const updatedMatch: Match = {
      ...match,
      score: { team1Score: newScore1, team2Score: newScore2 },
      status: winningTeam ? 'completed' : newScore1 > 0 || newScore2 > 0 ? 'live' : 'upcoming',
      winnerId: winningTeam?.id,
    };

    const updatedMatches = updateMatchAndAdvance(currentDraft.matches, updatedMatch);

    setCurrentDraft({
      ...currentDraft,
      matches: updatedMatches,
    });

    if (selectedMatch?.id === matchId) {
      setSelectedMatch(updatedMatch);
    }
  };

  const [publishedBrackets, setPublishedBrackets] = useState<BracketDraft[]>(() =>
    firestoreService.getPublishedBrackets()
  );
  const [showPublishGameModal, setShowPublishGameModal] = useState(false);
  const [publishedGame, setPublishedGame] = useState<string | null>(null);
  const [bracketToUnpublish, setBracketToUnpublish] = useState<BracketDraft | null>(null);

  const [previousVersions, setPreviousVersions] = useState(firestoreService.getPreviousPublishedBrackets());
  const [versionToRestore, setVersionToRestore] = useState<BracketDraft | null>(null);

  useEffect(() => firestoreService.subscribe(() => {
    setPublishedBrackets(firestoreService.getPublishedBrackets());
    setPreviousVersions(firestoreService.getPreviousPublishedBrackets());
    setDrafts(firestoreService.getSavedBracketDrafts());
  }), []);

  useEffect(() => {
    const handleRestoreShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== 'z' || event.repeat
        || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], dialog'))
        || document.querySelector('dialog[open]')) return;
      const version = previousVersions.find(bracket => currentDraft && publicationGameKey(bracket) === publicationGameKey(currentDraft))
        ?? (previousVersions.length === 1 ? previousVersions[0] : undefined);
      if (!version) return;
      event.preventDefault();
      setVersionToRestore(version);
    };
    window.addEventListener('keydown', handleRestoreShortcut);
    return () => window.removeEventListener('keydown', handleRestoreShortcut);
  }, [currentDraft, previousVersions]);

  const performSaveBracket = () => {
    if (!currentDraft) return;
    setShowConfirmSave(false);
    const saved = firestoreService.saveBracketDraft(currentDraft);
    loadedBracket.current = saved;
    setCurrentDraft(saved);
    showToast(`Bracket "${saved.title}" saved as a draft on this device.`, 'success');
  };

  const handleSaveBracket = () => {
    if (currentDraft) setShowConfirmSave(true);
  };

  const handleConfirmPublishToGame = async (gameName: string, gameId: string) => {
    if (!currentDraft) throw new Error('Load a bracket before publishing.');
    const published = await firestoreService.publishBracket(currentDraft, gameName, gameId);
    loadedBracket.current = published;
    setCurrentDraft(published);
    setShowPublishGameModal(false);
    setPublishedGame(gameName);
  };

  const handleRestoreVersion = async () => {
    if (!versionToRestore) return;
    const restored = await firestoreService.restorePublishedBracket(versionToRestore);
    setVersionToRestore(null);
    showToast(`Previous bracket and schedule restored for ${restored.gameName}.`, 'success');
  };

  const handleUnpublishBracket = async (bracket: BracketDraft) => {
    firestoreService.deletePublishedBracket(bracket.id);
    try {
      await firestoreService.syncBracketsToCloud();
    } catch (error) {
      console.error('[ArenaHub] Bracket unpublish sync failed:', error);
      showToast(getBracketSyncErrorMessage(error, 'Unpublished'), 'error');
      return;
    }
    setPublishedBrackets(firestoreService.getPublishedBrackets());
    setBracketToUnpublish(null);
    showToast(`Bracket "${bracket.title}" unpublished.`, 'info');
  };

  const loadBracket = (bracket: BracketDraft) => {
    loadedBracket.current = bracket;
    setSelectedMatch(null);
    setDraftBeforeMatchEdit(null);
    setIsEditingTitle(false);
    setCurrentDraft(bracket);
    setBracketToLoad(null);
  };

  const deletingOpenDraft = draftToDelete !== null && loadedBracket.current?.status === 'saved'
    && loadedBracket.current.id === draftToDelete.id && currentDraft?.id === draftToDelete.id;

  function deleteDraft() {
    if (!draftToDelete) return;
    firestoreService.deleteSavedBracketDraft(draftToDelete.id);
    if (deletingOpenDraft) {
      loadedBracket.current = null;
      setCurrentDraft(null);
      setSelectedMatch(null);
      setDraftBeforeMatchEdit(null);
      setIsEditingTitle(false);
    }
    setDraftToDelete(null);
    showToast('Saved draft deleted.', 'success');
  }

  const requestBracket = (bracket: BracketDraft) => {
    if (currentDraft && currentDraft !== loadedBracket.current) {
      setBracketToLoad(bracket);
      return;
    }
    loadBracket(bracket);
  };

  // ── Discard Draft ─────────────────────────────────────────────────────────
  const handleDiscardDraft = () => {
    loadedBracket.current = null;
    setCurrentDraft(null);
    setSelectedMatch(null);
    setShowConfirmDiscard(false);
    showToast('Canvas cleared.', 'info');
  };

  // ── Helper ────────────────────────────────────────────────────────────────
  const ChoiceBtn = <T extends string>({
    value,
    current,
    onSelect,
    label,
    desc,
  }: {
    value: T;
    current: T;
    onSelect: (v: T) => void;
    label: string;
    desc?: string;
  }) => {
    const active = value === current;
    return (
      <button
        type="button"
        onClick={() => onSelect(value)}
        className={`flex-1 flex flex-col items-center justify-center py-2.5 px-2 rounded-[6px] border text-center transition-all cursor-pointer ${
          active
            ? 'bg-[#ff6600]/10 border-[#ff6600]/60 text-[#ff6600]'
            : 'bg-[#1A1A1A] border-[#2D2D2D] text-[#888888] hover:border-[#444444] hover:text-white'
        }`}
      >
        <span className={`text-xs font-bold ${active ? 'text-[#ff6600]' : ''}`}>{label}</span>
        {desc && <span className="text-[9px] opacity-60 mt-0.5">{desc}</span>}
      </button>
    );
  };

  return (
    <div className="bracket-studio space-y-6">
      {/* ── Top Header ── */}
      <header className="studio-header">
        <div>
          <h1>Bracket Studio</h1>
          <p>Create a tournament bracket, edit matches, and publish it for spectators.</p>
        </div>

        <div className="studio-actions">
          <button
            onClick={() => currentDraft && setShowConfirmDiscard(true)}
            disabled={!currentDraft}
            className="arena-outline"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear canvas</span>
          </button>

          {/* Feedback & Specs Inspector Button */}
          <button
            onClick={() => {
              if (!currentDraft) return;
              const treeSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(currentDraft.teamsCount))));
              const byesCount = Math.max(0, treeSize - currentDraft.teamsCount);
              setGenerationFeedback({
                source: 'ai',
                draft: currentDraft,
                teams: currentDraft.teams || [],
                teamCount: currentDraft.teamsCount,
                treeSize,
                byesCount,
                format: currentDraft.format,
                matchFormat: currentDraft.matchFormat || 'Bo3',
                explanation: `Active tournament bracket with ${currentDraft.teamsCount} teams accommodated in an ${treeSize}-slot tree.`,
              });
              setShowFeedbackModal(true);
            }}
            disabled={!currentDraft}
            className="arena-outline"
            title="Inspect bracket specifications & feedback module"
          >
            <FileText size={16} />
            <span>Bracket details</span>
          </button>

          {/* Dedicated Save Bracket Button */}
          <button
            onClick={handleSaveBracket}
            disabled={!currentDraft}
            className="arena-outline"
            title="Save the draft on this device"
          >
            <Save size={16} />
            <span>Save draft</span>
          </button>

          <button
            onClick={() => currentDraft && setShowPublishGameModal(true)}
            disabled={!currentDraft}
            className="arena-primary"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>Publish bracket</span>
          </button>
        </div>
      </header>

      <details className="studio-builder">
        <summary><span><strong>Saved drafts ({drafts.length})</strong><small>Open a roster and bracket saved in this browser.</small></span><ChevronDown size={18} /></summary>
        <div className="studio-builder-body studio-bracket-library">
          {drafts.length === 0 && <p className="studio-muted">Use Save draft to keep a bracket and its team roster here.</p>}
          {drafts.map(draft => <div key={draft.id} className="studio-bracket-library-row">
            <span><strong>{draft.title}</strong><small>{draft.gameName} · {draft.teamsCount} teams</small></span>
            <button type="button" className="arena-outline" onClick={() => requestBracket(draft)}>Open draft</button>
            <button type="button" className="arena-outline studio-delete-draft" onClick={() => setDraftToDelete(draft)}>Delete draft</button>
          </div>)}
        </div>
      </details>

      <details className="studio-builder">
        <summary><span><strong>Live published brackets ({publishedBrackets.length})</strong><small>Open a published copy to edit or unpublish it.</small></span><ChevronDown size={18} /></summary>
        <div className="studio-builder-body studio-bracket-library">
          {publishedBrackets.length === 0 && <p className="studio-muted">No brackets are currently published.</p>}
          {publishedBrackets.map(bracket => <div key={bracket.id} className="studio-bracket-library-row">
            <span><strong>{bracket.title}</strong><small>{bracket.gameName} · {bracket.teamsCount} teams</small></span>
            <button type="button" className="arena-outline" onClick={() => requestBracket(bracket)}>Edit published copy</button>
            <button type="button" className="arena-outline" onClick={() => setBracketToUnpublish(bracket)}>Unpublish</button>
          </div>)}
        </div>
      </details>

      {previousVersions.length > 0 && <details className="studio-builder">
        <summary><span><strong>Published versions ({previousVersions.length})</strong><small>Restore a previous live bracket and schedule.</small></span><ChevronDown size={18} /></summary>
        <div className="studio-builder-body studio-bracket-library">
          {previousVersions.map(version => <div key={publicationGameKey(version)} className="studio-bracket-library-row">
            <span><strong>{version.title}</strong><small>{version.gameName}</small></span>
            <button type="button" className="arena-outline" onClick={() => setVersionToRestore(version)}>Restore previous version</button>
          </div>)}
        </div>
      </details>}

      <ConfirmModal isOpen={draftToDelete !== null} title="Delete saved draft?"
        description={`Delete “${draftToDelete?.title || 'this draft'}” from this browser?${deletingOpenDraft ? ' The open draft and its unsaved changes will also close.' : ''} Published brackets stay available.`}
        confirmLabel="Delete draft" isDestructive onCancel={() => setDraftToDelete(null)} onConfirm={deleteDraft} />

      {bracketToLoad && <ConfirmModal isOpen title="Open another bracket?"
        description={`“${currentDraft?.title}” has unsaved changes. Cancel to save that draft first, or continue to open “${bracketToLoad.title}”.`}
        confirmLabel="Open bracket" onCancel={() => setBracketToLoad(null)} onConfirm={() => loadBracket(bracketToLoad)} />}

      <div className="studio-workspace">
        <details className="studio-builder" open={!currentDraft}>
          <summary>
            <span><strong>Build settings</strong><small>Start from a prompt, set up manually, or upload a roster.</small></span>
            <ChevronDown size={18} />
          </summary>
          <div className="studio-builder-body">
          <div className="studio-modes">
            {(
              [
                { mode: 'prompt', icon: <Sparkles className="w-3.5 h-3.5" />, label: 'Prompt' },
                { mode: 'manual', icon: <Grid className="w-3.5 h-3.5" />, label: 'Manual' },
                { mode: 'upload', icon: <Upload className="w-3.5 h-3.5" />, label: 'Upload' },
              ] as const
            ).map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => {
                  setBuildMode(mode);
                  if (mode === 'manual') {
                    setShowManualModal(true);
                  }
                }}
                type="button"
                aria-pressed={buildMode === mode}
                className="studio-mode"
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* ── PROMPT MODE ── */}
          {buildMode === 'prompt' && (
            <div className="studio-prompt-layout">
              <div>
                <label htmlFor="bracket-prompt" className="studio-label">
                  Tournament prompt<Req />
                </label>
                <div className="studio-composer">
                  <textarea
                    id="bracket-prompt"
                    aria-required="true"
                    rows={4}
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !isGenerating) {
                        e.preventDefault();
                        void handleAIGenerate();
                      }
                    }}
                    placeholder="Describe the team count, seeding, and match format."
                    className="studio-prompt-input"
                  />
                  <div className="flex items-center justify-between gap-3 px-2.5 pb-2.5">
                    <span className="studio-muted">Works offline</span>
                    <button
                      type="button"
                      onClick={handleAIGenerate}
                      disabled={isGenerating || !promptText.trim()}
                      aria-label={isGenerating ? 'Generating bracket' : 'Generate bracket'}
                      className="arena-primary"
                    >
                      {isGenerating ? (
                        <LoaderCircle className="w-4 h-4 animate-spin" />
                      ) : (
                        <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                      )}
                      <span>{isGenerating ? 'Generating…' : 'Generate bracket'}</span>
                    </button>
                  </div>
                </div>
                <span className="studio-prompt-help">
                  Use 2 to {MAX_BRACKET_TEAMS} teams. Press Enter to generate or Shift+Enter for a new line.
                </span>
              </div>

              <div className="studio-examples">
                <h3 className="studio-label">Example prompts</h3>
                {[
                  'Create a seeded 13-team single-elimination bracket with Bo3 matches.',
                  'Create a seeded 11-team single-elimination bracket with a Bo5 final.',
                  'Create a seeded 24-team single-elimination bracket with Bo3 matches and a Bo5 final.',
                ].map(prompt => (
                  <button key={prompt} type="button" onClick={() => setPromptText(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>

              {/* AI conversation panel */}
              {aiMessages.length > 0 && (
                <div className="studio-assistant border overflow-hidden">
                  <div className="px-3 py-2 border-b border-[#222222] flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#777777]">
                      Bracket assistant
                    </span>
                    <button
                      onClick={() => setAiMessages([])}
                      className="text-[#555555] hover:text-white transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto p-3 space-y-3">
                    {aiMessages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex flex-col ${
                          m.sender === 'user' ? 'items-end' : 'items-start'
                        }`}
                      >
                        <div
                          className={`max-w-[94%] text-xs leading-relaxed ${
                            m.sender === 'user'
                              ? 'bg-[#252525] text-white font-medium px-3 py-2.5 rounded-[10px]'
                              : 'text-white w-full'
                          }`}
                        >
                          {m.sender === 'user' ? (
                            m.text
                          ) : (
                            <div className="space-y-2.5">
                              {m.id === aiMessages[aiMessages.length - 1]?.id && (
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => setIsThinkingOpen((open) => !open)}
                                    className="flex items-center gap-2 py-1 text-[#B8B8B8] hover:text-white transition-colors cursor-pointer"
                                    aria-expanded={isThinkingOpen}
                                  >
                                    {streamingId === m.id ? (
                                      <LoaderCircle className="w-3.5 h-3.5 animate-spin text-[#ff6600]" />
                                    ) : (
                                      <Sparkles className="w-3.5 h-3.5 text-[#ff6600]" />
                                    )}
                                    <span className="font-semibold">
                                      {streamingId === m.id ? 'Thinking' : 'Thinking complete'}
                                    </span>
                                    <span className="text-[10px] text-[#6F6F6F]">{generationSeconds}s</span>
                                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isThinkingOpen ? 'rotate-180' : ''}`} />
                                  </button>
                                  {isThinkingOpen && (
                                    <div className="ml-1.5 mt-1 border-l border-[#363636] pl-3 space-y-2 text-[11px] text-[#858585]">
                                      {generationActivity.map((step, index) => (
                                        <div key={`${step}-${index}`} className="flex items-start gap-2">
                                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${index === generationActivity.length - 1 && isGenerating ? 'bg-[#ff6600]' : 'bg-[#555555]'}`} />
                                          <span>{step}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              {streamingId !== m.id && (
                                <div className="pt-1 text-[#E6E6E6]">
                                  <CleanFormattedText text={m.text} isStreaming={false} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={bottomRef} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── MANUAL MODE (Clean Pop-Up Launch Card) ── */}
          {buildMode === 'manual' && (
            <div className="space-y-4">
              <div className="p-4 rounded-[5px] bg-[#17181F] border border-[#333333] text-center space-y-3">
                <Layers className="w-8 h-8 text-[#ff6600] mx-auto" />
                <div>
                  <h4 className="text-xs font-bold text-white">Manual Bracket</h4>
                  <p className="text-[11px] text-[#777777] mt-1 leading-relaxed">
                    Set up your bracket format and team count in a quick pop-up. You can click each box on the canvas to name teams.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualModal(true)}
                  className="w-full py-2.5 px-4 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] text-black text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Configure Manual Bracket</span>
                </button>
              </div>

              <div className="p-3 rounded-[4px] bg-[#14151B] border border-[#252733] text-[11px] text-[#888888] space-y-1">
                <span className="font-semibold text-[#ff6600] block">Flexible Tournament Sizes</span>
                <p>Choose any count from 2 to {MAX_BRACKET_TEAMS}. Top seeds receive automatic BYEs when needed.</p>
              </div>
            </div>
          )}

          {buildMode === 'upload' && (
            <section className="roster-import" aria-label="Import a team roster">
              <div className="roster-import-intro">
                <h3>Import a team roster</h3>
                <p>Add your teams from a file or paste a roster to preview the bracket.</p>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void readRosterFile(file);
              }} />
              <button type="button" className="roster-dropzone" data-drag-over={isRosterDragOver}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={event => { event.preventDefault(); setIsRosterDragOver(true); }}
                onDragLeave={() => setIsRosterDragOver(false)}
                onDrop={event => {
                  event.preventDefault();
                  setIsRosterDragOver(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void readRosterFile(file);
                }}>
                <span className="roster-dropzone-icon"><Upload size={21} /></span>
                <span className="roster-dropzone-copy"><strong>Choose or drop a roster file</strong><small>CSV, TSV, or plain text</small></span>
                <span className="roster-dropzone-action">Browse files</span>
              </button>
              <div className="roster-import-actions">
                <button type="button" className="arena-outline" aria-expanded={showCsvPaste} onClick={() => setShowCsvPaste(value => !value)}>
                  {showCsvPaste ? 'Hide CSV editor' : 'Paste CSV'} <ChevronDown size={14} />
                </button>
                <button type="button" className="arena-outline" onClick={() => {
                  const sampleCsv = `Team Name,College,Seed\nCCS Alpha,Computing Studies,1\nCOE Titans,Engineering,2\nCN Lifeline,Nursing,3\nCCJE Wardens,Criminal Justice,4\nCL Verdict,Law,5\nCA Blueprint,Architecture,6\nCED Mentors,Education,7\nCLA Sentinels,Liberal Arts,8`;
                  processCsvContent(sampleCsv, 'WMSU Palaro Sample');
                }}>Try the sample roster</button>
              </div>
              {showCsvPaste && <div className="module-form roster-paste">
                <label><Req>Roster CSV</Req>
                  <textarea aria-required="true" value={csvRawText} onChange={event => setCsvRawText(event.target.value)} rows={5}
                    placeholder={'Team Name,College,Seed\nCCS Alpha,Computing Studies,1\nCOE Titans,Engineering,2'} />
                </label>
                <button type="button" className="arena-primary" disabled={!csvRawText.trim()} onClick={() => {
                  if (processCsvContent(csvRawText, 'Pasted Roster')) {
                    setCsvRawText('');
                    setShowCsvPaste(false);
                  }
                }}>Preview bracket</button>
              </div>}
              <aside className="roster-format">
                <strong>Roster format</strong>
                <p>One team per row. The header, college, and seed are optional.</p>
                <code>Team Name, College, Seed</code>
              </aside>
            </section>
          )}
          </div>
        </details>

      {currentDraft && <details className="studio-builder">
        <summary><span><strong>Draft schedule</strong><small>Add match times before publishing.</small></span><ChevronDown size={18} /></summary>
        <div className="studio-builder-body">
          <StreamScheduleEditor key={currentDraft.id} matches={currentDraft.matches.filter(match =>
            ![match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE'))}
            onApplyDraft={updates => {
              const byId = new Map(updates.map(update => [update.id, update]));
              setCurrentDraft(draft => draft ? {
                ...draft,
                status: 'saved',
                matches: draft.matches.map(match => {
                  const update = byId.get(match.id);
                  return update ? { ...match, ...update } : match;
                }),
              } : draft);
            }} />
        </div>
      </details>}

        <div className="min-w-0">
          {!currentDraft ? (
            <div className="rounded-[6px] bg-[#1E1E1E] border border-[#2D2D2D] p-16 text-center flex flex-col items-center justify-center min-h-[460px] shadow-xl">
              <div className="w-14 h-14 rounded-[6px] bg-[#181818] border border-[#2D2D2D] flex items-center justify-center text-[#ff6600] mb-4">
                <Grid className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-heading font-black text-white tracking-tight mb-2">
                Your bracket canvas is ready
              </h3>
              <p className="text-xs text-[#666666] max-w-sm mb-4">
                Describe a tournament, create one manually, or import a roster. Your connected bracket will appear here.
              </p>
              <button
                type="button"
                onClick={() => setShowManualModal(true)}
                className="px-4 py-2 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] text-black text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Create Manual Bracket</span>
              </button>
            </div>
          ) : (
            <div className="studio-board dashboard-media">
              {/* Draft Header Bar */}
              <div className="studio-board-header">
                <div className="studio-board-title">
                  {isEditingTitle ? (
                    <input
                      type="text"
                      autoFocus
                      value={currentDraft.title}
                      onBlur={() => setIsEditingTitle(false)}
                      onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
                      onChange={(e) =>
                        setCurrentDraft({ ...currentDraft, title: e.target.value })
                      }
                      className="bg-[#121214] border border-[#ff6600] rounded px-2 py-0.5 text-base font-heading font-bold text-white outline-none w-full max-w-md"
                    />
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="studio-board-name">
                        {currentDraft.title}
                      </h2>
                      <button
                        type="button"
                        onClick={() => setIsEditingTitle(true)}
                        className="text-[#666666] hover:text-white transition-colors p-1"
                        aria-label="Rename bracket"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <span className="studio-board-badge">
                    {currentDraft !== loadedBracket.current ? 'Unsaved changes' : currentDraft.status === 'published' ? 'Published copy' : 'Saved draft'}
                  </span>
                </div>

                {/* Right toolbar: team count info */}
                <div className="studio-board-meta">
                  <span>
                    {currentDraft.teamsCount} teams · {currentDraft.matchFormat}
                  </span>
                </div>
              </div>

              <p className="studio-board-help">
                Set the series length before play starts. A round’s series length locks once a match starts or has a recorded result. A BYE advances a team automatically. Select a match to edit its details.
              </p>

              <div className="studio-tree-frame">
                <HorizontalBracketTree
                  draft={currentDraft}
                  selectedMatchId={selectedMatch?.id || null}
                  onSelectMatch={handleOpenMatchEditor}
                  onUpdateTeamName={handleUpdateTeamName}
                  onScoreChange={handleScoreChange}
                  onRoundFormatChange={handleRoundFormatChange}
                />
              </div>

            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(versionToRestore)}
        title="Restore previous live version?"
        description={versionToRestore ? `Replace the live ${versionToRestore.gameName} bracket and schedule with “${versionToRestore.title}”? Spectators and Stream Manager will see the restored version.` : ''}
        confirmLabel="Restore live version"
        onConfirm={handleRestoreVersion}
        onCancel={() => setVersionToRestore(null)}
      />

      {/* ── POPUP MODAL: Manual Bracket Setup (Requested by user) ── */}
      <ManualBracketSetupModal
        isOpen={showManualModal}
        onClose={() => setShowManualModal(false)}
        onProceed={handleManualProceed}
      />

      {/* ── POPUP MODAL: Match Info (matches Screenshot 2) ── */}
      <MatchInfoModal
        match={selectedMatch}
        isOpen={Boolean(selectedMatch)}
        onClose={handleCancelMatchEdit}
        onSave={handleRequestMatchSave}
        onUpdateTeamName={handleUpdateTeamName}
        onScoreChange={handleScoreChange}
      />

      <BracketGenerationFeedbackModal
        isOpen={showFeedbackModal}
        data={generationFeedback}
        onClose={() => setShowFeedbackModal(false)}
        onConfirmAndLoad={(draft) => {
          setCurrentDraft(draft);
          setShowFeedbackModal(false);
        }}
        onSaveAndPublishLive={(draft) => {
          const saved = firestoreService.saveBracketDraft(draft);
          loadedBracket.current = saved;
          setCurrentDraft(saved);
          setShowFeedbackModal(false);
          setShowPublishGameModal(true);
        }}
      />

      {/* ── POPUP MODAL: Confirm Bracket Creation (Feedback requested by user) ── */}
      <ConfirmModal
        isOpen={showConfirmProceed}
        title="Confirm Bracket Generation?"
        description={
          pendingManualConfig
            ? `Create a ${pendingManualConfig.format} bracket for "${pendingManualConfig.title}" with ${pendingManualConfig.teamCount} teams (${pendingManualConfig.matchFormat})? A prebuilt tournament tree will be created on your canvas where you can click each box to set team names.`
            : 'Proceed with creating this tournament bracket?'
        }
        confirmLabel="Yes, Create Bracket"
        onConfirm={handleConfirmCreateManual}
        onCancel={() => {
          setShowConfirmProceed(false);
          setShowManualModal(true);
        }}
      />



      {/* ── POPUP MODAL: Choose Game to Publish Bracket (Requested by user) ── */}
      <PublishBracketModal
        isOpen={showPublishGameModal}
        draft={currentDraft}
        onClose={() => setShowPublishGameModal(false)}
        onConfirm={handleConfirmPublishToGame}
      />

      {/* ── POPUP MODAL: Publish Success Feedback (Requested by user) ── */}
      <SuccessDialog open={publishedGame !== null} title="Bracket published"
        description={publishedGame || undefined} onClose={() => setPublishedGame(null)} />

      {/* ── POPUP MODAL: Confirm Unpublish Bracket (CRUD feedback) ── */}
      <ConfirmModal
        isOpen={Boolean(bracketToUnpublish)}
        title="Unpublish Tournament Bracket?"
        description={`Are you sure you want to unpublish "${bracketToUnpublish?.title}" for ${bracketToUnpublish?.gameName}? It will no longer be visible to spectators.`}
        confirmLabel="Unpublish Bracket"
        isDestructive={true}
        onConfirm={() => bracketToUnpublish && handleUnpublishBracket(bracketToUnpublish)}
        onCancel={() => setBracketToUnpublish(null)}
      />

      <ConfirmModal
        isOpen={showConfirmDiscard}
        title="Clear the canvas?"
        description="Unsaved edits will be discarded. You can reopen saved drafts and published brackets."
        confirmLabel="Clear canvas"
        isDestructive={true}
        onConfirm={handleDiscardDraft}
        onCancel={() => setShowConfirmDiscard(false)}
      />

      <ConfirmModal
        isOpen={showConfirmSave}
        title="Save Bracket Changes?"
        description={`Save the current teams, BYE assignments, seeds, and scores for "${currentDraft?.title || 'this bracket'}"? This saves a draft on this device. Publish to share it.`}
        confirmLabel="Yes, Save Changes"
        onConfirm={performSaveBracket}
        onCancel={() => {
          setShowConfirmSave(false);
          showToast('Save cancelled. Your bracket changes remain in the draft.', 'info');
        }}
      />
    </div>
  );
};
