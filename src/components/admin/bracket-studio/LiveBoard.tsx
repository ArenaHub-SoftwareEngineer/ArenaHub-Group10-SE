// Bracket Studio home: every live bracket as a picture card, the chosen one as the real bracket (team names and scores), and a result panel
// that saves straight to the live bracket (spectators see it at once). Drafts and earlier versions sit in their own tabs.
import React, { useEffect, useMemo, useState } from 'react';
import type { BracketDraft, Match } from '../../../lib/types';
import { seriesWinsNeeded } from '../../../lib/types';
import { firestoreService } from '../../../lib/firestore';
import { publicationGameKey } from '../../../lib/bracketPublication';
import { FAIR_PLAY_GAMES } from '../../../lib/fairPlayGames';
import { matchName } from '../../../lib/matchName';
import { bracketProgress, canScoreMatch, winnerScores } from '../../../lib/liveResults';
import { errorMessage } from '../../../lib/errors';
import { TournamentBracketCanvas } from '../../spectator/TournamentBracketCanvas';
import { BracketTeamBadge } from '../../common/BracketTeamBadge';
import { useToast } from '../../ui/Toast';
import { Check, Edit2, ExternalLink, GitBranch, LoaderCircle, Minus, Plus, RotateCcw, Trash2, Trophy } from '../../ui/Icons';
import '../adminPoster.css';
import './liveBoard.css';

type Tab = 'live' | 'drafts' | 'versions';
type Filter = 'todo' | 'live' | 'played';

