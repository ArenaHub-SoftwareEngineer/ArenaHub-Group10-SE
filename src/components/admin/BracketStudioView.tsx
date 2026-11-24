import React, { useState, useRef, useEffect } from 'react';
import { BracketDraft, Match, Team, MatchFormat, seriesWinsNeeded } from '../../lib/types';
import { validateScore } from '../../lib/integrityChecks';
import { firestoreService } from '../../lib/firestore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { StreamScheduleEditor } from './StreamScheduleEditor';
import { applyMatchSchedules, isScheduleMatch, missingMatchSchedules } from '../../lib/streamSchedule';
import { publicationGameKey } from '../../lib/bracketPublication';
import { downloadBracketPng } from '../../lib/bracketImageExport';
import { SuccessDialog } from '../ui/SuccessDialog';
import { useToast } from '../ui/Toast';
import { Req } from '../ui/Req';
import { BracketGenerationFeedbackModal, GenerationFeedbackData } from './BracketGenerationFeedbackModal';
import { createBracketFromTeams, createPrebuiltManualBracket, updateMatchAndAdvance, parseTeamsFromCSV, MAX_BRACKET_TEAMS } from '../../lib/bracketUtils';
import { Sparkles, Upload, Grid, Check, Trash2, Plus, Edit2, Layers, ChevronDown, LoaderCircle, FileText, Download, Image } from '../ui/Icons';
import { BracketFormat, getBracketSyncErrorMessage } from './bracket-studio/shared';
import { MatchInfoModal } from './bracket-studio/MatchInfoModal';
import { ManualBracketSetupModal } from './bracket-studio/BracketSetup';
import { PublishBracketModal } from './bracket-studio/BracketPublishPanel';
import { canEditRoundFormat } from '../../lib/tournamentFormats';
import { StudioBracketBoard } from './bracket-studio/StudioBracketBoard';
import { TeamImagesDialog } from './bracket-studio/TeamImagesDialog';
import { assertDocSize } from '../../lib/data/tournamentDocs';
import { changeRoundFormat } from '../../lib/tournamentFormats';
import { swissRoundCount } from '../../lib/formats/swiss';
import { BracketAIDraft } from './bracket-studio/BracketAIDraft';
import { duplicateMessage, duplicateNames, teamNameProblem } from '../../lib/teamNames';

// ── Main Component ────────────────────────────────────────────────────────────

