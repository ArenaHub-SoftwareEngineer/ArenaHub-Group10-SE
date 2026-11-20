import { PageHeading } from '../ui/PageHeading';
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
import { MatchHighlightsEditor } from './MatchHighlightsEditor';
import { errorMessage } from '../../lib/errors';
import { Sparkles, Save, ChevronDown, CheckCircle2, BarChart3, RefreshCw } from '../ui/Icons';
import { CollegeLogo } from '../common/CollegeLogo';

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

export const AdminMatchDataEntry: React.FC<AdminMatchDataEntryProps> = ({ matches: allMatches }) => {
  const { showToast } = useToast();
  const matches = allMatches.filter(match => !match.team1?.isBye && !match.team2?.isBye);
  const liveMatches = matches.filter((m) => m.status === 'live' || m.status === 'pre-match' || m.status === 'upcoming');
  const [selectedMatchId, setSelectedMatchId] = useState<string>(liveMatches[0]?.id || matches[0]?.id || '');
  const selectedMatch = matches.find((m) => m.id === selectedMatchId) || liveMatches[0] || matches[0];

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
  }, [selectedMatch?.id, gameNumber]);
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
    } catch (error) { setIsSaved(false); showToast(errorMessage(error, 'Stats could not be shared. Retry saving.'), 'error'); }
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


  const num = (value: string) => Number(value) || 0;
  const kdaOf = (row: PlayerStatRow) => row.kills === '' && row.deaths === '' && row.assists === '' ? null : (num(row.kills) + num(row.assists)) / Math.max(1, num(row.deaths));
  const filled = [...team1Rows, ...team2Rows].filter(r => r.kills !== '' || r.deaths !== '' || r.assists !== '').length;
  const short = (name?: string) => (name || 'TBD').replace(/^DEMO\s+/i, '');

  const renderStatInput = (team: 'team1' | 'team2', rows: PlayerStatRow[], teamCode: string) => {
    const collapsed = team === 'team1' ? collapseTeam1 : collapseTeam2;
    const setCollapsed = team === 'team1' ? setCollapseTeam1 : setCollapseTeam2;
    const teamName = team === 'team1' ? selectedMatch?.team1?.name || 'Team 1' : selectedMatch?.team2?.name || 'Team 2';
    const totals = rows.reduce((sum, row) => ({ k: sum.k + num(row.kills), d: sum.d + num(row.deaths), a: sum.a + num(row.assists) }), { k: 0, d: 0, a: 0 });
    const field = (row: PlayerStatRow, i: number, key: 'kills' | 'deaths' | 'assists' | 'gold' | 'damage', label: string, placeholder: string) => {
      const decimal = key === 'gold' || key === 'damage';
      return <input className="stats-num" type={decimal ? 'text' : 'number'} inputMode={decimal ? 'decimal' : 'numeric'}
        {...(decimal ? {} : { min: '0', max: '999', step: '1' })}
        aria-label={`${teamCode} ${row.ign || row.playerName} ${label}`} value={row[key]} placeholder={placeholder}
        onChange={e => updateRow(team, i, key, e.target.value)} />;
    };

    return <section className="page-panel stats-team" aria-label={`${teamName} stats`}>
      <button type="button" className="stats-team-head" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
        <CollegeLogo code={teamCode} size="md" />
        <span className="stats-team-name"><strong>{teamName}</strong><small>{rows.length} players</small></span>
        <span className="stats-team-totals" aria-label={`Team totals ${totals.k} kills, ${totals.d} deaths, ${totals.a} assists`}><span><b>{totals.k}</b>/<b>{totals.d}</b>/<b>{totals.a}</b></span><small>K / D / A</small></span>
        <ChevronDown size={18} className={`stats-team-chevron${collapsed ? '' : ' is-open'}`} aria-hidden="true" />
      </button>
      {!collapsed && <div className="stats-table-wrap" tabIndex={0} role="region" aria-label={`${teamCode} player stats`}>
        <table className="stats-table">
          <thead><tr>
            <th>Player</th><th>Hero / Agent</th><th className="is-num">K</th><th className="is-num">D</th><th className="is-num">A</th><th className="is-num">KDA</th><th className="is-num">Gold (K)</th><th className="is-num">Dmg (K)</th><th>Notes</th>
          </tr></thead>
          <tbody>{rows.map((row, i) => {
            const kda = kdaOf(row);
            return <tr key={row.playerId}>
              <td><span className="stats-player"><span className="stats-avatar" aria-hidden="true">{(row.ign || row.playerName).slice(0, 2).toUpperCase()}</span>
                <span><strong>{row.ign || row.playerName}</strong><small>{row.role}{row.ign && row.ign !== row.playerName ? ` · ${row.playerName}` : ''}</small></span></span></td>
              <td><input className="stats-text" type="text" aria-label={`${teamCode} ${row.ign || row.playerName} hero or agent`} value={row.hero} onChange={e => updateRow(team, i, 'hero', e.target.value)} placeholder="Hero" /></td>
              <td className="is-num">{field(row, i, 'kills', 'kills', '–')}</td>
              <td className="is-num">{field(row, i, 'deaths', 'deaths', '–')}</td>
              <td className="is-num">{field(row, i, 'assists', 'assists', '–')}</td>
              <td className="is-num"><output className={`stats-kda${kda === null ? ' is-empty' : kda >= 4 ? ' is-high' : ''}`}>{kda === null ? '–' : kda.toFixed(2)}</output></td>
              <td className="is-num">{field(row, i, 'gold', 'gold in thousands', '–')}</td>
              <td className="is-num">{field(row, i, 'damage', 'damage in thousands', '–')}</td>
              <td><input className="stats-text stats-notes" type="text" aria-label={`${teamCode} ${row.ign || row.playerName} notes`} value={row.notes} onChange={e => updateRow(team, i, 'notes', e.target.value)} placeholder="Optional" /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </section>;
  };

  if (!selectedMatch) return <div className="module-page">
    <PageHeading title="Match stats" description="Record each player’s stats by game and review the KDA summary." />
    <div className="ah-empty-panel"><BarChart3 size={22} /><strong>No matches available</strong><p>Publish a bracket with a playable match to start recording stats.</p></div>
  </div>;

  const games = Array.from({ length: seriesGameCount(selectedMatch.matchFormat || 'Bo3') }, (_, i) => String(i + 1));
  const statusLabel = ({ live: 'Live', completed: 'Completed', upcoming: 'Upcoming', 'pre-match': 'Pre-match', alert: 'Needs review' } as Record<string, string>)[selectedMatch.status] || selectedMatch.status;

  return (
    <div className="module-page stats-page">
      <PageHeading title="Match stats" description="Record each player’s stats by game and review the KDA summary." />

      <section className="page-panel stats-matchbar" aria-label="Match and game">
        <div className="stats-matchbar-top">
          <label className="stats-match-picker"><span>Match</span>
            <select aria-label="Select match" value={selectedMatch.id} onChange={e => handleMatchChange(e.target.value)}>
              {matches.map(m => <option key={m.id} value={m.id}>{m.matchNumber} — {m.team1?.collegeCode || 'TBD'} vs {m.team2?.collegeCode || 'TBD'} · {m.status.toUpperCase()}</option>)}
            </select>
          </label>
          <span className="stats-match-meta"><span className={`status-pill${selectedMatch.status === 'live' ? ' is-danger' : selectedMatch.status === 'completed' ? ' is-success' : ''}`}>{statusLabel}</span>{selectedMatch.roundName} · {selectedMatch.matchFormat}</span>
        </div>
        <div className="stats-versus">
          <span className="stats-versus-team"><CollegeLogo code={selectedMatch.team1?.collegeCode || 'TBD'} size="lg" /><strong>{short(selectedMatch.team1?.name)}</strong></span>
          <span className="stats-versus-score" aria-label={`Series score ${selectedMatch.score.team1Score} to ${selectedMatch.score.team2Score}`}><b>{selectedMatch.score.team1Score}</b><i aria-hidden="true">–</i><b>{selectedMatch.score.team2Score}</b></span>
          <span className="stats-versus-team is-right"><strong>{short(selectedMatch.team2?.name)}</strong><CollegeLogo code={selectedMatch.team2?.collegeCode || 'TBD'} size="lg" /></span>
        </div>
        <div className="ah-tabs stats-games" role="tablist" aria-label="Game in the series">
          {games.map(g => <button key={g} type="button" role="tab" aria-selected={gameNumber === g} onClick={() => setGameNumber(g)}>
            Game {g}{selectedMatch.statGames?.[g] && <span className="stats-saved-dot" title="Stats saved" />}
          </button>)}
        </div>
      </section>

      {renderStatInput('team1', team1Rows, selectedMatch.team1?.collegeCode || 'TEAM 1')}
      {renderStatInput('team2', team2Rows, selectedMatch.team2?.collegeCode || 'TEAM 2')}
      <p className="field-hint stats-hint">Copy K/D/A from the end-of-game scoreboard. Gold and damage are in thousands. KDA is (kills + assists) / deaths.</p>

      <div className="stats-cards">
        <section className="page-panel stats-notes-card">
          <header className="stats-card-head"><h3>Notes for game {gameNumber}</h3><p className="field-hint">Saved with this game and shown next to the calculated stats.</p></header>
          <textarea aria-label="Organizer observations" value={matchNotes} onChange={e => { setMatchNotes(e.target.value); setIsSaved(false); }} rows={4}
            placeholder="Draft picks, objectives, standout plays…" />
        </section>
        <section className="page-panel stats-summary-card" aria-live="polite">
          <header className="stats-card-head"><h3>Stats summary</h3><p className="field-hint">Ranks the entered players by KDA. Descriptive only, not an MVP verdict.</p></header>
          {aiAnalysis ? <pre className="stats-summary-text">{aiAnalysis}</pre>
            : <div className="stats-summary-empty"><BarChart3 size={20} aria-hidden="true" /><span>{filled < 3 ? `Enter stats for at least 3 players (${filled} so far).` : 'Ready to summarize.'}</span></div>}
          <button type="button" className="arena-outline" onClick={handleAnalyze} disabled={isAnalyzing}>
            {isAnalyzing ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}{aiAnalysis ? 'Summarize again' : 'Summarize stats'}
          </button>
        </section>
      </div>

      {selectedMatch.team1 && selectedMatch.team2 && !selectedMatch.team1.isBye && !selectedMatch.team2.isBye && <MatchHighlightsEditor match={selectedMatch} />}

      <div className="stats-savebar" role="region" aria-label="Save game stats">
        <span className={`stats-savebar-state${isSaved ? ' is-saved' : ''}`}>{isSaved ? <CheckCircle2 size={16} aria-hidden="true" /> : <span className="stats-dirty-dot" aria-hidden="true" />}
          <span role="status">{isSaved ? `Game ${gameNumber} saved` : `Game ${gameNumber} · not saved yet`}</span></span>
        <button type="button" className="arena-primary" onClick={handleSave}><Save size={16} />Save Data</button>
      </div>
    </div>
  );
};