const art = (bracket: BracketDraft) => FAIR_PLAY_GAMES.find(game => `game-${game.id}` === publicationGameKey(bracket))?.image;
const byeMatch = (match: Match) => match.inactive || [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE');
const STATUS: Record<Match['status'], [string, string]> = {
  upcoming: ['Not played', 'is-neutral'], 'pre-match': ['Check-in', 'is-info'], live: ['Live', 'is-live'], completed: ['Played', 'is-success'], alert: ['On hold', 'is-warning'],
};
const statusOf = (match: Match) => STATUS[match.status] ?? ['Not played', 'is-neutral'];

export interface LiveBoardProps {
  live: BracketDraft[];
  drafts: BracketDraft[];
  versions: BracketDraft[];
  working: BracketDraft | null;
  initialTab?: Tab;
  onNew: () => void;
  onContinue: () => void;
  onEdit: (bracket: BracketDraft) => void;
  onRemove: (bracket: BracketDraft) => void;
  onDeleteDraft: (draft: BracketDraft) => void;
  onRestore: (version: BracketDraft) => void;
}

export function LiveBoard({ live, drafts, versions, working, initialTab, onNew, onContinue, onEdit, onRemove, onDeleteDraft, onRestore }: LiveBoardProps) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>(initialTab ?? (live.length || !drafts.length ? 'live' : 'drafts'));
  const [bracketId, setBracketId] = useState<string | null>(live[0]?.id ?? null);
  const bracket = live.find(entry => entry.id === bracketId) ?? live[0] ?? null;
  const [filter, setFilter] = useState<Filter>('todo');
  const [matchId, setMatchId] = useState<string | null>(null);

  const real = useMemo(() => (bracket?.matches ?? []).filter(match => !byeMatch(match)), [bracket]);
  const lists: Record<Filter, Match[]> = useMemo(() => ({
    todo: real.filter(match => match.status !== 'completed' && canScoreMatch(match)),
    live: real.filter(match => match.status === 'live'),
    played: real.filter(match => match.status === 'completed'),
  }), [real]);
  const match = real.find(entry => entry.id === matchId) ?? null;
  // The same bracket spectators see (team names, scores, winners), one column per round.
  const rounds = useMemo(() => {
    const list: Match[][] = [];
    const all = bracket?.matches ?? [];
    const last = Math.max(1, ...all.map(entry => entry.round));
    for (let round = 1; round <= last; round++) list.push(all.filter(entry => entry.round === round));
    return list;
  }, [bracket]);
  const scorable = useMemo(() => new Set(real.map(entry => entry.id)), [real]);

  // A new bracket opens on its live match, or the first one still to play.
  useEffect(() => {
    if (!bracket) return;
    if (matchId && bracket.matches.some(entry => entry.id === matchId)) return;
    const first = lists.live[0] ?? lists.todo[0] ?? null;
    setMatchId(first?.id ?? null);
    setFilter(lists.live.length ? 'live' : 'todo');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracket?.id]);

  const pick = (id: string) => {
    const target = real.find(entry => entry.id === id);
    if (!target) return;
    setMatchId(id);
    setFilter(target.status === 'completed' ? 'played' : target.status === 'live' ? 'live' : 'todo');
  };

  return <div className="adp lbd">
    <header className="adp-head">
      <span className="adp-giant" aria-hidden="true">Brackets</span>
      <div className="adp-title">
        <h1><span className="adp-count">{live.length}</span> Live <span className="is-thin">brackets</span></h1>
        <p>Pick a match, set the score, save. Spectators see it right away.</p>
      </div>
      <div className="adp-head-actions">
        <button type="button" className="arena-primary" onClick={onNew}><Plus size={16} aria-hidden="true" /> New bracket</button>
      </div>
    </header>

    {working && <button type="button" className="lbd-continue" onClick={onContinue}>
      <Edit2 size={16} aria-hidden="true" />
      <span><strong>Continue editing</strong><small>{working.title}</small></span>
      <span className="adp-pill is-warning">{working.status === 'published' ? 'Live copy' : 'Not live yet'}</span>
    </button>}

    <div className="ah-tabs lbd-tabs" role="tablist" aria-label="Bracket library">
      {([['live', 'Live', live.length], ['drafts', 'Drafts', drafts.length], ['versions', 'Versions', versions.length]] as const).map(([id, label, count]) =>
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span className="ah-chip-count">{count}</span></button>)}
    </div>

    {tab === 'live' && <div role="tabpanel" aria-label="Live brackets" className="lbd-live">
      {!live.length && <div className="adp-empty lbd-empty">
        <GitBranch size={28} aria-hidden="true" />
        <p>No bracket is live yet.</p>
        <button type="button" className="arena-primary" onClick={onNew}><Plus size={16} aria-hidden="true" /> New bracket</button>
      </div>}

      {live.length > 0 && <div className="lbd-picker" role="radiogroup" aria-label="Choose a live bracket">
        {live.map(entry => {
          const progress = bracketProgress(entry);
          const image = art(entry);
          const chosen = entry.id === bracket?.id;
          return <button key={entry.id} type="button" role="radio" aria-checked={chosen} data-bracket-id={entry.id}
            className={`lbd-card${chosen ? ' is-chosen' : ''}`} onClick={() => { setBracketId(entry.id); setMatchId(null); }}>
            {image ? <img src={image} alt="" /> : <span className="lbd-card-blank"><GitBranch size={26} /></span>}
            <span className="lbd-card-body">
              <span className="lbd-card-top">
                {progress.live > 0 ? <span className="adp-pill is-live"><i className="lbd-live-dot" /> {progress.live} live</span>
                  : progress.champion ? <span className="adp-pill is-success"><Trophy size={12} /> Finished</span>
                  : <span className="adp-pill is-neutral">Published</span>}
              </span>
              <strong>{entry.title}</strong>
              <small>{entry.gameName}</small>
              <span className="lbd-progress" aria-label={`${progress.played} of ${progress.total} matches played`}>
                <i style={{ width: `${progress.total ? (progress.played / progress.total) * 100 : 0}%` }} />
              </span>
              <small>{progress.played} of {progress.total} played</small>
            </span>
          </button>;
        })}
      </div>}

      {bracket && <div className="lbd-work">
        <section className="lbd-board" aria-label={`${bracket.title} bracket`}>
          <div className="viewer-bracket-board lbd-bracket">
            <TournamentBracketCanvas key={bracket.id} rounds={rounds} appearance={bracket.appearance}
              pick={{ canPick: entry => scorable.has(entry.id), selectedMatchId: match?.id }}
              onSelectMatch={entry => pick(entry.id)} />
          </div>
          <div className="lbd-board-bar">
            <span className="lbd-legend">Click a match to score it.</span>
            <span className="lbd-board-actions">
              <button type="button" className="arena-outline arena-sm" onClick={() => onEdit(bracket)}><Edit2 size={14} aria-hidden="true" /> Edit bracket</button>
              <a className="arena-outline arena-sm" href={`#/arena/brackets?bracket=${encodeURIComponent(bracket.id)}`} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden="true" /> Spectator view
              </a>
              <button type="button" className="arena-outline arena-sm arena-danger-text" onClick={() => onRemove(bracket)}><Trash2 size={14} aria-hidden="true" /> Remove from live</button>
            </span>
          </div>
        </section>

        <aside className="lbd-side">
          <ResultPanel key={match ? `${bracket.id}:${match.id}:${match.score.team1Score}-${match.score.team2Score}` : 'none'} bracket={bracket} match={match}
            onSaved={(saved, id) => {
              const after = saved.matches.find(entry => entry.id === id);
              showToast(after?.status === 'completed' ? `${[after.team1, after.team2].find(team => team?.id === after.winnerId)?.name ?? 'Winner'} wins. Spectators updated.` : 'Score saved. Spectators updated.', 'success');
            }}
            onError={message => showToast(message, 'error')} />

          <div className="lbd-list">
            <div className="ah-chips lbd-filters" role="group" aria-label="Show matches">
              {([['todo', 'To play'], ['live', 'Live'], ['played', 'Played']] as const).map(([id, label]) =>
                <button key={id} type="button" className="ah-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label} <span className="ah-chip-count">{lists[id].length}</span></button>)}
            </div>
            <ul aria-label="Matches">
              {lists[filter].length === 0 && <li className="adp-note lbd-list-empty">{filter === 'todo' ? 'No match is waiting for a result.' : filter === 'live' ? 'No match is live.' : 'No results yet.'}</li>}
              {lists[filter].map(entry => {
                const [label, tone] = statusOf(entry);
                return <li key={entry.id}>
                  <button type="button" className={`lbd-row${entry.id === match?.id ? ' is-chosen' : ''}`} aria-current={entry.id === match?.id || undefined} onClick={() => pick(entry.id)}>
                    <span className="lbd-row-name"><strong>{entry.team1?.name || 'TBD'} vs {entry.team2?.name || 'TBD'}</strong><small>{matchName(entry)} · {entry.roundName}</small></span>
                    <span className="lbd-row-score">{entry.score.team1Score}–{entry.score.team2Score}</span>
                    <span className={`adp-pill ${tone}`}>{label}</span>
                  </button>
                </li>;
              })}
            </ul>
          </div>
        </aside>
      </div>}
    </div>}

    {tab === 'drafts' && <div role="tabpanel" aria-label="Drafts" className="lbd-shelf">
      {!drafts.length && <p className="adp-empty">No saved drafts. Publishing a bracket also keeps its latest draft here.</p>}
      {drafts.map(draft => <div key={draft.id} className="lbd-shelf-row studio-bracket-library-row">
        {art(draft) ? <img src={art(draft)} alt="" /> : <span className="lbd-card-blank"><GitBranch size={18} /></span>}
        <span><strong>{draft.title}</strong><small>{draft.gameName} · {draft.teamsCount} teams</small></span>
        <span className="studio-row-actions">
          <button type="button" className="arena-outline arena-sm" onClick={() => onEdit(draft)}>Open draft</button>
          <button type="button" className="arena-outline arena-sm arena-danger-text studio-delete-draft" onClick={() => onDeleteDraft(draft)}>Delete draft</button>
        </span>
      </div>)}
    </div>}

    {tab === 'versions' && <div role="tabpanel" aria-label="Versions" className="lbd-shelf">
      {!versions.length && <p className="adp-empty">Earlier live versions appear here after you publish a change.</p>}
      {versions.map(version => <div key={publicationGameKey(version)} className="lbd-shelf-row studio-bracket-library-row">
        {art(version) ? <img src={art(version)} alt="" /> : <span className="lbd-card-blank"><GitBranch size={18} /></span>}
        <span><strong>{version.title}</strong><small>{version.gameName}</small></span>
        <span className="studio-row-actions"><button type="button" className="arena-outline arena-sm" onClick={() => onRestore(version)}>Restore previous version</button></span>
      </div>)}
    </div>}
  </div>;
}

function ResultPanel({ bracket, match, onSaved, onError }: {
  bracket: BracketDraft; match: Match | null; onSaved: (saved: BracketDraft, matchId: string) => void; onError: (message: string) => void;
}) {
  const [scores, setScores] = useState<[number, number]>(() => match ? [match.score.team1Score, match.score.team2Score] : [0, 0]);
  const [saving, setSaving] = useState(false);
  if (!match) return <div className="lbd-result is-empty"><p className="adp-note">Pick a match on the board or in the list.</p></div>;

  const target = seriesWinsNeeded(match.matchFormat);
  const ready = canScoreMatch(match);
  const changed = scores[0] !== match.score.team1Score || scores[1] !== match.score.team2Score;
  const winner = scores[0] >= target ? 1 : scores[1] >= target ? 2 : 0;
  const [label, tone] = statusOf(match);
  const set = (slot: 0 | 1, value: number) => setScores(current => {
    const next: [number, number] = [...current];
    next[slot] = Math.max(0, Math.min(target, value));
    // Only one side can hold the winning score.
    if (next[slot] === target && next[1 - slot] === target) next[1 - slot] = target - 1;
    return next;
  });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try { onSaved(await firestoreService.savePublishedMatchResult(bracket.id, match.id, scores[0], scores[1]), match.id); }
    catch (error) { onError(errorMessage(error, 'The result was not saved. Try again.')); setSaving(false); }
  };

  const side = (slot: 0 | 1) => {
    const team = slot === 0 ? match.team1 : match.team2;
    return <div className={`lbd-team${winner === slot + 1 ? ' is-winner' : ''}`}>
      <BracketTeamBadge name={team?.name} badge={team ? bracket.appearance?.teams?.[team.id] : undefined} empty={!team} />
      <strong>{team?.name || 'TBD'}</strong>
      <span className="lbd-stepper">
        <button type="button" className="adp-round" aria-label={`Remove a game from ${team?.name}`} disabled={!ready || saving || scores[slot] === 0} onClick={() => set(slot, scores[slot] - 1)}><Minus size={16} /></button>
        <output aria-label={`${team?.name} score`}>{scores[slot]}</output>
        <button type="button" className="adp-round" aria-label={`Add a game to ${team?.name}`} disabled={!ready || saving || scores[slot] === target} onClick={() => set(slot, scores[slot] + 1)}><Plus size={16} /></button>
      </span>
      <button type="button" className={`lbd-won${winner === slot + 1 ? ' is-on' : ''}`} disabled={!ready || saving} aria-pressed={winner === slot + 1}
        onClick={() => setScores(winnerScores({ ...match, score: { ...match.score, team1Score: scores[0], team2Score: scores[1] } }, (slot + 1) as 1 | 2))}>
        <Trophy size={14} aria-hidden="true" /> Won
      </button>
    </div>;
  };

  return <section className="lbd-result" aria-label="Match result">
    <header>
      <span><strong>{matchName(match)}</strong><small>{match.roundName} · {match.matchFormat} · first to {target}</small></span>
      <span className={`adp-pill ${tone}`}>{label}</span>
    </header>
    {ready ? <>{side(0)}{side(1)}</> : <p className="adp-note">Waiting for both teams. The earlier match decides who plays here.</p>}
    {ready && <div className="lbd-result-actions">
      <button type="button" className="arena-primary" disabled={!changed || saving} onClick={() => void save()}>
        {saving ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} Save result
      </button>
      {changed && !saving && <button type="button" className="arena-outline" onClick={() => setScores([match.score.team1Score, match.score.team2Score])}>Undo</button>}
      {!changed && (match.score.team1Score > 0 || match.score.team2Score > 0) && <button type="button" className="arena-outline" disabled={saving}
        onClick={() => setScores([0, 0])}><RotateCcw size={14} aria-hidden="true" /> Reset to 0–0</button>}
    </div>}
  </section>;
}