export const BracketStudioView: React.FC<{ initialBracketId?: string | null; startNew?: boolean }> = ({ initialBracketId, startNew }) => {
  const { showToast } = useToast();

  // Mode
  const [buildMode, setBuildMode] = useState<'prompt' | 'manual' | 'upload'>('prompt');
  const schedulePanel = useRef<HTMLDetailsElement>(null);
  const [libraryTab, setLibraryTab] = useState<'drafts' | 'live' | 'versions'>('drafts');

  // Bracket state
  const [currentDraft, setCurrentDraft] = useState<BracketDraft | null>(() => {
    if (startNew) return null;
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
  const [showTeamImages, setShowTeamImages] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [draftBeforeMatchEdit, setDraftBeforeMatchEdit] = useState<BracketDraft | null>(null);
  const [isExportingBracket, setIsExportingBracket] = useState(false);
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

  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [generationFeedback, setGenerationFeedback] = useState<GenerationFeedbackData | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  // CSV Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvRawText, setCsvRawText] = useState('');
  const [showCsvPaste, setShowCsvPaste] = useState(false);
  const [isRosterDragOver, setIsRosterDragOver] = useState(false);

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
    const repeated = duplicateMessage(duplicateNames(teams.map((team, index) => ({ id: String(index), name: team.name }))));
    if (repeated) {
      showToast(`${repeated} The bracket was not created.`, 'error');
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
    if (targetMatch.tournamentFormat === 'swiss' && (isBye || oldTeam?.isBye)) {
      showToast('Swiss assigns byes automatically each round. Rename an active team instead.', 'info');
      return;
    }

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

  const requestSaveDraft = () => {
    const problem = currentDraft && teamNameProblem(currentDraft);
    if (problem) { showToast(problem, 'error'); return; }
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
        matches: changeRoundFormat(draft.matches, round, format),
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

  const performSaveBracket = async () => {
    if (!currentDraft) return;
    const saved = await firestoreService.saveBracketDraft(currentDraft);
    setShowConfirmSave(false);
    loadedBracket.current = saved;
    setCurrentDraft(saved);
    showToast(`Bracket "${saved.title}" saved to your account.`, 'success');
  };

  const handleDownloadBracket = async () => {
    if (!currentDraft || isExportingBracket) return;
    setIsExportingBracket(true);
    try {
      await downloadBracketPng(currentDraft);
      showToast('Bracket image saved as PNG.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the bracket image.', 'error');
    } finally {
      setIsExportingBracket(false);
    }
  };

  const handleConfirmPublishToGame = async (gameName: string, gameId: string) => {
    if (!currentDraft) throw new Error('Load a bracket before publishing.');
    const saved = await firestoreService.saveBracketDraft(currentDraft);
    const published = await firestoreService.publishBracket(saved, gameName, gameId);
    loadedBracket.current = published;
    setCurrentDraft(published);
    setShowPublishGameModal(false);
    setPublishedGame(gameName);
  };

  const previouslyPublished = Boolean(currentDraft && publishedBrackets.some(bracket => bracket.id === currentDraft.id));
  function updateTeamImage(teamId: string, image?: string) {
    if (!currentDraft) return;
    const teams = { ...currentDraft.appearance?.teams };
    const badge = { ...teams[teamId] };
    if (image) badge.image = image;
    else delete badge.image;
    if (Object.keys(badge).length) teams[teamId] = badge;
    else delete teams[teamId];
    const next = { ...currentDraft, appearance: { ...currentDraft.appearance, teams } };
    if (image) assertDocSize({ draft: next }, 'This draft with its team images');
    setCurrentDraft(next);
  }
  const scheduleMissing = currentDraft ? missingMatchSchedules(currentDraft.matches).length : 0;
  const requestPublish = (draft: BracketDraft) => {
    const problem = teamNameProblem(draft);
    if (problem) { showToast(problem, 'error'); return; }
    const missing = missingMatchSchedules(draft.matches).length;
    if (missing && !publishedBrackets.some(bracket => bracket.id === draft.id)) {
      showToast(`Schedule ${missing} remaining ${missing === 1 ? 'match' : 'matches'} before publishing.`, 'error');
      requestAnimationFrame(() => {
        const panel = schedulePanel.current;
        if (!panel) return;
        panel.open = true;
        panel.querySelector('summary')?.focus();
        panel.scrollIntoView({ block: 'start' });
      });
      return;
    }
    setShowPublishGameModal(true);
  };

  const handleRestoreVersion = async () => {
    if (!versionToRestore) return;
    const restored = await firestoreService.restorePublishedBracket(versionToRestore);
    setVersionToRestore(null);
    showToast(`Previous bracket and schedule restored for ${restored.gameName}.`, 'success');
  };

  // Throws on failure: the confirmation dialog stays open with the error, and its button retries.
  // Nothing changes on this device until the cloud write succeeds, so the list never shows a bracket
  // as gone while viewers can still see it.
  const handleUnpublishBracket = async (bracket: BracketDraft) => {
    try {
      await firestoreService.unpublishBracket(bracket.id);
    } catch (error) {
      console.error('[ArenaHub] Bracket unpublish failed:', error);
      throw new Error(getBracketSyncErrorMessage(error, 'Unpublished'));
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

  async function deleteDraft() {
    if (!draftToDelete) return;
    await firestoreService.deleteSavedBracketDraft(draftToDelete.id);
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
            ? 'bg-(--brand)/10 border-(--brand)/60 text-(--brand-ink)'
            : 'bg-(--surface) border-(--border) text-(--text-muted) hover:border-(--border-strong) hover:text-white'
        }`}
      >
        <span className={`text-xs font-bold ${active ? 'text-(--brand-ink)' : ''}`}>{label}</span>
        {desc && <span className="text-xs opacity-60 mt-0.5">{desc}</span>}
      </button>
    );
  };

  return (
    <div className="bracket-studio module-page">
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
              const staged = /swiss|round robin/i.test(currentDraft.format);
              const treeSize = staged ? currentDraft.teamsCount : Math.max(2, Math.pow(2, Math.ceil(Math.log2(currentDraft.teamsCount))));
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
                explanation: staged ? `${currentDraft.teamsCount} teams play ${currentDraft.format === 'Swiss' ? swissRoundCount(currentDraft.teamsCount) : currentDraft.teamsCount - 1 + currentDraft.teamsCount % 2} rounds. ${currentDraft.format === 'Swiss' ? 'Pairings are drawn after the previous round finishes.' : 'Every team meets every opponent once.'}` : `Active tournament bracket with ${currentDraft.teamsCount} teams accommodated in an ${treeSize}-slot tree.`,
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

          <button type="button" className="arena-outline" onClick={requestSaveDraft}
            disabled={!currentDraft || currentDraft === loadedBracket.current}>
            <Check size={16} aria-hidden="true" /> Save draft
          </button>

          <button
            onClick={() => currentDraft && requestPublish(currentDraft)}
            disabled={!currentDraft}
            className="arena-primary"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>Publish Bracket</span>
          </button>
        </div>
      </header>

      {(() => {
        const published = Boolean(currentDraft && currentDraft.status === 'published' && currentDraft === loadedBracket.current);
        const steps = [
          { label: 'Build', hint: 'Prompt, manual setup or roster', done: Boolean(currentDraft) },
          { label: 'Edit and schedule', hint: 'Names, scores, series and times', done: published },
          { label: 'Publish', hint: 'Spectators see it live', done: published },
        ];
        const current = !currentDraft ? 0 : published ? 3 : 1;
        return <ol className="studio-steps" aria-label="Bracket progress">
          {steps.map((step, index) => <li key={step.label} className={step.done ? 'is-done' : index === current ? 'is-current' : undefined} aria-current={index === current ? 'step' : undefined}>
            <span className="studio-step-dot" aria-hidden="true">{step.done ? <Check size={14} strokeWidth={3} /> : index + 1}</span>
            <span><strong>{step.label}</strong><small>{step.hint}</small></span>
          </li>)}
        </ol>;
      })()}

      <ConfirmModal isOpen={draftToDelete !== null} title="Delete saved draft?"
        description={`Delete “${draftToDelete?.title || 'this draft'}” from your account?${deletingOpenDraft ? ' The open draft and its unsaved changes will also close.' : ''} Published brackets stay available.`}
        confirmLabel="Delete draft" isDestructive onCancel={() => setDraftToDelete(null)} onConfirm={deleteDraft} />

      {bracketToLoad && <ConfirmModal isOpen title="Open another bracket?"
        description={`“${currentDraft?.title}” has unsaved changes. Cancel to save that draft first, or continue to open “${bracketToLoad.title}”.`}
        confirmLabel="Open bracket" onCancel={() => setBracketToLoad(null)} onConfirm={() => loadBracket(bracketToLoad)} />}

      <div className="studio-top">
        <details className="studio-builder studio-build" open={!currentDraft}>
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
          <BracketAIDraft hidden={buildMode !== 'prompt'} onDraft={setCurrentDraft} onFeedback={setGenerationFeedback} />

          {/* ── MANUAL MODE (Clean Pop-Up Launch Card) ── */}
          {buildMode === 'manual' && (
            <div className="space-y-4">
              <div className="p-4 rounded-[5px] bg-(--surface) border border-(--border) text-center space-y-3">
                <Layers className="w-8 h-8 text-(--brand-ink) mx-auto" />
                <div>
                  <h4 className="text-xs font-bold text-(--text-primary)">Manual Bracket</h4>
                  <p className="text-xs text-(--text-muted) mt-1 leading-relaxed">
                    Set up your bracket format and team count in a quick pop-up. You can click each box on the canvas to name teams.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualModal(true)}
                  className="w-full py-2.5 px-4 rounded-[4px] bg-(--brand) hover:bg-(--brand-hover) text-black text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Configure Manual Bracket</span>
                </button>
              </div>

              <div className="p-3 rounded-[4px] bg-(--bg-base) border border-(--border) text-xs text-(--text-muted) space-y-1">
                <span className="font-semibold text-(--brand-ink) block">Flexible Tournament Sizes</span>
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

        <aside className="page-panel studio-library" aria-label="Bracket library">
          <h2>Library</h2>
          <div className="ah-tabs studio-library-tabs" role="tablist" aria-label="Bracket library">
            {([['drafts', 'Drafts', drafts.length], ['live', 'Live', publishedBrackets.length], ['versions', 'Versions', previousVersions.length]] as const).map(([id, label, count]) =>
              <button key={id} type="button" role="tab" aria-selected={libraryTab === id} onClick={() => setLibraryTab(id)}>{label}<span className="ah-chip-count">{count}</span></button>)}
          </div>
          <div className="studio-bracket-library" role="tabpanel">
            {libraryTab === 'drafts' && <>
              {drafts.length === 0 && <p className="studio-muted">No saved drafts. Publishing a bracket also keeps its latest draft and roster here.</p>}
              {drafts.map(draft => <div key={draft.id} className="studio-bracket-library-row">
                <span><strong>{draft.title}</strong><small>{draft.gameName} · {draft.teamsCount} teams</small></span>
                <span className="studio-row-actions">
                  <button type="button" className="arena-outline arena-sm" onClick={() => requestBracket(draft)}>Open draft</button>
                  <button type="button" className="arena-outline arena-sm arena-danger-text studio-delete-draft" onClick={() => setDraftToDelete(draft)}>Delete draft</button>
                </span>
              </div>)}
            </>}
            {libraryTab === 'live' && <>
              {publishedBrackets.length === 0 && <p className="studio-muted">No brackets are published right now.</p>}
              {publishedBrackets.map(bracket => <div key={bracket.id} className="studio-bracket-library-row">
                <span><strong><i className="studio-live-dot" aria-hidden="true" />{bracket.title}</strong><small>{bracket.gameName} · {bracket.teamsCount} teams</small></span>
                <span className="studio-row-actions">
                  <button type="button" className="arena-outline arena-sm" onClick={() => requestBracket(bracket)}>Edit published copy</button>
                  <button type="button" className="arena-outline arena-sm arena-danger-text" onClick={() => setBracketToUnpublish(bracket)}>Unpublish</button>
                </span>
              </div>)}
            </>}
            {libraryTab === 'versions' && <>
              {previousVersions.length === 0 && <p className="studio-muted">Earlier live versions appear here after you publish a change.</p>}
              {previousVersions.map(version => <div key={publicationGameKey(version)} className="studio-bracket-library-row">
                <span><strong>{version.title}</strong><small>{version.gameName}</small></span>
                <span className="studio-row-actions"><button type="button" className="arena-outline arena-sm" onClick={() => setVersionToRestore(version)}>Restore previous version</button></span>
              </div>)}
            </>}
          </div>
        </aside>
      </div>

      <div className="studio-workspace">
      {currentDraft && <details className="studio-builder schedule-section" ref={schedulePanel}>
        <summary><span><strong>Draft schedule</strong><small>{scheduleMissing ? `${scheduleMissing} ${scheduleMissing === 1 ? 'match needs' : 'matches need'} a date and start time` : 'All playable matches are scheduled'}</small></span><ChevronDown size={18} /></summary>
        <div className="studio-builder-body">
          <StreamScheduleEditor key={currentDraft.id} game={{ id: currentDraft.gameId, name: currentDraft.gameName }}
            matches={currentDraft.matches.filter(isScheduleMatch)} includeStarted={!previouslyPublished}
            onApply={updates => setCurrentDraft(draft => draft ? {
              ...draft,
              matches: applyMatchSchedules(draft.matches, updates, !previouslyPublished),
            } : draft)} />
        </div>
      </details>}

        <div className="min-w-0">
          {!currentDraft ? (
            <div className="studio-empty">
              <div className="studio-empty-art" aria-hidden="true">
                <svg viewBox="0 0 220 120"><path d="M8 14h46v20H8zM8 50h46v20H8zM8 86h46v20H8zM88 32h46v20H88zM88 74h46v20H88zM166 53h46v20h-46z" /><path className="studio-empty-lines" d="M54 24h17v18h17M54 60h17V42M54 96h17V84h17M134 42h16v21h16M134 84h16V63" /></svg>
              </div>
              <h3>Your bracket canvas is ready</h3>
              <p>
                Describe a tournament, create one manually, or import a roster. Your connected bracket will appear here.
              </p>
              <button
                type="button"
                onClick={() => setShowManualModal(true)}
                className="arena-primary"
              >
                <Plus size={16} aria-hidden="true" />
                <span>Create bracket manually</span>
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
                      className="bg-(--bg-base) border border-(--brand) rounded px-2 py-0.5 text-base font-heading font-bold text-(--text-primary) outline-none w-full max-w-md"
                    />
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="studio-board-name">
                        {currentDraft.title}
                      </h2>
                      <button
                        type="button"
                        onClick={() => setIsEditingTitle(true)}
                        className="text-(--text-muted) hover:text-(--text-primary) transition-colors p-1"
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

              <ol className="ah-steps studio-board-steps">
                <li>Pick each round’s series length (Bo1 to Bo7) before play. It locks once a match in that round starts.</li>
                <li>Rename first-round teams by clicking their names. Use − and + beside a score to record game wins; the winner is ticked and moves on.</li>
                <li>Select a match’s top strip to set its time, stream and details.</li>
              </ol>

              <StudioBracketBoard
                matches={currentDraft.matches}
                appearance={currentDraft.appearance}
                selectedMatchId={selectedMatch?.id || null}
                onSelectMatch={handleOpenMatchEditor}
                onUpdateTeamName={handleUpdateTeamName}
                onScoreChange={handleScoreChange}
                onRoundFormatChange={handleRoundFormatChange}
                actions={<>
                  <button type="button" className="arena-outline arena-sm" aria-haspopup="dialog" onClick={() => setShowTeamImages(true)}>
                    <Image size={15} aria-hidden="true" /> Team images
                  </button>
                  <button type="button" className="arena-outline arena-sm" onClick={() => void handleDownloadBracket()} disabled={isExportingBracket}>
                    {isExportingBracket ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />} Save image
                  </button>
                </>}
              />
              <TeamImagesDialog key={currentDraft.id} open={showTeamImages} draft={currentDraft} onChange={updateTeamImage} onClose={() => setShowTeamImages(false)} />

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
        key={selectedMatch?.id}
        match={selectedMatch}
        appearance={currentDraft?.appearance}
        isOpen={Boolean(selectedMatch)}
        onClose={handleCancelMatchEdit}
        onSave={requestSaveDraft}
        onUpdateTeamImage={updateTeamImage}
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
          setCurrentDraft(draft);
          setShowFeedbackModal(false);
          requestPublish(draft);
        }}
      />

      {/* ── POPUP MODAL: Confirm Bracket Creation (Feedback requested by user) ── */}
      <ConfirmModal
        isOpen={showConfirmProceed}
        title="Confirm Bracket Generation?"
        description={
          pendingManualConfig
            ? `Create a ${pendingManualConfig.teamCount}-team ${pendingManualConfig.format} tournament (${pendingManualConfig.matchFormat})? ${pendingManualConfig.format === 'Swiss' ? `The first of ${swissRoundCount(pendingManualConfig.teamCount)} rounds will appear now. Further rounds are paired after the current round finishes.` : pendingManualConfig.format === 'Round Robin' ? 'Every team will meet every other team once.' : 'The tournament bracket will appear on the canvas.'} You can edit team names on the canvas.`
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
        publishedBrackets={publishedBrackets}
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
        description={`Save the current teams, team images, and match details for “${currentDraft?.title || 'this bracket'}” to your account? Publish to share it with spectators.`}
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
