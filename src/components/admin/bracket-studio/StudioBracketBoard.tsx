// The organizer's editor uses the same card sizes and placement as the published bracket.
// - Round headers sit in their own band above the cards (title + series length), so nothing overlaps.
// - Game wins: the minus and plus buttons beside each score. They show on hover, on the selected match and always on
//   touch screens; the winner is ticked and moves on automatically.
// - The strip at the top of a card opens the match details (time, stream, result).
// - Drag the empty canvas to pan; zoom with the toolbar; "Fit" shows the whole bracket.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MATCH_FORMATS, type Match, type MatchFormat } from '../../../lib/types';
import { bracketFitZoom, DEFAULT_DIMS as D, layoutBracket } from '../../../lib/bracketLayout';
import { canEditRoundFormat } from '../../../lib/tournamentFormats';
import { swissComplete } from '../../../lib/formats/swiss';
import { AlertCircle, Check, ChevronRight, Lock, Maximize2, Minus, Plus, Trophy } from '../../ui/Icons';
import { duplicateTeamNames, teamNameProblem } from '../../../lib/teamNames';
import type { BracketAppearance } from '../../../lib/bracketAppearance';
import { BracketTeamBadge } from '../../common/BracketTeamBadge';
import './studioBoard.css';
import { matchName } from '../../../lib/matchName';
import { bracketScheduleLabel } from '../../../lib/calendar';

export interface StudioBracketBoardProps {
  appearance?: BracketAppearance;
  matches: Match[];
  selectedMatchId: string | null;
  onSelectMatch: (match: Match) => void;
  onUpdateTeamName: (matchId: string, slot: 1 | 2, name: string) => void;
  onScoreChange: (matchId: string, slot: 1 | 2, delta: number) => void;
  onRoundFormatChange: (round: number, format: MatchFormat) => void;
  /** Extra toolbar buttons, such as "Save image". */
  actions?: React.ReactNode;
}

const isByeTeam = (team?: Match['team1']) => Boolean(team && (team.isBye || team.name === 'BYE'));

function formatSummary(matches: Match[]) {
  const format = matches.find(match => match.tournamentFormat)?.tournamentFormat;
  const rounds = [...new Set(matches.map(match => match.round))].sort((a, b) => a - b);
  if (format === 'swiss') {
    const total = matches[0]?.swissRounds || rounds.length;
    const latest = rounds.at(-1) || 1;
    const waiting = latest < total ? matches.filter(match => match.round === latest && match.status !== 'completed').length : 0;
    return { title: `Swiss rounds · ${latest} of ${total}`, text: swissComplete(matches) ? 'All rounds are complete. Final rankings are in Standings.'
      : latest >= total ? 'Final round in progress. Rankings stay provisional until every result is saved.'
      : `Pairings favour similar records and avoid rematches. Round ${latest + 1} is drawn when the last ${waiting === 1 ? 'result' : `${waiting} results`} of round ${latest} ${waiting === 1 ? 'is' : 'are'} saved.` };
  }
  if (format === 'round-robin') return { title: 'Round robin', text: 'Each team plays every other team once. Rankings are in Standings.' };
  if (format === 'double-elimination' || matches.some(match => match.bracketType === 'lower')) {
    return { title: 'Upper, lower and finals', text: 'Losers drop to the lower bracket. A reset final is played only if the lower-bracket team wins the first grand final.' };
  }
  return { title: 'Single elimination', text: 'Winners move right. A BYE advances a team automatically.' };
}

