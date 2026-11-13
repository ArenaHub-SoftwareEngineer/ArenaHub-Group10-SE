/**
 * AdminMatchDataEntry.tsx
 *
 * Admin tool to input per-player game data (kills, deaths, assists, hero, notes)
 * for each game, persist the entered data, and calculate a descriptive KDA summary.
 */

import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../lib/firestore';
import { Match, Team, seriesGameCount } from '../../lib/types';
import { useToast } from '../ui/Toast';
import {
  Swords,
  Sparkles,
  Save,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  User,
  Zap,
  Trophy,
  RefreshCw,
  ClipboardList,
} from '../ui/Icons';

interface PlayerStatRow {
  playerId: string;
  playerName: string;
  ign: string;
  role: string;
  kills: string;
  deaths: string;
  assists: string;
  hero: string;
  gold: string;
  damage: string;
  notes: string;
}

interface AdminMatchDataEntryProps {
  matches: Match[];
}

const makeBlankRows = (team?: Team): PlayerStatRow[] => {
  if (!team?.players?.length) {
    return Array.from({ length: 5 }, (_, i) => ({
      playerId: `${team?.id || 'unassigned'}-placeholder-${i}`,
      playerName: `Player ${i + 1}`,
      ign: '',
      role: ['Roamer', 'Gold', 'EXP', 'Mid', 'Jungle'][i] || 'Player',
      kills: '',
      deaths: '',
      assists: '',
      hero: '',
      gold: '',
      damage: '',
      notes: '',
    }));
  }
  return team.players.map((p) => ({
    playerId: p.id,
    playerName: p.name,
    ign: p.ign,
    role: p.role,
    kills: '',
    deaths: '',
    assists: '',
    hero: p.signatureHero || '',
    gold: '',
    damage: '',
    notes: '',
  }));
};

