import React, { useMemo } from 'react';
import { Match, Player } from '../../lib/types';
import { Swords, Zap, TrendingUp, Users } from '../ui/Icons';

interface PlayerPerformanceSectionProps {
  match: Match;
  className?: string;
}

interface PlayerStatsRow {
  player: Player;
  kills: number;
  deaths: number;
  assists: number;
  kdaRatio: number;
  isMvp: boolean;
}

export const PlayerPerformanceSection: React.FC<PlayerPerformanceSectionProps> = ({
  match,
  className = '',
}) => {
  const mvpIgn = useMemo(() => {
    if (!match.mvp) return '';
    if (typeof match.mvp === 'string') return match.mvp.toLowerCase();
    return (match.mvp.ign || match.mvp.playerName || '').toLowerCase();
  }, [match.mvp]);

  const isCompleted = match.status === 'completed';

  const getPlayerStats = (player: Player): { kills: number; deaths: number; assists: number } => {
    const statsMap = match.playerStats || {};
    // Direct lookup by player ID
    if (statsMap[player.id]) {
      return {
        kills: statsMap[player.id].kills ?? 0,
        deaths: statsMap[player.id].deaths ?? 0,
        assists: statsMap[player.id].assists ?? 0,
      };
    }
    // Lookup by player IGN
    if (statsMap[player.ign]) {
      return {
        kills: statsMap[player.ign].kills ?? 0,
        deaths: statsMap[player.ign].deaths ?? 0,
        assists: statsMap[player.ign].assists ?? 0,
      };
    }
    // Case-insensitive fallback
    const entry = Object.entries(statsMap).find(
      ([key]) =>
        key.toLowerCase() === player.id.toLowerCase() ||
        key.toLowerCase() === player.ign.toLowerCase()
    );
    if (entry) {
      return {
        kills: entry[1].kills ?? 0,
        deaths: entry[1].deaths ?? 0,
        assists: entry[1].assists ?? 0,
      };
    }
    return { kills: 0, deaths: 0, assists: 0 };
  };

  const team1Rows: PlayerStatsRow[] = useMemo(() => {
    return (match.team1?.players || []).map((p) => {
      const { kills, deaths, assists } = getPlayerStats(p);
      const kdaRatio = deaths === 0 ? kills + assists : (kills + assists) / deaths;
      const isMvp =
        isCompleted &&
        mvpIgn !== '' &&
        (p.ign.toLowerCase() === mvpIgn || p.name.toLowerCase() === mvpIgn);

      return { player: p, kills, deaths, assists, kdaRatio, isMvp };
    });
  }, [match.team1, match.playerStats, isCompleted, mvpIgn]);

  const team2Rows: PlayerStatsRow[] = useMemo(() => {
    return (match.team2?.players || []).map((p) => {
      const { kills, deaths, assists } = getPlayerStats(p);
      const kdaRatio = deaths === 0 ? kills + assists : (kills + assists) / deaths;
      const isMvp =
        isCompleted &&
        mvpIgn !== '' &&
        (p.ign.toLowerCase() === mvpIgn || p.name.toLowerCase() === mvpIgn);

      return { player: p, kills, deaths, assists, kdaRatio, isMvp };
    });
  }, [match.team2, match.playerStats, isCompleted, mvpIgn]);

  const team1Totals = useMemo(() => {
    return {
      kills: team1Rows.reduce((sum, r) => sum + r.kills, 0),
      deaths: team1Rows.reduce((sum, r) => sum + r.deaths, 0),
      assists: team1Rows.reduce((sum, r) => sum + r.assists, 0),
    };
  }, [team1Rows]);

  const team2Totals = useMemo(() => {
    return {
      kills: team2Rows.reduce((sum, r) => sum + r.kills, 0),
      deaths: team2Rows.reduce((sum, r) => sum + r.deaths, 0),
      assists: team2Rows.reduce((sum, r) => sum + r.assists, 0),
    };
  }, [team2Rows]);

  const renderTeamTable = (
    teamName: string,
    collegeCode: string,
    isTeam1: boolean,
    rows: PlayerStatsRow[],
    totals: { kills: number; deaths: number; assists: number }
  ) => {
    const codeBg = isTeam1
      ? 'bg-[#202733] text-[#3B82F6] border-[#303E54]'
      : 'bg-[#332020] text-[#EF4444] border-[#543030]';

    return (
      <div className="rounded-[4px] border border-[#2D2D2D] bg-[#1E1E1E] overflow-hidden flex flex-col">
        {/* Team Header Bar */}
        <div className="p-3 bg-[#181818] border-b border-[#282828] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`px-2 py-0.5 rounded-[3px] border font-heading font-black text-xs ${codeBg}`}
            >
              {collegeCode}
            </span>
            <div>
              <h4 className="text-sm font-heading font-bold text-white leading-tight">
                {teamName}
              </h4>
              <span className="text-[11px] text-[#888888]">
                {rows.length} Active Competitors
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-[11px] text-[#888888] uppercase font-semibold">Total:</span>
            <span className="text-[#3DD68C] font-bold">{totals.kills}K</span>
            <span className="text-[#666666]">/</span>
            <span className="text-[#E8544B] font-bold">{totals.deaths}D</span>
            <span className="text-[#666666]">/</span>
            <span className="text-[#ff6600] font-bold">{totals.assists}A</span>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#151515] text-[#888888] border-b border-[#262626] text-[10px] uppercase font-heading font-bold tracking-wider">
                <th className="py-2.5 px-3">Player</th>
                <th className="py-2.5 px-2">Role</th>
                <th className="py-2.5 px-2 text-center text-[#3DD68C]">K</th>
                <th className="py-2.5 px-2 text-center text-[#E8544B]">D</th>
                <th className="py-2.5 px-2 text-center text-[#ff6600]">A</th>
                <th className="py-2.5 px-3 text-right">KDA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#242424]">
              {rows.map(({ player, kills, deaths, assists, kdaRatio, isMvp }) => (
                <tr
                  key={player.id}
                  className={`hover:bg-[#252525] transition-colors ${
                    isMvp ? 'bg-[#ff6600]/10' : ''
                  }`}
                >
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-heading font-black text-white text-xs">
                        {player.ign}
                      </span>
                      {isMvp && (
                        <span className="px-1 py-0.2 rounded-[2px] bg-[#ff6600] text-white text-[9px] font-heading font-black uppercase flex items-center gap-0.5">
                          <Zap className="w-2.5 h-2.5 fill-white" />
                          MVP
                        </span>
                      )}
                    </div>
                    {player.name && player.name !== player.ign && (
                      <span className="text-[10px] text-[#777777] block leading-none truncate max-w-[120px]">
                        {player.name}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-[#AAAAAA] text-[11px]">
                    {player.role}
                  </td>
                  <td className="py-2 px-2 text-center font-mono font-bold text-[#3DD68C]">
                    {kills}
                  </td>
                  <td className="py-2 px-2 text-center font-mono font-bold text-[#AAAAAA]">
                    {deaths}
                  </td>
                  <td className="py-2 px-2 text-center font-mono font-bold text-[#ff6600]">
                    {assists}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-white">
                    {kdaRatio.toFixed(2)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-[#666666] text-xs">
                    No player stats recorded for this lineup.
                  </td>
                </tr>
              )}
            </tbody>
            {/* Table Summary Footer */}
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#151515] border-t border-[#262626] font-heading font-bold text-[11px] text-[#AAAAAA]">
                  <td className="py-2 px-3 text-white">Team Totals</td>
                  <td className="py-2 px-2"></td>
                  <td className="py-2 px-2 text-center text-[#3DD68C] font-mono font-bold">
                    {totals.kills}
                  </td>
                  <td className="py-2 px-2 text-center text-[#AAAAAA] font-mono font-bold">
                    {totals.deaths}
                  </td>
                  <td className="py-2 px-2 text-center text-[#ff6600] font-mono font-bold">
                    {totals.assists}
                  </td>
                  <td className="py-2 px-3 text-right text-white font-mono font-bold">
                    {(
                      totals.deaths === 0
                        ? totals.kills + totals.assists
                        : (totals.kills + totals.assists) / totals.deaths
                    ).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`rounded-[4px] border border-[#333333] bg-[#222222] p-5 space-y-4 shadow-xl ${className}`}
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#2E2E2E] pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[3px] bg-[#33221A] border border-[#ff6600]/50 flex items-center justify-center text-[#ff6600]">
              <Swords className="w-4 h-4 stroke-[2.2]" />
            </div>
            <h3 className="text-base font-heading font-black text-white tracking-tight uppercase">
              Player Performance
            </h3>
          </div>
          <p className="text-xs text-[#888888] mt-1">
            Breakdown table of individual kills, deaths, and assists for participating rosters
          </p>
        </div>

        {/* Global score strip */}
        <div className="flex items-center gap-3 bg-[#181818] px-3 py-1.5 rounded-[4px] border border-[#2F2F2F] self-start sm:self-auto text-xs">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="font-bold text-[#3B82F6]">{match.team1?.collegeCode || 'T1'}: {team1Totals.kills}</span>
            <span className="text-[#666666]">-</span>
            <span className="font-bold text-[#EF4444]">{match.team2?.collegeCode || 'T2'}: {team2Totals.kills}</span>
          </div>
          <span className="text-[#666666]">|</span>
          <span className="text-[11px] text-[#888888] font-mono">
            Total Elims: {team1Totals.kills + team2Totals.kills}
          </span>
        </div>
      </div>

      {/* Side-by-side Dual Breakdown Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Team 1 Breakdown */}
        {renderTeamTable(
          match.team1?.name || 'College of Computing Studies',
          match.team1?.collegeCode || 'CCS',
          true,
          team1Rows,
          team1Totals
        )}

        {/* Team 2 Breakdown */}
        {renderTeamTable(
          match.team2?.name || 'College of Engineering',
          match.team2?.collegeCode || 'COE',
          false,
          team2Rows,
          team2Totals
        )}
      </div>
    </div>
  );
};