export function StudioBracketBoard({ matches, appearance, selectedMatchId, onSelectMatch, onUpdateTeamName, onScoreChange, onRoundFormatChange, actions }: StudioBracketBoardProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const layout = useMemo(() => layoutBracket(matches, D), [matches]);
  const byId = useMemo(() => new Map(matches.map(match => [match.id, match])), [matches]);
  const summary = formatSummary(matches);
  // Repeated or blank names are flagged while typing (so "Team 1" on the way to "Team 10" is allowed) and block save/publish.
  const nameProblem = useMemo(() => teamNameProblem({ matches, teams: [] }), [matches]);
  const repeatedIds = useMemo(() => new Set(duplicateTeamNames({ matches, teams: [] }).flatMap(item => item.ids)), [matches]);
  const invalidTeam = (team?: Match['team1']) => Boolean(team && !isByeTeam(team) && (repeatedIds.has(team.id) || !team.name.trim()));

  // "Winner of #M1" for empty slots, from explicit sources (double elimination) or the matches that feed this one.
  const slotSource = (match: Match, side: 0 | 1) => {
    const source = match.sources?.[side];
    if (source) return `${source.result === 'winner' ? 'Winner' : 'Loser'} of ${matchName(byId.get(source.matchId)) || 'an earlier match'}`;
    const feeders = matches.filter(other => other.nextMatchId === match.id);
    const feeder = feeders[side];
    return feeder ? `Winner of ${matchName(feeder)}` : undefined;
  };

  const fit = () => bracketFitZoom(viewport.current?.clientWidth ?? 0, layout.width);
  useLayoutEffect(() => { setZoom(fit()); }, [layout.width]); // eslint-disable-line react-hooks/exhaustive-deps

  const roundRows = (round: number) => matches.filter(match => match.round === round);

  return <section className="sb-board" aria-label="Bracket editor" data-bracket-theme={appearance?.theme}>
    <header className="sb-toolbar">
      <div className="sb-title">
        <strong>{summary.title}</strong>
        <p>{summary.text}</p>
      </div>
      <div className="sb-tools">
        <ul className="sb-legend" aria-label="Key">
          <li><Check size={13} aria-hidden="true" className="sb-key-win" /> Winner</li>
          <li><span className="sb-key-live" aria-hidden="true" /> Live</li>
          <li><span className="sb-key-path" aria-hidden="true" /> Decided path</li>
        </ul>
        <div className="sb-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => setZoom(value => Math.max(.4, +(value - .1).toFixed(2)))} aria-label="Zoom out"><Minus size={15} /></button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom(value => Math.min(1.4, +(value + .1).toFixed(2)))} aria-label="Zoom in"><Plus size={15} /></button>
          <button type="button" onClick={() => { setZoom(fit()); viewport.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' }); }} aria-label="Fit the whole bracket"><Maximize2 size={15} /> Fit</button>
        </div>
        {actions}
      </div>
    </header>

    {nameProblem && <p className="sb-error" role="alert" id="sb-name-error"><AlertCircle size={16} aria-hidden="true" />{nameProblem}</p>}

    <div ref={viewport} className={`bracket-board-viewport sb-viewport${panning ? ' is-panning' : ''}`} tabIndex={0} role="region" aria-label="Bracket. Scroll or drag to see every round."
      onMouseDown={event => {
        if (!viewport.current || (event.target as HTMLElement).closest('button, input, select, .sb-card')) return;
        drag.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
        setPanning(true);
      }}
      onMouseMove={event => {
        if (!drag.current || !viewport.current) return;
        viewport.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
        viewport.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
      }}
      onMouseUp={() => { drag.current = null; setPanning(false); }}
      onMouseLeave={() => { drag.current = null; setPanning(false); }}>
      <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className="sb-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          <svg className="sb-links" viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} fill="none" aria-hidden="true">
            {layout.links.map(({ from, to, advanced }) => {
              const elbow = to.x - D.colGap / 2;
              return <path key={`${from.match.id}-${to.match.id}`} d={`M ${from.x + D.cardW} ${from.y} H ${elbow} V ${to.y} H ${to.x}`} className={advanced ? 'is-advanced' : ''} />;
            })}
            {layout.champion?.from && <path d={`M ${layout.champion.from.x + D.cardW} ${layout.champion.from.y} H ${layout.champion.x}`} className={layout.champion.team ? 'is-advanced' : 'is-pending'} />}
          </svg>

          {layout.laneLabels.map(label => <span key={label.lane} className="bracket-lane-label" style={{ left: D.pad, top: label.y }}>{label.title}</span>)}

          {layout.headers.map(header => {
            const rows = roundRows(header.round);
            const editable = canEditRoundFormat(rows);
            return <div key={`${header.lane}-${header.x}-${header.y}`} className={`sb-round-head${header.final ? ' is-final' : ''}`} style={{ left: header.x, top: header.y, width: D.cardW }}>
              <span>{header.title}</span>
              <label title={editable ? 'Series length for this round' : 'Locked: a match in this round has started or has a result'}>
                {!editable && <Lock size={12} aria-hidden="true" />}
                <select aria-label={`Series format for ${header.title}`} value={rows[0]?.matchFormat || header.format} disabled={!editable}
                  onChange={event => onRoundFormatChange(header.round, event.target.value as MatchFormat)}>
                  {MATCH_FORMATS.map(format => <option key={format} value={format}>{format}</option>)}
                </select>
              </label>
            </div>;
          })}

          {layout.placed.map(({ match, x, y, lane }) => {
            const bye1 = isByeTeam(match.team1), bye2 = isByeTeam(match.team2);
            const bye = bye1 || bye2;
            const inactive = Boolean(match.inactive);
            const live = match.status === 'live';
            const done = match.status === 'completed' || Boolean(match.winnerId);
            const final = lane === 'final' || layout.headers.some(header => header.final && header.x === x && header.lane === lane);
            const scorable = !inactive && !bye && Boolean(match.team1 && match.team2);
            const status = inactive ? 'If needed' : bye ? 'Auto advance' : live ? 'Live' : done ? 'Final' : match.status === 'alert' ? 'On hold' : 'Upcoming';
            const tone = inactive || bye ? 'muted' : live ? 'live' : done ? 'done' : match.status === 'alert' ? 'alert' : 'upcoming';
            return <div key={match.id} data-round={match.round} data-match={match.matchNumber}
              data-live={live} data-final={final} data-selected={selectedMatchId === match.id}
              className={`bracket-match-card sb-card${inactive ? ' is-inactive' : ''}${invalidTeam(match.team1) || invalidTeam(match.team2) ? ' has-invalid' : ''}`}
              style={{ left: x, top: y - D.cardH / 2, width: D.cardW, height: D.cardH }}
              onClick={event => { if (!inactive && !(event.target as HTMLElement).closest('button, input, select')) onSelectMatch(match); }}>
              <button type="button" className="bracket-match-card-header sb-card-head" disabled={inactive} onClick={() => onSelectMatch(match)} aria-label={`${matchName(match)}, ${status}. Open match details`}>
                <span>{matchName(match)} · {(match.matchFormat || 'Bo3').toUpperCase()}</span>
                <span className={`sb-status is-${tone}`}>{status}</span>
                {!inactive && <ChevronRight size={13} aria-hidden="true" />}
              </button>
              <div className="bracket-match-time">{bye ? 'Advanced by BYE' : inactive ? 'Only if the lower-bracket team wins' : bracketScheduleLabel(match)}</div>
              {([1, 2] as const).map(slot => {
                const team = slot === 1 ? match.team1 : match.team2;
                const otherBye = slot === 1 ? bye2 : bye1;
                const selfBye = slot === 1 ? bye1 : bye2;
                const score = slot === 1 ? match.score.team1Score : match.score.team2Score;
                const winner = Boolean(team && !selfBye && (team.id === match.winnerId || otherBye));
                const loser = done && !winner && Boolean(team);
                const source = slotSource(match, (slot - 1) as 0 | 1);
                const editableName = Boolean(team && !selfBye && !match.sources?.[slot - 1] && match.round === Math.min(...matches.filter(m => (m.bracketType || 'main') === (match.bracketType || 'main')).map(m => m.round)));
                const label = team?.name || 'team';
                return <div key={slot} className={`bracket-match-team sb-team${winner ? ' is-winner' : ''}${loser ? ' is-loser' : ''}${!team || selfBye ? ' is-empty' : ''}`} data-winner={winner}>
                  <span className="sb-seed">{selfBye ? '' : team?.seed ?? ''}</span>
                  <BracketTeamBadge name={team?.name} badge={team && appearance?.teams?.[team.id]} empty={!team || selfBye} />
                  {editableName
                    ? <input className={`sb-name${invalidTeam(team) ? ' is-invalid' : ''}`} aria-label={`Team name for ${matchName(match)}, side ${slot}`} maxLength={100} value={team!.name}
                        aria-invalid={invalidTeam(team) || undefined} aria-describedby={invalidTeam(team) ? 'sb-name-error' : undefined}
                        title={invalidTeam(team) ? 'Another team already has this name' : 'Click to rename this team'} onChange={event => onUpdateTeamName(match.id, slot, event.target.value)} />
                    : <span className={`sb-name${invalidTeam(team) ? ' is-invalid' : ''}`} title={team?.name || source || 'To be decided'}>{selfBye ? 'BYE' : team?.name || 'TBD'}</span>}
                  {winner && <Check size={14} strokeWidth={2.6} className="sb-win" aria-label="Winner" />}
                  {scorable ? <span className="sb-score">
                    <button type="button" className="sb-step" aria-label={`Decrease ${label} score in ${matchName(match)}`} disabled={score <= 0} onClick={() => onScoreChange(match.id, slot, -1)}><Minus size={12} /></button>
                    <strong>{score}</strong>
                    <button type="button" className="sb-step" aria-label={`Increase ${label} score in ${matchName(match)}`} onClick={() => onScoreChange(match.id, slot, 1)}><Plus size={12} /></button>
                  </span> : <strong className="sb-score-only">{bye ? '' : score}</strong>}
                </div>;
              })}
            </div>;
          })}

          {layout.champion && <div className={`sb-champion${layout.champion.team ? ' is-decided' : ''}`}
            style={{ left: layout.champion.x, top: layout.champion.y - D.champH / 2, width: D.champW, height: D.champH }}>
            <Trophy size={26} aria-hidden="true" />
            <span>{layout.champion.byStandings ? 'Champion · by standings' : 'Champion'}</span>
            <strong className="bracket-badge-name">{layout.champion.team && <BracketTeamBadge name={layout.champion.team.name} badge={appearance?.teams?.[layout.champion.team.id]} />}
              <span>{layout.champion.team?.name || 'To be decided'}</span></strong>
          </div>}
        </div>
      </div>
    </div>
  </section>;
}
