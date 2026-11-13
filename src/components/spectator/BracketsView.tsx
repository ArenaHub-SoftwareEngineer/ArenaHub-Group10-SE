import React, { useState, useEffect } from 'react';
import { Tournament, Match, College, BracketDraft } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { createBracketFromTeams } from '../../lib/bracketUtils';
import { StandingsView } from './StandingsView';
import { publicationGameKey } from '../../lib/bracketPublication';
import { TournamentBracketCanvas } from './TournamentBracketCanvas';
import { PublishedScheduleDialog } from '../common/SchedulePage';
import { FAIR_PLAY_GAMES } from '../../lib/fairPlayGames';
import { ArrowLeft, Calendar, ChevronDown, ChevronRight, Radio } from '../ui/Icons';

interface BracketsViewProps {
  tournament: Tournament;
  matches: Match[];
  colleges: College[];
  onBack: () => void;
  onSelectMatch: (m: Match) => void;
  initialBracketId?: string | null;
}

export const BracketsView: React.FC<BracketsViewProps> = ({
  tournament,
  matches: initialMatches,
  colleges,
  onBack,
  onSelectMatch,
  initialBracketId,
}) => {
  const [activeTab, setActiveTab] = useState<'bracket' | 'standings'>('bracket');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [publishedBrackets, setPublishedBrackets] = useState<BracketDraft[]>(() =>
    firestoreService.getPublishedBrackets()
  );
  const [allMatches, setAllMatches] = useState<Match[]>(() => firestoreService.getMatches());
  const [selectedBracketId, setSelectedBracketId] = useState<string | null>(initialBracketId || null);

  useEffect(() => {
    if (initialBracketId) setSelectedBracketId(initialBracketId);
  }, [initialBracketId]);

  // Real-time synchronization with FirestoreService
  useEffect(() => {
    const unsub = firestoreService.subscribe(() => {
      setPublishedBrackets([...firestoreService.getPublishedBrackets()]);
      setAllMatches([...firestoreService.getMatches()]);
    });
    return unsub;
  }, []);

  // Determine active bracket
  // 1. Check if user selected a specific published bracket
  // 2. Or if current tournament corresponds to a published bracket (by ID or game name)
  // 3. Fallback to generating an official bracket for the tournament
  const activeBracket: BracketDraft = React.useMemo(() => {
    if (selectedBracketId) {
      const found = publishedBrackets.find((b) => b.id === selectedBracketId);
      if (found) return found;
    }

    const byId = publishedBrackets.find((b) => b.id === tournament.id);
    if (byId) return byId;
    const byGame = publishedBrackets.find(bracket =>
      publicationGameKey(bracket) === publicationGameKey(tournament)
    );
    if (byGame) return byGame;

    // Fallback: create dynamic bracket from the colleges
    const extractedColleges = colleges.map((c, i) => ({
      name: c.name,
      college: c.code,
      seed: i + 1,
    }));

    const generated = createBracketFromTeams({
      title: tournament.title,
      teams: extractedColleges,
      gameName: tournament.gameName,
      format: 'Single Elimination',
      matchFormat: tournament.matchFormat,
      explicitBracketSize: extractedColleges.length,
    });
    return tournament.format === 'single-elimination' ? generated : {...generated,format:tournament.format,matches:initialMatches.filter(m=>m.tournamentId===tournament.id)};
  }, [selectedBracketId, tournament, publishedBrackets, colleges, initialMatches]);

  // Sync matches in the active bracket with real-time updates from firestoreService matches
  const currentBracketMatches = React.useMemo(() => {
    return activeBracket.matches.map((m) => {
      const liveM = allMatches.find((x) => x.id === m.id);
      return liveM ? { ...m, ...liveM } : m;
    });
  }, [activeBracket, allMatches]);

  // Group matches by round (1..maxRound)
  const maxRound = Math.max(...currentBracketMatches.map((m) => m.round), 1);
  const rounds: Match[][] = [];
  for (let r = 1; r <= maxRound; r++) {
    rounds.push(currentBracketMatches.filter((m) => m.round === r));
  }

  const liveMatches = currentBracketMatches.filter((m) => m.status === 'live');

  return (
    <div className="space-y-6 max-w-7xl animate-in fade-in duration-150">
      {activeBracket.status !== 'published' && tournament.format !== 'single-elimination' && <p className="field-hint">The organizer hasn’t published a full bracket yet. These are the scheduled matches.</p>}
      {/* Top Bar with Back and Real-time badge */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-(--text-muted) hover:text-(--text-primary) transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All tournaments</span>
        </button>

        <div className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full bg-(--success) animate-pulse" />
          <span className="text-(--success) font-semibold text-xs">
            {activeBracket.status === 'published' ? 'Published organizer bracket' : 'Sample bracket'}
          </span>
        </div>
      </div>

      <section className="arena-panel viewer-bracket-heading">
        <div>
          <p className="viewer-bracket-game">{activeBracket.gameName}</p>
          <h1>{activeBracket.title || tournament.title}{activeBracket.demo && <span className="demo-label" title="Demonstration data, not a real event">DEMO</span>}</h1>
          <p className="studio-muted">{activeBracket.format} · {activeBracket.teamsCount} teams · {currentBracketMatches.length} matches</p>
        </div>
        <button type="button" className="arena-outline" onClick={() => setShowScheduleModal(true)}>
          <Calendar size={17} /> Match schedule <ChevronDown size={14} />
        </button>
        {(() => {
          const artwork = FAIR_PLAY_GAMES.find(game => `game-${game.id}` === publicationGameKey(activeBracket));
          return artwork && <img className="viewer-bracket-artwork" src={artwork.image} alt="" />;
        })()}
      </section>

      {publishedBrackets.length > 1 && <label className="module-form viewer-bracket-selector">Published game
        <select value={activeBracket.status === 'published' ? activeBracket.id : ''} onChange={event => setSelectedBracketId(event.target.value)}>
          {activeBracket.status !== 'published' && <option value="" disabled>Choose a published bracket</option>}
          {publishedBrackets.map(bracket => <option key={bracket.id} value={bracket.id}>{bracket.gameName} · {bracket.title}</option>)}
        </select>
      </label>}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] pb-3">
        <button
          onClick={() => setActiveTab('bracket')}
          className={`px-4 py-1.5 rounded-[4px] text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'bracket'
              ? 'bg-white/[0.10] text-(--text-primary) shadow-sm'
              : 'text-[var(--text-muted)] hover:text-(--text-primary) hover:bg-white/[0.05]'
          }`}
        >
          Tournament Bracket
        </button>
        <button
          onClick={() => setActiveTab('standings')}
          className={`px-4 py-1.5 rounded-[4px] text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'standings'
              ? 'bg-white/[0.10] text-(--text-primary) shadow-sm'
              : 'text-[var(--text-muted)] hover:text-(--text-primary) hover:bg-white/[0.05]'
          }`}
        >
          Standings
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'standings' ? (
        <StandingsView bracket={activeBracket} />
      ) : (
        <div className="space-y-6">
          {/* Live Match Banner Alert if any match is currently live */}
          {liveMatches.length > 0 && (
            <div className="p-3.5 rounded-[6px] bg-(--surface-soft) border-2 border-(--success) flex flex-wrap items-center justify-between gap-3 shadow-lg shadow-(color:--success)/10">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-(--success) animate-pulse" />
                <div>
                  <span className="text-xs font-bold text-(--success) block">
                    LIVE MATCH IN PROGRESS
                  </span>
                  <span className="text-xs font-bold text-(--text-primary)">
                    {liveMatches[0].team1?.name || 'Team 1'} ({liveMatches[0].score.team1Score}) vs{' '}
                    {liveMatches[0].team2?.name || 'Team 2'} ({liveMatches[0].score.team2Score}) · {liveMatches[0].roundName}
                  </span>
                </div>
              </div>

              <button
                onClick={() => onSelectMatch(liveMatches[0])}
                className="px-3.5 py-1.5 rounded-[4px] bg-(--brand) hover:bg-(--brand-hover) text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Watch Live Stream</span>
              </button>
            </div>
          )}

          {/* ── Dynamic Horizontal Tournament Grid ── */}
          <div className="viewer-bracket-board"><TournamentBracketCanvas key={activeBracket.id} rounds={rounds} onSelectMatch={onSelectMatch} /></div>
          {false && <div className="p-5 rounded-[6px] bg-(--surface) border border-(--border) shadow-xl overflow-x-auto">
            <div className="flex items-start gap-6 min-w-max pb-3">
              {rounds.map((roundMatches, roundIdx) => {
                const isGrandFinal = roundIdx === rounds.length - 1;
                const roundName = roundMatches[0]?.roundName || `Round ${roundIdx + 1}`;
                const matchFmt = roundMatches[0]?.matchFormat || (isGrandFinal ? 'Bo5' : 'Bo3');

                return (
                  <div key={roundIdx} className="space-y-4 min-w-[240px] max-w-[260px] flex-1">
                    {/* Round Header */}
                    <div className="flex items-center justify-between text-xs font-bold pb-1.5 border-b border-(--border)">
                      <span className={isGrandFinal ? 'text-(--brand-ink)' : 'text-(--text-secondary)'}>
                        {roundName}
                      </span>
                      <span className="text-xs text-(--text-muted) tabular-nums normal-case">
                        {matchFmt}
                      </span>
                    </div>

                    {/* Round Match Cards */}
                    <div className="space-y-3">
                      {roundMatches.map((match) => {
                        const isByeMatch = match.team2?.name === 'BYE' || match.team2?.isBye;
                        const isLive = match.status === 'live';
                        const isCompleted = match.status === 'completed';
                        const t1Name = match.team1?.name || (roundIdx === 0 ? 'Team 1' : 'TBD');
                        const t2Name = isByeMatch ? 'BYE' : (match.team2?.name || (roundIdx === 0 ? 'Team 2' : 'TBD'));
                        const t1Seed = match.team1?.seed ?? 1;
                        const t2Seed = match.team2?.seed ?? 2;
                        const s1 = match.score.team1Score;
                        const s2 = match.score.team2Score;
                        const t1Winning = (isCompleted && match.winnerId === match.team1?.id) || (s1 > s2 && s1 > 0) || isByeMatch;
                        const t2Winning = (isCompleted && match.winnerId === match.team2?.id) || (s2 > s1 && s2 > 0);

                        return (
                          <div
                            key={match.id}
                            onClick={() => !isByeMatch && onSelectMatch(match)}
                            className={`p-3 rounded-[5px] border transition-all ${
                              isByeMatch
                                ? 'bg-(--surface) border-(--border) opacity-80'
                                : isLive
                                ? 'bg-(--surface-soft) border-2 border-(--brand) shadow-lg shadow-(color:--brand)/10 cursor-pointer hover:bg-(--surface-elevated)'
                                : isGrandFinal
                                ? 'bg-(--surface) border-(--brand)/50 shadow-md cursor-pointer hover:bg-(--surface-soft)'
                                : 'bg-(--surface-soft) border-(--border-strong) hover:border-(--border-strong) cursor-pointer'
                            }`}
                          >
                            {/* Match Header Badge */}
                            <div className="flex items-center justify-between text-xs mb-2 tabular-nums">
                              <span className="text-(--text-muted) font-bold">{match.matchNumber}</span>
                              {isByeMatch ? (
                                <span className="px-1.5 py-0.2 rounded bg-(--success)/15 text-(--success) font-bold text-xs">
                                  BYE ADVANCE
                                </span>
                              ) : isLive ? (
                                <span className="flex items-center gap-1 text-(--success) font-bold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-(--success) animate-pulse" />
                                  LIVE
                                </span>
                              ) : isCompleted ? (
                                <span className="text-(--text-muted)">FINAL</span>
                              ) : (
                                <span className="text-(--text-muted)">{match.scheduledTime || 'UPCOMING'}</span>
                              )}
                            </div>

                            {/* Team 1 Row */}
                            <div className="flex items-center justify-between py-1 border-b border-(--border)">
                              <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                <span className="w-4 h-4 rounded-[2px] bg-(--surface-elevated) text-xs font-bold text-(--text-muted) flex items-center justify-center shrink-0">
                                  {t1Seed}
                                </span>
                                <span
                                  className={`text-xs truncate ${
                                    t1Winning
                                      ? 'text-(--brand-ink) font-bold'
                                      : 'text-(--text-primary) font-medium'
                                  }`}
                                >
                                  {t1Name}
                                </span>
                              </div>
                              <span
                                className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded ${
                                  t1Winning
                                    ? 'bg-(--brand)/10 text-(--brand-ink)'
                                    : 'text-(--text-muted)'
                                }`}
                              >
                                {isByeMatch ? '✓' : s1}
                              </span>
                            </div>

                            {/* Team 2 Row */}
                            <div className="flex items-center justify-between py-1">
                              <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                <span className="w-4 h-4 rounded-[2px] bg-(--surface-elevated) text-xs font-bold text-(--text-muted) flex items-center justify-center shrink-0">
                                  {t2Seed}
                                </span>
                                <span
                                  className={`text-xs truncate ${
                                    isByeMatch
                                      ? 'text-(--text-muted) text-xs font-semibold'
                                      : t2Winning
                                      ? 'text-(--brand-ink) font-bold'
                                      : 'text-(--text-secondary) font-medium'
                                  }`}
                                >
                                  {t2Name}
                                </span>
                              </div>
                              <span
                                className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded ${
                                  t2Winning
                                    ? 'bg-(--brand)/10 text-(--brand-ink)'
                                    : 'text-(--text-muted)'
                                }`}
                              >
                                {isByeMatch ? '-' : s2}
                              </span>
                            </div>

                            {/* Click to view live stream prompt */}
                            {isLive && (
                              <div className="pt-2 mt-1 border-t border-(--border-strong) flex items-center justify-between text-xs text-(--brand-ink) font-semibold">
                                <span>Click to watch match</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>}

          {/* Footer note */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-(--text-muted) pt-2 px-1">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-(--success)" />
              <span>
                Bracket updates dynamically in real-time as admins save results and report match scores.
              </span>
            </div>
            <div className="text-xs text-(--text-muted)">
              Accommodates any tournament size with standard competitive seeding.
            </div>
          </div>
        </div>
      )}

      <PublishedScheduleDialog open={showScheduleModal} onClose={() => setShowScheduleModal(false)}
        bracket={activeBracket.status === 'published' ? activeBracket : undefined} onSelect={onSelectMatch} />
    </div>
  );
};
