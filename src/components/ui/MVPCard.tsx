import React from 'react';
import { MatchMVP } from '../../lib/types';
import { Award, Zap } from './Icons';

export interface MVPCardProps {
  mvpName?: string;
  mvp?: MatchMVP | string;
  role?: string;
  teamCode?: string;
  kda?: string;
  statsHighlight?: string;
  status?: 'live' | 'completed' | 'upcoming' | 'pre-match' | 'alert' | string;
  className?: string;
}

export const MVPCard: React.FC<MVPCardProps> = ({
  mvpName,
  mvp,
  role,
  teamCode,
  kda,
  statsHighlight,
  status = 'completed',
  className = '',
}) => {
  const mvpObj = typeof mvp === 'object' ? mvp : undefined;
  const resolvedName =
    mvpName ||
    (typeof mvp === 'string' ? mvp : mvpObj?.ign || mvpObj?.playerName || 'Match MVP');
  const displayRole = role || mvpObj?.role;
  const displayTeam = teamCode || mvpObj?.teamCode;
  const displayKda = kda || mvpObj?.kda;
  const displayHighlight = statsHighlight || mvpObj?.statsHighlight;
  const heroOrAgent = mvpObj?.heroOrAgent;
  const fullName =
    mvpObj?.playerName && mvpObj.playerName !== resolvedName
      ? mvpObj.playerName
      : undefined;

  return (
    <div
      className={`rounded-[4px] border border-(--brand)/40 bg-(--surface-elevated) p-4 shadow-xl relative overflow-hidden transition-all hover:border-(--brand) ${className}`}
    >
      {/* Subtle brand accent glow */}
      <div className="absolute top-0 right-0 w-60 h-full bg-radial from-(--brand)/10 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Trophy/Award Icon + Match MVP Badge + Name */}
        <div className="flex items-center gap-3.5">
          {/* Icon in brand accent style */}
          <div className="w-11 h-11 rounded-[4px] bg-(--surface-elevated) border border-(--brand)/50 flex items-center justify-center text-(--brand-ink) shrink-0 shadow-inner">
            <Award className="w-5 h-5 stroke-[2.2]" />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              {/* Match MVP Badge using Brand Accent (#ff6600) */}
              <span className="px-2 py-0.5 rounded-[3px] bg-(--brand) text-white text-xs font-heading font-bold flex items-center gap-1 shadow-sm">
                <Zap className="w-3 h-3 fill-white" />
                Match MVP
              </span>

              {displayTeam && (
                <span className="text-xs text-(--text-secondary) font-medium">
                  {displayTeam} {mvpObj?.collegeName ? `— ${mvpObj.collegeName}` : ''}
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2 flex-wrap">
              <h4 className="text-xl font-heading font-bold text-(--text-primary) tracking-tight leading-none">
                {resolvedName}
              </h4>

              {fullName && (
                <span className="text-xs text-(--text-muted) font-medium">
                  ({fullName})
                </span>
              )}

              {displayRole && (
                <>
                  <span className="text-xs text-(--text-muted)">·</span>
                  <span className="text-xs text-(--text-secondary) font-medium">
                    {displayRole} {heroOrAgent ? `· ${heroOrAgent}` : ''}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Compact stats */}
        {(displayKda || displayHighlight) && (
          <div className="flex items-center gap-4 sm:border-l sm:border-(--border-strong) sm:pl-5 shrink-0 text-xs">
            {displayKda && (
              <div>
                <span className="text-xs text-(--text-muted) block font-semibold">
                  KDA
                </span>
                <span className="text-sm font-heading font-bold text-(--text-primary) tabular-nums tabular-nums">
                  {displayKda}
                </span>
              </div>
            )}

            {displayHighlight && (
              <div>
                <span className="text-xs text-(--text-muted) block font-semibold">
                  HIGHLIGHT
                </span>
                <span className="text-xs text-(--brand-ink) font-semibold block tabular-nums">
                  {displayHighlight}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