export const AdminMatchDataEntry: React.FC<AdminMatchDataEntryProps> = ({ matches }) => {
  const { showToast } = useToast();
  const liveMatches = matches.filter((m) => m.status === 'live' || m.status === 'pre-match' || m.status === 'upcoming');
  const [selectedMatchId, setSelectedMatchId] = useState<string>(liveMatches[0]?.id || matches[0]?.id || '');
  const selectedMatch = matches.find((m) => m.id === selectedMatchId) || matches[0];

  const [team1Rows, setTeam1Rows] = useState<PlayerStatRow[]>(() => makeBlankRows(selectedMatch?.team1));
  const [team2Rows, setTeam2Rows] = useState<PlayerStatRow[]>(() => makeBlankRows(selectedMatch?.team2));

  const [collapseTeam1, setCollapseTeam1] = useState(false);
  const [collapseTeam2, setCollapseTeam2] = useState(false);
  const [gameNumber, setGameNumber] = useState('1');
  const [matchNotes, setMatchNotes] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [analysisIndex, setAnalysisIndex] = useState(0);

  const handleMatchChange = (matchId: string) => {
    const m = matches.find((x) => x.id === matchId);
    setSelectedMatchId(matchId);
    setGameNumber('1');
    setTeam1Rows(makeBlankRows(m?.team1));
    setTeam2Rows(makeBlankRows(m?.team2));
    setIsSaved(false);
    setAiAnalysis(null);
  };

  const updateRow = (
    team: 'team1' | 'team2',
    index: number,
    field: keyof PlayerStatRow,
    value: string
  ) => {
    const setter = team === 'team1' ? setTeam1Rows : setTeam2Rows;
    const rows = team === 'team1' ? [...team1Rows] : [...team2Rows];
    rows[index] = { ...rows[index], [field]: value };
    setter(rows);
    setIsSaved(false);
  };

  useEffect(() => {
    const saved = selectedMatch?.statGames?.[gameNumber];
    const hydrate = (team?: Team) => makeBlankRows(team).map(row => {
      const stat = saved?.playerStats[row.playerId];
      return stat ? { ...row, kills: String(stat.kills), deaths: String(stat.deaths), assists: String(stat.assists), hero: String(stat.hero || row.hero), gold: String(stat.gold || ''), damage: String(stat.damage || ''), notes: String(stat.notes || '') } : row;
    });
    setTeam1Rows(hydrate(selectedMatch?.team1)); setTeam2Rows(hydrate(selectedMatch?.team2));
    setMatchNotes(saved?.notes || ''); setIsSaved(Boolean(saved)); setAiAnalysis(null);
  }, [selectedMatchId, gameNumber]);
  const handleSave = async () => {
    if (!selectedMatch || !selectedMatch.team1 || !selectedMatch.team2 || selectedMatch.team1.isBye || selectedMatch.team2.isBye || selectedMatch.team1.name === 'TBD' || selectedMatch.team2.name === 'TBD') { showToast('Choose a match with two confirmed teams before entering stats.', 'error'); return; }
    const maxGames = Number(selectedMatch.matchFormat.replace('Bo', ''));
    if (!Number.isInteger(Number(gameNumber)) || Number(gameNumber) < 1 || Number(gameNumber) > maxGames) { showToast('Choose a valid game number for this series.', 'error'); return; }
    const rows = [...team1Rows, ...team2Rows].filter(r => r.kills !== '' || r.deaths !== '' || r.assists !== '');
    if (!rows.length || rows.some(r => [r.kills, r.deaths, r.assists].some(v => v === '' || !Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 999))) {
      showToast('Enter complete, non-negative whole-number K/D/A stats for each included player.', 'error'); return;
    }
    if (rows.some(row => [row.gold, row.damage].some(value => value.trim() !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)))) { showToast('Gold and damage must be non-negative numbers.', 'error'); return; }
    const stats = Object.fromEntries(rows.map(r => [r.playerId, { kills: Number(r.kills), deaths: Number(r.deaths), assists: Number(r.assists), playerName: r.playerName, ign: r.ign, role: r.role, hero: r.hero, gold: r.gold, damage: r.damage, notes: r.notes, teamCode: team1Rows.some(p => p.playerId === r.playerId) ? selectedMatch.team1?.collegeCode || '' : selectedMatch.team2?.collegeCode || '' }]));
    try {
      firestoreService.saveMatchPlayerStats(selectedMatch.id, stats, gameNumber, matchNotes);
      await firestoreService.syncBracketsToCloud();
      setIsSaved(true); showToast('Game stats saved to the published match.', 'success');
    } catch (error) { setIsSaved(false); showToast(error instanceof Error ? error.message : 'Stats could not be shared. Retry saving.', 'error'); }
  };

  const handleAnalyze = () => {
    const filledRows = [...team1Rows, ...team2Rows].filter(
      (r) => r.kills !== '' || r.deaths !== '' || r.assists !== ''
    );
    if (filledRows.length < 3) {
      showToast('Enter stats for at least 3 players before running stats summary.', 'error');
      return;
    }
    const invalid = filledRows.some(r => [r.kills, r.deaths, r.assists].some(v => v === '' || !Number.isInteger(Number(v)) || Number(v) < 0));
    if (invalid) { showToast('Complete each included player’s K/D/A with non-negative whole numbers.', 'error'); return; }
    const ranked = [...filledRows].sort((a, b) => (Number(b.kills) + Number(b.assists)) / Math.max(1, Number(b.deaths)) - (Number(a.kills) + Number(a.assists)) / Math.max(1, Number(a.deaths)));
    const lines = ranked.map(r => `${r.ign || r.playerName}: ${r.kills}/${r.deaths}/${r.assists} · KDA ${((Number(r.kills) + Number(r.assists)) / Math.max(1, Number(r.deaths))).toFixed(2)}`);
    setAiAnalysis(`Match ${selectedMatch?.matchNumber} · Game ${gameNumber}\n\n${filledRows.length} players with complete entered stats.\n${lines.join('\n')}\n\nHighest entered KDA: ${ranked[0].ign || ranked[0].playerName}. This is a descriptive stat, not an MVP verdict or win prediction.\n${matchNotes ? `\nOrganizer observations: ${matchNotes}` : ''}`);
    showToast('Stats summary ready.', 'success');
  };


  const renderStatInput = (
    team: 'team1' | 'team2',
    rows: PlayerStatRow[],
    accentColor: string,
    teamCode: string
  ) => {
    const collapsed = team === 'team1' ? collapseTeam1 : collapseTeam2;
    const setCollapsed = team === 'team1' ? setCollapseTeam1 : setCollapseTeam2;

    return (
      <div className="rounded-[4px] border border-(--border) bg-(--surface-soft) overflow-hidden">
        {/* Team Header */}
        <button
          aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between p-4 hover:bg-(--surface-elevated) transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <span
              className="px-2.5 py-1 rounded-[3px] font-heading font-bold text-xs"
              style={{ backgroundColor: `${accentColor}30`, color: 'var(--text-primary)', border: `1px solid ${accentColor}80` }}
            >
              {teamCode}
            </span>
            <span className="text-sm font-heading font-bold text-(--text-primary)">
              {team === 'team1'
                ? selectedMatch?.team1?.name || 'Team 1'
                : selectedMatch?.team2?.name || 'Team 2'}
            </span>
            <span className="text-xs text-(--text-muted)">— {rows.length} players</span>
          </div>
          {collapsed ? (
            <ChevronDown className="w-4 h-4 text-(--text-muted)" />
          ) : (
            <ChevronUp className="w-4 h-4 text-(--text-muted)" />
          )}
        </button>

        {!collapsed && (
          <div className="overflow-x-auto border-t border-(--border)">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-(--border) bg-(--surface)">
                  {[
                    'Player / IGN',
                    'Role',
                    'Hero / Agent',
                    'K',
                    'D',
                    'A',
                    'Gold (K)',
                    'Dmg (K)',
                    'Notes',
                  ].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-xs font-bold text-(--text-muted) whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {rows.map((row, i) => (
                  <tr key={row.playerId} className="hover:bg-(--surface-soft) transition-colors">
                    {/* Player Name */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-[3px] flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
                        >
                          <User className="w-3 h-3" />
                        </div>
                        <div>
                          <div className="font-semibold text-(--text-primary) text-xs leading-tight">{row.ign || row.playerName}</div>
                          {row.ign && <div className="text-xs text-(--text-muted)">{row.playerName}</div>}
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded-[2px] bg-(--surface-soft) border border-(--border) text-xs font-bold text-(--text-secondary)">
                        {row.role}
                      </span>
                    </td>

                    {/* Hero */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        aria-label={`${teamCode} ${row.ign || row.playerName} hero or agent`} value={row.hero}
                        onChange={(e) => updateRow(team, i, 'hero', e.target.value)}
                        placeholder="e.g. Chou"
                        className="bg-(--surface) border border-(--border) rounded-[3px] px-2 py-1 text-xs text-(--text-primary) placeholder-(--text-muted) outline-none focus:border-(--brand)/60 w-24 transition-colors"
                      />
                    </td>

                    {/* K */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0" max="999" step="1"
                        aria-label={`${teamCode} ${row.ign || row.playerName} kills`} value={row.kills}
                        onChange={(e) => updateRow(team, i, 'kills', e.target.value)}
                        placeholder="0"
                        className="bg-(--surface) border border-(--border) rounded-[3px] px-2 py-1 text-xs text-(--success) placeholder-(--text-muted) outline-none focus:border-(--success)/60 w-14 tabular-nums transition-colors"
                      />
                    </td>

                    {/* D */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0" max="999" step="1"
                        aria-label={`${teamCode} ${row.ign || row.playerName} deaths`} value={row.deaths}
                        onChange={(e) => updateRow(team, i, 'deaths', e.target.value)}
                        placeholder="0"
                        className="bg-(--surface) border border-(--border) rounded-[3px] px-2 py-1 text-xs text-(--danger) placeholder-(--text-muted) outline-none focus:border-(--danger)/60 w-14 tabular-nums transition-colors"
                      />
                    </td>

                    {/* A */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0" max="999" step="1"
                        aria-label={`${teamCode} ${row.ign || row.playerName} assists`} value={row.assists}
                        onChange={(e) => updateRow(team, i, 'assists', e.target.value)}
                        placeholder="0"
                        className="bg-(--surface) border border-(--border) rounded-[3px] px-2 py-1 text-xs text-(--info) placeholder-(--text-muted) outline-none focus:border-(--brand)/60 w-14 tabular-nums transition-colors"
                      />
                    </td>

                    {/* Gold */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        aria-label={`${teamCode} ${row.ign || row.playerName} gold in thousands`} value={row.gold}
                        onChange={(e) => updateRow(team, i, 'gold', e.target.value)}
                        placeholder="12.4"
                        className="bg-(--surface) border border-(--border) rounded-[3px] px-2 py-1 text-xs text-(--warning) placeholder-(--text-muted) outline-none focus:border-(--warning)/60 w-16 tabular-nums transition-colors"
                      />
                    </td>

                    {/* Damage */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        aria-label={`${teamCode} ${row.ign || row.playerName} damage in thousands`} value={row.damage}
                        onChange={(e) => updateRow(team, i, 'damage', e.target.value)}
                        placeholder="43.2"
                        className="bg-(--surface) border border-(--border) rounded-[3px] px-2 py-1 text-xs text-(--brand-ink) placeholder-(--text-muted) outline-none focus:border-(--brand)/60 w-16 tabular-nums transition-colors"
                      />
                    </td>

                    {/* Notes */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        aria-label={`${teamCode} ${row.ign || row.playerName} notes`} value={row.notes}
                        onChange={(e) => updateRow(team, i, 'notes', e.target.value)}
                        placeholder="Optional notes…"
                        className="bg-(--surface) border border-(--border) rounded-[3px] px-2 py-1 text-xs text-(--text-primary) placeholder-(--text-muted) outline-none focus:border-(--border-strong) w-36 transition-colors"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading font-bold text-(--text-primary) flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-(--brand-ink)" />
            Match Player Data Entry
          </h2>
          <p className="text-xs text-(--text-muted) mt-1">
            Save per-game player stats and compare KDA using the data you enter.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-[4px] bg-(--surface-soft) hover:bg-(--surface-elevated) border border-(--border) text-xs font-semibold text-(--text-primary) transition-colors cursor-pointer"
          >
            {isSaved ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-(--brand-ink)" />
                <span className="text-(--brand-ink)">Saved</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Data</span>
              </>
            )}
          </button>

          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-[4px] bg-(--brand) hover:bg-(--brand-hover) disabled:opacity-60 text-black text-xs font-bold transition-all shadow-lg shadow-(color:--brand)/20 hover:shadow-(color:--brand)/30 cursor-pointer"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Analyzing…</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Summarize stats</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Match Selector + Game Number */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-[4px] bg-(--surface-soft) border border-(--border) p-4 space-y-2">
          <label className="text-xs font-bold text-(--text-muted) block">
            Select Match
          </label>
          <select aria-label="Select match"
            value={selectedMatchId}
            onChange={(e) => handleMatchChange(e.target.value)}
            className="w-full bg-(--surface) border border-(--border) rounded-[4px] px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--brand)/60 transition-colors cursor-pointer"
          >
            {matches.filter(m => !m.team1?.isBye && !m.team2?.isBye).map((m) => (
              <option key={m.id} value={m.id}>
                {m.matchNumber} — {m.team1?.collegeCode || 'TBD'} vs {m.team2?.collegeCode || 'TBD'} · {m.status.toUpperCase()}
              </option>
            ))}
          </select>

          <div className="pt-1 flex items-center gap-3 text-xs text-(--text-muted)">
            <span>Round:</span>
            <span className="text-(--text-primary) font-semibold">{selectedMatch?.roundName || '—'}</span>
            <span>·</span>
            <span>Format:</span>
            <span className="text-(--text-primary) font-semibold">{selectedMatch?.matchFormat || 'Bo3'}</span>
          </div>
        </div>

        <div className="rounded-[4px] bg-(--surface-soft) border border-(--border) p-4 space-y-2">
          <label className="text-xs font-bold text-(--text-muted) block">
            Game Number (within series)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {Array.from({ length: seriesGameCount(selectedMatch?.matchFormat || 'Bo3') }, (_, i) => String(i + 1)).map((g) => (
              <button
                key={g}
                onClick={() => setGameNumber(g)}
                className={`w-10 h-10 rounded-[4px] border text-sm font-bold transition-all cursor-pointer ${
                  gameNumber === g
                    ? 'bg-(--brand) border-(--brand) text-black'
                    : 'bg-(--surface) border-(--border) text-(--text-muted) hover:border-(--brand)/50 hover:text-white'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <p className="text-xs text-(--text-muted)">
            Entering stats for Game {gameNumber} of the {selectedMatch?.matchFormat || 'Bo3'} series
          </p>
        </div>
      </div>

      {/* Hint Banner */}
      <div className="flex items-start gap-3 p-3.5 rounded-[4px] bg-(--surface) border border-(--border)">
        <AlertCircle className="w-4 h-4 text-(--brand-ink) shrink-0 mt-0.5" />
        <div className="text-xs text-(--text-secondary) leading-relaxed">
          <span className="text-(--text-primary) font-semibold">How to use:</span> Fill in player stats from the scoreboard at end of each game. KDA (Kills / Deaths / Assists), hero/agent used, and gold/damage dealt are used by the summary to calculate KDA. After entering data for at least 3 players, click{' '}
          <span className="text-(--brand-ink) font-semibold">Summarize stats</span> to compare the entered stats.
        </div>
      </div>

      {/* Team Stat Tables */}
      {renderStatInput(
        'team1',
        team1Rows,
        '#3B82F6',
        selectedMatch?.team1?.collegeCode || 'TEAM 1'
      )}
      {renderStatInput(
        'team2',
        team2Rows,
        '#EF4444',
        selectedMatch?.team2?.collegeCode || 'TEAM 2'
      )}

      {/* Match-level Notes */}
      <div className="rounded-[4px] bg-(--surface-soft) border border-(--border) p-4 space-y-2">
        <label className="text-xs font-bold text-(--text-muted) block flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5" />
          Organizer observations
        </label>
        <textarea
          value={matchNotes}
          onChange={(e) => setMatchNotes(e.target.value)}
          rows={3}
          placeholder="e.g. CCS ran a dive comp in Game 1, COE responded with poke. Dragon secured at 08:00. Notable: CCS Jungler played extremely aggressively…"
          className="w-full bg-(--surface) border border-(--border) rounded-[4px] px-3 py-2.5 text-xs text-(--text-primary) placeholder-(--text-muted) outline-none focus:border-(--brand)/60 resize-none leading-relaxed transition-colors"
        />
        <p className="text-xs text-(--text-muted)">
          Observations are saved with the selected game and shown alongside calculated stats.
        </p>
      </div>

      {/* Stats summary Output */}
      {aiAnalysis && (
        <div className="rounded-[4px] border border-(--brand)/25 bg-(--bg-base) p-5 space-y-3 animate-in fade-in duration-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-[4px] bg-(--brand)/15 border border-(--brand)/30 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-(--brand-ink)" />
              </div>
              <span className="text-sm font-heading font-bold text-(--brand-ink)">Match stats summary</span>
              <span className="px-1.5 py-0.5 rounded-[2px] bg-(--brand)/10 border border-(--brand)/25 text-xs font-bold text-(--brand-ink)">
                Game {gameNumber} · {selectedMatch?.matchNumber}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-(--text-muted) tabular-nums">Based on entered stats</span>
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="p-1.5 rounded-[3px] text-(--text-muted) hover:text-(--brand-ink) hover:bg-(--surface-soft) transition-colors cursor-pointer"
                title="Regenerate analysis"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            {[
              { label: 'Data Points', value: `${[...team1Rows, ...team2Rows].filter(r => r.kills !== '').length * 3}`, icon: <BarChart3 className="w-3 h-3" />, color: 'text-(--info)' },
              { label: 'Players Analyzed', value: `${[...team1Rows, ...team2Rows].filter(r => r.kills !== '' || r.deaths !== '' || r.assists !== '').length}/10`, icon: <User className="w-3 h-3" />, color: 'text-(--success)' },
              { label: 'Summary', value: 'Calculated', icon: <Zap className="w-3 h-3" />, color: 'text-(--brand-ink)' },
            ].map((stat) => (
              <div key={stat.label} className="bg-(--bg-base) border border-(--border) rounded-[4px] p-2.5 text-center">
                <div className={`flex items-center justify-center gap-1 ${stat.color} mb-1`}>
                  {stat.icon}
                </div>
                <div className={`tabular-nums font-bold text-sm ${stat.color}`}>{stat.value}</div>
                <div className="text-(--text-muted) text-xs">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-(--bg-base) border border-(--border) rounded-[4px] p-4 tabular-nums text-xs text-(--text-secondary) leading-relaxed whitespace-pre-wrap">
            {aiAnalysis}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Trophy className="w-3.5 h-3.5 text-(--text-muted)" />
            <span className="text-xs text-(--text-muted)">
              Analysis generated for WMSU Palaro 2026 · {selectedMatch?.roundName} · {new Date().toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
