// The horizontal bracket tree the organizer edits.
import React from 'react';
import { BracketDraft, Match, Team, MatchFormat, MATCH_FORMATS } from '../../../lib/types';
import { TournamentStageBoard } from '../../common/TournamentStageBoard';
import { Trophy } from '../../ui/Icons';
import { CARD_WIDTH, CARD_HEIGHT, BASE_GAP, CONNECTOR_WIDTH, BRACKET_LINE_COLOR, getMatchCenterY } from './shared';

// ── Horizontal Bracket Tree Component ─────────────────────────────────────────

export function canEditRoundFormat(matches: Match[]): boolean {
  return matches.every(match => [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE')
    || (['upcoming', 'pre-match'].includes(match.status)
      && !match.winnerId && match.score.team1Score === 0 && match.score.team2Score === 0));
}

export interface HorizontalBracketTreeProps {
  onRoundFormatChange: (round: number, format: MatchFormat) => void;
  draft: BracketDraft;
  selectedMatchId: string | null;
  onSelectMatch: (match: Match) => void;
  onUpdateTeamName: (matchId: string, teamSlot: 1 | 2, newName: string) => void;
  onScoreChange: (matchId: string, teamSlot: 1 | 2, delta: number) => void;
}

export const HorizontalBracketTree: React.FC<HorizontalBracketTreeProps> = ({
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
                <div className="absolute -top-1 left-0 right-0 z-10 flex items-center justify-between pb-1 border-b border-(--border) text-xs font-bold">
                  <span className={isGrandFinal ? 'text-(--brand-ink)' : 'text-(--text-muted)'}>
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
                      className={`absolute left-0 right-0 rounded-[6px] border bg-(--surface-soft) shadow-md transition-all cursor-pointer ${
                        isSelected
                          ? 'border-(--brand) ring-2 ring-(color:--brand)/40 bg-(--surface-soft)'
                          : isGrandFinal
                          ? 'border-(--brand)/60 bg-(--surface) shadow-(color:--brand)/10 shadow-lg'
                          : 'border-(--border) hover:border-(--border-strong)'
                      }`}
                      style={{ top: `${topY}px`, height: `${CARD_HEIGHT}px` }}
                    >
                      {/* Team 1 Row */}
                      <div className="flex items-center justify-between h-[36px] px-2 border-b border-(--border)">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                          <span className="w-4 h-4 rounded-[3px] bg-(--surface-elevated) text-xs font-bold text-(--text-muted) flex items-center justify-center shrink-0">
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
                                ? 'text-(--brand-ink) font-bold'
                                : 'text-(--text-primary) hover:bg-(--surface) focus:bg-(--bg-base) focus:ring-1 focus:ring-(color:--brand)'
                            }`}
                          />
                        </div>

                        {/* Score or BYE advance tag */}
                        {team2Bye ? (
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-(--success)/20 border border-(--success)/40 text-xs font-bold text-(--success) shrink-0">
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
                              className="w-4 h-4 rounded-[2px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-xs text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center transition-colors cursor-pointer"
                            >
                              -
                            </button>
                            <span
                              className={`w-5 text-center text-xs font-bold tabular-nums ${
                                t1Winning ? 'text-(--brand-ink)' : 'text-(--text-primary)'
                              }`}
                            >
                              {s1}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${match.team1?.name || 'Team 1'} score`}
                  onClick={() => onScoreChange(match.id, 1, 1)}
                              className="w-4 h-4 rounded-[2px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-xs text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center transition-colors cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Team 2 Row */}
                      <div className="flex items-center justify-between h-[36px] px-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                          <span className="w-4 h-4 rounded-[3px] bg-(--surface-elevated) text-xs font-bold text-(--text-muted) flex items-center justify-center shrink-0">
                            {t2Seed}
                          </span>
                          {team2Bye ? (
                            <span className="text-xs text-(--text-muted) font-semibold text-xs px-1">
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
                                  ? 'text-(--brand-ink) font-bold'
                                  : 'text-(--text-primary) hover:bg-(--surface) focus:bg-(--bg-base) focus:ring-1 focus:ring-(color:--brand)'
                              }`}
                            />
                          )}
                        </div>

                        {/* Score and +/- buttons */}
                        {team1Bye && <span className="px-1.5 py-0.5 rounded-[2px] bg-(--success)/20 border border-(--success)/40 text-xs font-bold text-(--success) shrink-0">Advanced</span>}
                        {!isByeMatch && (
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              aria-label={`Decrease ${match.team2?.name || 'Team 2'} score`}
                  onClick={() => onScoreChange(match.id, 2, -1)}
                              className="w-4 h-4 rounded-[2px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-xs text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center transition-colors cursor-pointer"
                            >
                              -
                            </button>
                            <span
                              className={`w-5 text-center text-xs font-bold tabular-nums ${
                                t2Winning ? 'text-(--brand-ink)' : 'text-(--text-primary)'
                              }`}
                            >
                              {s2}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${match.team2?.name || 'Team 2'} score`}
                  onClick={() => onScoreChange(match.id, 2, 1)}
                              className="w-4 h-4 rounded-[2px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-xs text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center transition-colors cursor-pointer"
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
          <div className="absolute top-0 left-0 right-0 z-10 pb-1 border-b border-(--border) text-xs font-bold text-(--warning)">
            Champion
          </div>

          {(() => {
            const finalCenterY = getMatchCenterY(rounds.length - 1, 0) + 24;
            const topY = finalCenterY - 40;

            return (
              <div
                className="absolute left-0 right-0 rounded-[6px] border border-(--warning)/40 bg-(--bg-base) p-3 text-center shadow-lg shadow-(color:--warning)/10"
                style={{ top: `${topY}px` }}
              >
                <Trophy className="w-6 h-6 text-(--warning) mx-auto mb-1" />
                <span className="text-xs font-bold text-(--warning) block">
                  WINNER
                </span>
                <span className="text-xs font-bold text-(--text-primary) block truncate mt-0.5">
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
