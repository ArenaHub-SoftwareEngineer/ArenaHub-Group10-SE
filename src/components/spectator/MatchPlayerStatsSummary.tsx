import React, { useState, useMemo } from 'react';
import { Match, PlayerMatchStats, Player } from '../../lib/types';
import { combineStatSheets, matchStatSheets } from '../../lib/matchStats';
import {
  Swords,
  Trophy,
  Zap,
  Target,
  Shield,
  Award,
  ChevronDown,
  ChevronUp,
} from '../ui/Icons';

interface MatchPlayerStatsSummaryProps {
  match: Match;
  className?: string;
}

interface EnrichedPlayerStat extends PlayerMatchStats {
  id: string;
  ign: string;
  playerName?: string;
  role: string;
  teamCode: string;
  teamName: string;
  isTeam1: boolean;
  kdaRatio: number;
  isMvp: boolean;
}

export const MatchPlayerStatsSummary: React.FC<MatchPlayerStatsSummaryProps> = ({
  match,
  className = '',
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'team1' | 'team2'>('all');
  const [sortBy, setSortBy] = useState<'kda' | 'kills' | 'assists'>('kills');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  // Series totals by default; a single game on request. Each game is its own sheet in statGames.
  const sheets = useMemo(() => matchStatSheets(match), [match]);
  const [chosenGame, setChosenGame] = useState<number | 'series'>('series');
  const view = chosenGame !== 'series' && sheets.some(sheet => sheet.game === chosenGame) ? chosenGame : 'series';
  const statsMap = useMemo(() => combineStatSheets(match, view === 'series' ? sheets : sheets.filter(sheet => sheet.game === view)), [match, sheets, view]);
  const numberedGames = sheets.filter(sheet => sheet.game !== null).map(sheet => sheet.game as number);
  const scopeLabel = view !== 'series' ? `Game ${view} only`
    : numberedGames.length ? `Series totals · ${numberedGames.length} game${numberedGames.length === 1 ? '' : 's'} with stats (${numberedGames.map(n => `G${n}`).join(', ')})`
    : 'Stats recorded for this match';

  const team1Code = match.team1?.collegeCode || 'T1';
  const team2Code = match.team2?.collegeCode || 'T2';
  const team1Name = match.team1?.name || 'Team 1';
  const team2Name = match.team2?.name || 'Team 2';

  const mvpIgn = useMemo(() => {
    if (!match.mvp) return '';
    if (typeof match.mvp === 'string') return match.mvp.toLowerCase();
    return (match.mvp.ign || match.mvp.playerName || '').toLowerCase();
  }, [match.mvp]);

  // Aggregate players and stats
  const enrichedStats = useMemo(() => {
    const list: EnrichedPlayerStat[] = [];

    const findStat = (player: Player): PlayerMatchStats | undefined => {
      if (statsMap[player.id]) return statsMap[player.id];
      if (statsMap[player.ign]) return statsMap[player.ign];
      // Case-insensitive match on ign or id
      const entry = Object.entries(statsMap).find(
        ([key]) =>
          key.toLowerCase() === player.id.toLowerCase() ||
          key.toLowerCase() === player.ign.toLowerCase()
      );
      return entry ? entry[1] : undefined;
    };

    // Process Team 1 players
    (match.team1?.players || []).forEach((p) => {
      const stat = findStat(p);
      const kills = stat?.kills ?? 0;
      const deaths = stat?.deaths ?? 0;
      const assists = stat?.assists ?? 0;
      const kdaRatio = deaths === 0 ? kills + assists : (kills + assists) / deaths;
      const isMvp =
        match.status === 'completed' &&
        mvpIgn !== '' &&
        (p.ign.toLowerCase() === mvpIgn || p.name.toLowerCase() === mvpIgn);

      list.push({
        id: p.id,
        playerId: p.id,
        ign: p.ign,
        playerName: p.name,
        role: p.role,
        teamCode: team1Code,
        teamName: team1Name,
        isTeam1: true,
        kills,
        deaths,
        assists,
        cs: stat?.cs,
        gold: stat?.gold,
        damage: stat?.damage,
        kdaRatio,
        isMvp,
      });
    });

    // Process Team 2 players
    (match.team2?.players || []).forEach((p) => {
      const stat = findStat(p);
      const kills = stat?.kills ?? 0;
      const deaths = stat?.deaths ?? 0;
      const assists = stat?.assists ?? 0;
      const kdaRatio = deaths === 0 ? kills + assists : (kills + assists) / deaths;
      const isMvp =
        match.status === 'completed' &&
        mvpIgn !== '' &&
        (p.ign.toLowerCase() === mvpIgn || p.name.toLowerCase() === mvpIgn);

      list.push({
        id: p.id,
        playerId: p.id,
        ign: p.ign,
        playerName: p.name,
        role: p.role,
        teamCode: team2Code,
        teamName: team2Name,
        isTeam1: false,
        kills,
        deaths,
        assists,
        cs: stat?.cs,
        gold: stat?.gold,
        damage: stat?.damage,
        kdaRatio,
        isMvp,
      });
    });

    // If playerStats contains entries not in team1/team2 players list (e.g. standalone stats)
    if (list.length === 0 && Object.keys(statsMap).length > 0) {
      Object.entries(statsMap).forEach(([key, s], idx) => {
        const kills = s.kills ?? 0;
        const deaths = s.deaths ?? 0;
        const assists = s.assists ?? 0;
        const kdaRatio = deaths === 0 ? kills + assists : (kills + assists) / deaths;
        const isTeam1 = s.teamCode ? s.teamCode === team1Code : idx < Object.keys(statsMap).length / 2;
        const ign = s.ign || s.playerName || key;
        const isMvp = match.status === 'completed' && mvpIgn !== '' && ign.toLowerCase() === mvpIgn;

        list.push({
          id: s.playerId || key,
          playerId: s.playerId || key,
          ign,
          playerName: s.playerName,
          role: s.role || 'Player',
          teamCode: s.teamCode || (isTeam1 ? team1Code : team2Code),
          teamName: isTeam1 ? team1Name : team2Name,
          isTeam1,
          kills,
          deaths,
          assists,
          cs: s.cs,
          gold: s.gold,
          damage: s.damage,
          kdaRatio,
          isMvp,
        });
      });
    }

    return list;
  }, [match, statsMap, team1Code, team2Code, team1Name, team2Name, mvpIgn]);

  // Leaders
  const killLeader = useMemo(() => {
    if (!enrichedStats.length) return null;
    return [...enrichedStats].sort((a, b) => b.kills - a.kills)[0];
  }, [enrichedStats]);

  const assistLeader = useMemo(() => {
    if (!enrichedStats.length) return null;
    return [...enrichedStats].sort((a, b) => b.assists - a.assists)[0];
  }, [enrichedStats]);

  const team1Totals = useMemo(() => {
    const t1 = enrichedStats.filter((s) => s.isTeam1);
    return {
      kills: t1.reduce((sum, s) => sum + s.kills, 0),
      deaths: t1.reduce((sum, s) => sum + s.deaths, 0),
      assists: t1.reduce((sum, s) => sum + s.assists, 0),
    };
  }, [enrichedStats]);

  const team2Totals = useMemo(() => {
    const t2 = enrichedStats.filter((s) => !s.isTeam1);
    return {
      kills: t2.reduce((sum, s) => sum + s.kills, 0),
      deaths: t2.reduce((sum, s) => sum + s.deaths, 0),
      assists: t2.reduce((sum, s) => sum + s.assists, 0),
    };
  }, [enrichedStats]);

  // Filtered & Sorted
  const displayedStats = useMemo(() => {
    let result = enrichedStats;
    if (activeTab === 'team1') {
      result = result.filter((s) => s.isTeam1);
    } else if (activeTab === 'team2') {
      result = result.filter((s) => !s.isTeam1);
    }

    return [...result].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'kills') {
        comparison = b.kills - a.kills || b.assists - a.assists;
      } else if (sortBy === 'assists') {
        comparison = b.assists - a.assists || b.kills - a.kills;
      } else if (sortBy === 'kda') {
        comparison = b.kdaRatio - a.kdaRatio;
      }
      return sortOrder === 'desc' ? comparison : -comparison;
    });
  }, [enrichedStats, activeTab, sortBy, sortOrder]);

  const handleSort = (field: 'kda' | 'kills' | 'assists') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  if (enrichedStats.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded-[4px] border border-(--border) bg-(--surface-soft) p-5 space-y-4 shadow-xl ${className}`}
    >
      {/* Header with Title & Filter Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-(--border) pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[3px] bg-(--surface-elevated) border border-(--brand)/50 flex items-center justify-center text-(--brand-ink)">
              <Swords className="w-4 h-4 stroke-[2.2]" />
            </div>
            <h3 className="text-base font-heading font-bold text-(--text-primary) tracking-tight">
              Player Performance Summary
            </h3>
          </div>
          <p className="text-xs text-(--text-muted) mt-1">
            {scopeLabel}
          </p>
        </div>

        {/* Tab Controls: All / Team 1 / Team 2 */}
        <div className="flex items-center bg-(--bg-base) p-1 rounded-[4px] border border-(--border) self-start sm:self-auto text-xs">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1 rounded-[3px] font-heading font-bold transition-all cursor-pointer ${
              activeTab === 'all'
                ? 'bg-(--brand) text-white shadow-sm'
                : 'text-(--text-muted) hover:text-white'
            }`}
          >
            All Players ({enrichedStats.length})
          </button>
          <button
            onClick={() => setActiveTab('team1')}
            className={`px-3 py-1 rounded-[3px] font-heading font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'team1'
                ? 'bg-(--surface-elevated) text-(--brand-ink) border border-(--info-border)'
                : 'text-(--text-muted) hover:text-(--brand-ink)'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-(--brand)" />
            {team1Code}
          </button>
          <button
            onClick={() => setActiveTab('team2')}
            className={`px-3 py-1 rounded-[3px] font-heading font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'team2'
                ? 'bg-(--surface-elevated) text-(--danger) border border-(--danger-border)'
                : 'text-(--text-muted) hover:text-(--danger)'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-(--danger)" />
            {team2Code}
          </button>
        </div>
      </div>

      {numberedGames.length > 1 && <div className="ah-tabs" role="tablist" aria-label="Stats for">
        <button type="button" role="tab" aria-selected={view === 'series'} onClick={() => setChosenGame('series')}>Series</button>
        {numberedGames.map(game => <button key={game} type="button" role="tab" aria-selected={view === game} onClick={() => setChosenGame(game)}>Game {game}</button>)}
      </div>}

      {/* Team Aggregates & Highlights Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Team Kills Comparison */}
        <div className="rounded-[4px] bg-(--surface) border border-(--border) p-3 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs text-(--text-muted) font-bold block">
              Team Kills Score
            </span>
            <div className="flex items-center gap-2 tabular-nums text-xs">
              <span className="text-(--info) font-bold">{team1Code}: {team1Totals.kills}</span>
              <span className="text-(--text-muted)">vs</span>
              <span className="text-(--danger) font-bold">{team2Code}: {team2Totals.kills}</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-(--text-muted) block">Total elims</span>
            <span className="text-lg font-heading font-bold text-(--text-primary) tabular-nums">
              {team1Totals.kills + team2Totals.kills}
            </span>
          </div>
        </div>

        {/* Top Frag / Kill Leader */}
        {killLeader && (
          <div className="rounded-[4px] bg-(--surface) border border-(--border) p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[4px] bg-(--surface-soft) border border-(--brand)/40 flex items-center justify-center text-(--brand-ink) shrink-0">
                <Target className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs text-(--brand-ink) font-bold block">
                  Kill Leader
                </span>
                <span className="text-xs font-heading font-bold text-(--text-primary) truncate block">
                  {killLeader.ign} ({killLeader.teamCode})
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-(--text-muted) block">Kills</span>
              <span className="text-base font-heading font-bold text-(--success) tabular-nums">
                {killLeader.kills}
              </span>
            </div>
          </div>
        )}

        {/* Playmaker / Assist Leader */}
        {assistLeader && (
          <div className="rounded-[4px] bg-(--surface) border border-(--border) p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[4px] bg-(--surface-elevated) border border-(--brand)/40 flex items-center justify-center text-(--brand-ink) shrink-0">
                <Shield className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs text-(--brand-ink) font-bold block">
                  Top Playmaker
                </span>
                <span className="text-xs font-heading font-bold text-(--text-primary) truncate block">
                  {assistLeader.ign} ({assistLeader.teamCode})
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-(--text-muted) block">Assists</span>
              <span className="text-base font-heading font-bold text-(--brand-ink) tabular-nums">
                {assistLeader.assists}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Stats Table */}
      <div className="overflow-x-auto rounded-[4px] border border-(--border)">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-(--surface) text-(--text-muted) border-b border-(--border) font-heading font-bold text-xs">
              <th className="py-2.5 px-3">Player</th>
              <th className="py-2.5 px-3">Team</th>
              <th className="py-2.5 px-3">Role</th>
              <th
                onClick={() => handleSort('kills')}
                className="py-2.5 px-3 text-center cursor-pointer hover:text-(--text-primary) transition-colors select-none"
              >
                <div className="inline-flex items-center gap-1">
                  <span>Kills</span>
                  {sortBy === 'kills' && (
                    sortOrder === 'desc' ? <ChevronDown className="w-3 h-3 text-(--brand-ink)" /> : <ChevronUp className="w-3 h-3 text-(--brand-ink)" />
                  )}
                </div>
              </th>
              <th className="py-2.5 px-3 text-center">Deaths</th>
              <th
                onClick={() => handleSort('assists')}
                className="py-2.5 px-3 text-center cursor-pointer hover:text-(--text-primary) transition-colors select-none"
              >
                <div className="inline-flex items-center gap-1">
                  <span>Assists</span>
                  {sortBy === 'assists' && (
                    sortOrder === 'desc' ? <ChevronDown className="w-3 h-3 text-(--brand-ink)" /> : <ChevronUp className="w-3 h-3 text-(--brand-ink)" />
                  )}
                </div>
              </th>
              <th
                onClick={() => handleSort('kda')}
                className="py-2.5 px-3 text-center cursor-pointer hover:text-(--text-primary) transition-colors select-none"
              >
                <div className="inline-flex items-center gap-1">
                  <span>KDA Ratio</span>
                  {sortBy === 'kda' && (
                    sortOrder === 'desc' ? <ChevronDown className="w-3 h-3 text-(--brand-ink)" /> : <ChevronUp className="w-3 h-3 text-(--brand-ink)" />
                  )}
                </div>
              </th>
              <th className="py-2.5 px-3 text-right">CS / Gold</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {displayedStats.map((p) => {
              const kdaFormatted = `${p.kills} / ${p.deaths} / ${p.assists}`;
              return (
                <tr
                  key={p.id}
                  className={`hover:bg-(--surface-elevated) transition-colors ${
                    p.isMvp ? 'bg-(--brand)/5' : ''
                  }`}
                >
                  {/* Player Name & Badge */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-7 h-7 rounded-[3px] flex items-center justify-center text-xs font-bold tabular-nums ${
                          p.isTeam1
                            ? 'bg-(--surface-elevated) text-(--info) border border-(--info-border)'
                            : 'bg-(--surface-elevated) text-(--danger) border border-(--danger-border)'
                        }`}
                      >
                        {p.ign.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-heading font-bold text-(--text-primary) text-xs">
                            {p.ign}
                          </span>
                          {p.isMvp && (
                            <span className="px-1.5 py-0.2 rounded-[2px] bg-(--brand) text-white text-xs font-heading font-bold flex items-center gap-0.5">
                              <Zap className="w-2.5 h-2.5 fill-white" />
                              MVP
                            </span>
                          )}
                        </div>
                        {p.playerName && p.playerName !== p.ign && (
                          <span className="text-xs text-(--text-muted) block leading-none">
                            {p.playerName}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Team */}
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded-[3px] text-xs font-heading font-bold ${
                        p.isTeam1
                          ? 'bg-(--surface-elevated) text-(--info)'
                          : 'bg-(--surface-elevated) text-(--danger)'
                      }`}
                    >
                      {p.teamCode}
                    </span>
                  </td>

                  {/* Role */}
                  <td className="py-2.5 px-3 text-(--text-secondary) text-xs font-medium">
                    {p.role}
                  </td>

                  {/* Kills */}
                  <td className="py-2.5 px-3 text-center">
                    <span
                      className={`font-heading font-bold tabular-nums text-xs ${
                        p.kills > 0 ? 'text-(--success)' : 'text-(--text-muted)'
                      }`}
                    >
                      {p.kills}
                    </span>
                  </td>

                  {/* Deaths */}
                  <td className="py-2.5 px-3 text-center">
                    <span
                      className={`font-heading font-bold tabular-nums text-xs ${
                        p.deaths > 3 ? 'text-(--danger)' : 'text-(--text-secondary)'
                      }`}
                    >
                      {p.deaths}
                    </span>
                  </td>

                  {/* Assists */}
                  <td className="py-2.5 px-3 text-center">
                    <span
                      className={`font-heading font-bold tabular-nums text-xs ${
                        p.assists > 5 ? 'text-(--brand-ink)' : 'text-(--text-secondary)'
                      }`}
                    >
                      {p.assists}
                    </span>
                  </td>

                  {/* KDA Ratio & breakdown */}
                  <td className="py-2.5 px-3 text-center tabular-nums">
                    <span className="font-heading font-bold text-(--text-primary) text-xs block">
                      {p.kdaRatio.toFixed(2)}
                    </span>
                    <span className="text-xs text-(--text-muted) block">
                      {kdaFormatted}
                    </span>
                  </td>

                  {/* CS / Gold */}
                  <td className="py-2.5 px-3 text-right tabular-nums text-(--text-secondary)">
                    {p.gold && (
                      <span className="text-(--brand-ink) text-xs font-semibold block">
                        {p.gold}
                      </span>
                    )}
                    {p.cs !== undefined && (
                      <span className="text-xs text-(--text-muted) block">
                        {p.cs} CS
                      </span>
                    )}
                    {!p.gold && p.cs === undefined && (
                      <span className="text-xs text-(--text-muted)">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
