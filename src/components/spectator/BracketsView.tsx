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
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#888888] hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All tournaments</span>
        </button>

        <div className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full bg-[#3DD68C] animate-pulse" />
          <span className="text-[#3DD68C] font-semibold text-[11px] uppercase tracking-wider">
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
              ? 'bg-white/[0.10] text-white shadow-sm'
              : 'text-[var(--text-muted)] hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          Tournament Bracket
        </button>
        <button
          onClick={() => setActiveTab('standings')}
          className={`px-4 py-1.5 rounded-[4px] text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'standings'
              ? 'bg-white/[0.10] text-white shadow-sm'
              : 'text-[var(--text-muted)] hover:text-white hover:bg-white/[0.05]'
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
            <div className="p-3.5 rounded-[6px] bg-[#16251A] border-2 border-[#3DD68C] flex flex-wrap items-center justify-between gap-3 shadow-lg shadow-[#3DD68C]/10">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#3DD68C] animate-pulse" />
                <div>
                  <span className="text-[10px] font-black uppercase text-[#3DD68C] tracking-wider block">
                    LIVE MATCH IN PROGRESS
                  </span>
                  <span className="text-xs font-bold text-white">
                    {liveMatches[0].team1?.name || 'Team 1'} ({liveMatches[0].score.team1Score}) vs{' '}
                    {liveMatches[0].team2?.name || 'Team 2'} ({liveMatches[0].score.team2Score}) · {liveMatches[0].roundName}
                  </span>
                </div>
              </div>

              <button
                onClick={() => onSelectMatch(liveMatches[0])}
                className="px-3.5 py-1.5 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Watch Live Stream</span>
              </button>
            </div>
          )}

          {/* ── Dynamic Horizontal Tournament Grid ── */}
          <div className="viewer-bracket-board"><TournamentBracketCanvas key={activeBracket.id} rounds={rounds} onSelectMatch={onSelectMatch} /></div>
          {false && <div className="p-5 rounded-[6px] bg-[#181920] border border-[#2B2D38] shadow-xl overflow-x-auto">
            <div className="flex items-start gap-6 min-w-max pb-3">
              {rounds.map((roundMatches, roundIdx) => {
                const isGrandFinal = roundIdx === rounds.length - 1;
                const roundName = roundMatches[0]?.roundName || `Round ${roundIdx + 1}`;
                const matchFmt = roundMatches[0]?.matchFormat || (isGrandFinal ? 'Bo5' : 'Bo3');

                return (
                  <div key={roundIdx} className="space-y-4 min-w-[240px] max-w-[260px] flex-1">
                    {/* Round Header */}
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider pb-1.5 border-b border-[#333333]">
                      <span className={isGrandFinal ? 'text-[#ff6600]' : 'text-[#AAAAAA]'}>
                        {roundName}
                      </span>
                      <span className="text-[10px] text-[#666677] font-mono normal-case">
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
                                ? 'bg-[#15161D] border-[#252834] opacity-80'
                                : isLive
                                ? 'bg-[#1C2028] border-2 border-[#ff6600] shadow-lg shadow-[#ff6600]/10 cursor-pointer hover:bg-[#222734]'
                                : isGrandFinal
                                ? 'bg-[#1E1F1A] border-[#ff6600]/50 shadow-md cursor-pointer hover:bg-[#262720]'
                                : 'bg-[#202020] border-[#2F3242] hover:border-[#42485E] cursor-pointer'
                            }`}
                          >
                            {/* Match Header Badge */}
                            <div className="flex items-center justify-between text-[10px] mb-2 font-mono">
                              <span className="text-[#777788] font-bold">{match.matchNumber}</span>
                              {isByeMatch ? (
                                <span className="px-1.5 py-0.2 rounded bg-[#3DD68C]/15 text-[#3DD68C] font-bold text-[9px]">
                                  BYE ADVANCE
                                </span>
                              ) : isLive ? (
                                <span className="flex items-center gap-1 text-[#3DD68C] font-bold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#3DD68C] animate-pulse" />
                                  LIVE
                                </span>
                              ) : isCompleted ? (
                                <span className="text-[#888899]">FINAL</span>
                              ) : (
                                <span className="text-[#777788]">{match.scheduledTime || 'UPCOMING'}</span>
                              )}
                            </div>

                            {/* Team 1 Row */}
                            <div className="flex items-center justify-between py-1 border-b border-[#292C3A]">
                              <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                <span className="w-4 h-4 rounded-[2px] bg-[#333333] text-[9px] font-bold text-[#888899] flex items-center justify-center shrink-0">
                                  {t1Seed}
                                </span>
                                <span
                                  className={`text-xs truncate ${
                                    t1Winning
                                      ? 'text-[#ff6600] font-bold'
                                      : 'text-white font-medium'
                                  }`}
                                >
                                  {t1Name}
                                </span>
                              </div>
                              <span
                                className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded ${
                                  t1Winning
                                    ? 'bg-[#ff6600]/10 text-[#ff6600]'
                                    : 'text-[#888888]'
                                }`}
                              >
                                {isByeMatch ? '✓' : s1}
                              </span>
                            </div>

                            {/* Team 2 Row */}
                            <div className="flex items-center justify-between py-1">
                              <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                <span className="w-4 h-4 rounded-[2px] bg-[#333333] text-[9px] font-bold text-[#888888] flex items-center justify-center shrink-0">
                                  {t2Seed}
                                </span>
                                <span
                                  className={`text-xs truncate ${
                                    isByeMatch
                                      ? 'text-[#777788] uppercase text-[10px] tracking-wider font-semibold'
                                      : t2Winning
                                      ? 'text-[#ff6600] font-bold'
                                      : 'text-[#CCCCCC] font-medium'
                                  }`}
                                >
                                  {t2Name}
                                </span>
                              </div>
                              <span
                                className={`text-xs font-bold tabular-nums px-1.5 py-0.5 rounded ${
                                  t2Winning
                                    ? 'bg-[#ff6600]/10 text-[#ff6600]'
                                    : 'text-[#888888]'
                                }`}
                              >
                                {isByeMatch ? '-' : s2}
                              </span>
                            </div>

                            {/* Click to view live stream prompt */}
                            {isLive && (
                              <div className="pt-2 mt-1 border-t border-[#33384A] flex items-center justify-between text-[10px] text-[#ff6600] font-semibold">
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
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#888888] pt-2 px-1">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3DD68C]" />
              <span>
                Bracket updates dynamically in real-time as admins save results and report match scores.
              </span>
            </div>
            <div className="text-[11px] text-[#666677]">
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
