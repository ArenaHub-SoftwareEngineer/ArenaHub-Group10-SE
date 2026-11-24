// Bracket from a prompt: the organizer describes the event, Arena AI reads it into parameters (or asks
// what is missing), and the organizer confirms before anything is built. The server model reads the
// prompt when it is available; the offline parser applies the same checks otherwise.
//
// Shown as a conversation (newest at the bottom, composer under it). Every Arena AI turn carries its own step list,
// so the organizer sees what happened: read the prompt, found the settings, checked the team count, waiting for a
// confirmation or an answer, built the bracket. Questions come with one-click answers.
// Stays mounted while another build mode is open (it renders nothing), so the conversation survives tab switches.
import React, { useState, useRef, useEffect } from 'react';
import type { BracketDraft, Match } from '../../../lib/types';
import { BracketForge } from '../../three/BracketForge';
import { aiService, OFFLINE_DRAFT_SOURCE } from '../../../lib/ai';
import { BRACKET_GAMES, UNASSIGNED_BRACKET_GAME, type BracketRequest } from '../../../lib/bracketRequest';
import { useToast } from '../../ui/Toast';
import { applyMatchSchedules, parseStreamSchedule, splitBracketSchedule } from '../../../lib/streamSchedule';
import { Req } from '../../ui/Req';
import type { GenerationFeedbackData } from '../BracketGenerationFeedbackModal';
import { MAX_BRACKET_TEAMS } from '../../../lib/bracketUtils';
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, HelpCircle, LoaderCircle, RotateCcw, Sparkles, X } from '../../ui/Icons';
import { errorMessage } from '../../../lib/errors';
import { assertUniqueTeamNames } from '../../../lib/teamNames';
import { isRandomDraw } from '../../../lib/fairDraw';
import './aiDraft.css';

interface BracketAIDraftProps {
  hidden: boolean;
  onDraft: (draft: BracketDraft) => void;
  onFeedback: (feedback: GenerationFeedbackData) => void;
}

const EXAMPLES = [
  'Create a seeded 13-team MLBB single-elimination bracket with Bo3 matches.',
  'Create a seeded 11-team Dota 2 single-elimination bracket with a Bo5 final.',
  'Create a 24-team CODM Multiplayer double-elimination bracket with Bo3 matches and a Bo5 final.',
];
const DEFAULT_NOTE = ' (default)';

type StepState = 'done' | 'active' | 'input' | 'error' | 'idle';
interface Step { label: string; detail?: string; state: StepState }
interface Built { teams: number; matches: number; rounds: number; byes: number; format: string; game: string; draft: Match[] }
interface Turn {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  steps?: Step[];
  ms?: number;
  tone?: 'question' | 'review' | 'built' | 'info' | 'error';
  options?: string[];
  editPrompt?: string;
  built?: Built;
}

const treeSlots = (teams: number) => Math.max(2, Math.pow(2, Math.ceil(Math.log2(Math.max(2, teams)))));
const seconds = (ms?: number) => ms === undefined ? '' : ms < 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;

/** The parsed settings, for the organizer to check before building. */
function RequestSummary({ request, source }: { request: BracketRequest; source: string }) {
  const d = (field: BracketRequest['defaults'][number]) => request.defaults.includes(field) ? DEFAULT_NOTE : '';
  const unnamed = request.teamsCount - request.teams.length;
  const rows: Array<[string, string]> = [
    ['Title', request.title + d('title')],
    ['Game', request.game === UNASSIGNED_BRACKET_GAME ? 'Choose when publishing' : request.game],
    ['Format', request.format + d('format')],
    ['Series', request.matchFormat + d('matchFormat')],
    ...(request.format === 'Swiss' || request.format === 'Round robin' ? [] : [['Final', request.finalMatchFormat + d('finalMatchFormat')] as [string, string]]),
    ['Teams', request.generatedNames ? `${request.teamsCount} generated names` : request.openingMatches?.length ? `${request.teamsCount} named teams in ${request.openingMatches.length} opening matches` : request.teams.length
      ? `${request.teamsCount}: ${request.teams.map(t => t.college ? `${t.name} (${t.college})` : t.name).join(', ')}${unnamed > 0 ? `, plus ${unnamed} numbered slot${unnamed === 1 ? '' : 's'} to rename before publishing` : ''}`
      : `${request.teamsCount} numbered slots (Team 1 to Team ${request.teamsCount}) to rename before publishing`],
    ['Seeding', (request.openingMatches?.length ? 'Use the numbered matchups from the prompt' : request.seeding === 'Random draw'
      ? 'Random draw. Teams are shuffled into different seed slots from the previous draw.'
      : `${request.seeding}: ArenaHub has no ratings for these teams yet, so they are seeded in the order you listed`) + d('seeding')],
    ...(request.appearance ? [['Appearance', [request.appearance.theme && 'Navy and purple with gold accents', request.appearance.wideImage && '16:9 image export', request.appearance.exportFooter && 'Date, prize and sponsor space'].filter(Boolean).join(' · ')] as [string, string]] : []),
    ...(request.constraints.length ? [['Noted', `${request.constraints.join('; ')}. Not applied automatically; adjust pairings on the canvas.`] as [string, string]] : []),
  ];
  return <>
    <dl className="studio-confirm-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value.endsWith(DEFAULT_NOTE) ? 'is-default' : ''}>{value}</dd></div>)}</dl>
    {request.generatedNames && <details className="aid-matchups aid-generated-names" open>
      <summary>Generated team names</summary>
      <ol aria-label="Generated team names">{request.teams.map(team => <li key={team.name}>{team.name}</li>)}</ol>
    </details>}
    {request.openingMatches?.length ? <details className="aid-matchups" open>
      <summary>Opening matchups</summary>
      <ol>{request.openingMatches.map(match => <li key={match.number}>
        <span>Match {match.number}</span><strong>{match.teams[0]} <span>vs</span> {match.teams[1]}</strong>
      </li>)}</ol>
    </details> : null}
    <p className="studio-muted">Read by {source}.{request.defaults.length ? ' Settings marked default were not in your prompt; edit the prompt to change them.' : ''}</p>
  </>;
}

function StepList({ steps, working, ms, open, onToggle }: { steps: Step[]; working: boolean; ms?: number; open: boolean; onToggle: () => void }) {
  const failed = steps.some(step => step.state === 'error');
  const waiting = steps.some(step => step.state === 'input');
  const heading = working ? 'Working' : failed ? 'Stopped' : waiting ? 'Needs your input' : 'Done';
  return <div className="aid-steps">
    <button type="button" className="aid-steps-toggle" aria-expanded={open} onClick={onToggle}>
      {working ? <LoaderCircle size={14} className="animate-spin aid-tone-active" /> : failed ? <AlertTriangle size={14} className="aid-tone-error" /> : waiting ? <HelpCircle size={14} className="aid-tone-input" /> : <Check size={14} className="aid-tone-done" />}
      <strong>{heading}</strong>
      <span>{steps.filter(step => step.state === 'done').length} of {steps.length} steps{ms !== undefined ? ` · ${seconds(ms)}` : ''}</span>
      <ChevronDown size={14} className={open ? 'is-open' : ''} aria-hidden="true" />
    </button>
    {open && <ol className="aid-step-list">
      {steps.map((step, index) => <li key={`${step.label}-${index}`} className={`is-${step.state}`} style={{ animationDelay: `${index * 90}ms` }}>
        <span className="aid-step-dot" aria-hidden="true">
          {step.state === 'done' ? <Check size={11} strokeWidth={3} /> : step.state === 'active' ? <LoaderCircle size={11} className="animate-spin" /> : step.state === 'error' ? <X size={11} strokeWidth={3} /> : step.state === 'input' ? '?' : ''}
        </span>
        <span><span className="aid-step-label">{step.label}</span>{step.detail && <small>{step.detail}</small>}</span>
        <span className="sr-only">{({ done: 'done', active: 'in progress', input: 'waiting for you', error: 'failed', idle: 'not started' } as const)[step.state]}</span>
      </li>)}
    </ol>}
  </div>;
}

export const BracketAIDraft: React.FC<BracketAIDraftProps> = ({ hidden, onDraft, onFeedback }) => {
  const { showToast } = useToast();
  const [promptText, setPromptText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [closedSteps, setClosedSteps] = useState<Set<string>>(new Set());
  /** Parsed and waiting for the organizer's confirmation. */
  const [pending, setPending] = useState<{ turnId: string; prompt: string; request: BracketRequest; source: string } | null>(null);
  const lastBuild = useRef<typeof pending>(null);
  /** The prompt Arena AI asked a question about; the next message answers it. */
  const [questionFor, setQuestionFor] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns, pending]);

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 200);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  const update = (id: string, patch: Partial<Turn>) => setTurns(prev => prev.map(turn => turn.id === id ? { ...turn, ...patch } : turn));

  const send = async (answer?: string) => {
    const rawInput = (answer ?? promptText).trim();
    if (!rawInput || isGenerating) {
      if (!rawInput) { showToast('Describe the event first, for example "16-team Dota 2 single elimination, Bo3".', 'error'); input.current?.focus(); }
      return;
    }
    // An answer to Arena AI's question completes the earlier prompt.
    const prompt = questionFor ? `${questionFor}\n${rawInput}` : rawInput;
    const bracketPrompt = splitBracketSchedule(prompt).bracket;
    const turnId = `a-${Date.now()}`;
    const started = performance.now();
    setTurns(prev => [...prev, { id: `u-${Date.now()}`, sender: 'user', text: rawInput }, {
      id: turnId, sender: 'assistant', text: '', steps: [
        { label: 'Reading your prompt', detail: questionFor ? 'Your answer is added to the earlier prompt' : undefined, state: 'active' },
        { label: 'Finding the game, format, series and teams', state: 'idle' },
        { label: `Checking the team count (2 to ${MAX_BRACKET_TEAMS})`, state: 'idle' },
        { label: 'Preparing the settings for your review', state: 'idle' },
      ],
    }]);
    setPromptText('');
    setIsGenerating(true);
    setPending(null);

    try {
      const result = await aiService.readBracketPrompt(bracketPrompt);
      if (result.kind === 'generation-unavailable') throw new Error(result.text);
      const ms = performance.now() - started;
      const readBy = { label: 'Read your prompt', detail: `Read by ${result.source === OFFLINE_DRAFT_SOURCE ? 'the offline rules engine' : result.source}`, state: 'done' as const };
      if (result.kind === 'question') {
        setQuestionFor(result.editPrompt ? null : prompt);
        const missingGame = result.missing.includes('game');
        update(turnId, {
          ms, tone: 'question', text: result.text,
          options: result.editPrompt ? undefined : missingGame ? [...BRACKET_GAMES] : ['8 teams', '16 teams', '32 teams'],
          editPrompt: result.editPrompt ? prompt : undefined,
          steps: [readBy,
            { label: 'Finding the game, format, series and teams', detail: result.editPrompt ? 'A matchup or roster instruction needs a correction' : `Missing: ${result.missing.map(item => item === 'game' ? 'which game' : 'how many teams').join(' and ')}`, state: 'input' },
            { label: 'Asking you before building anything', detail: result.editPrompt ? 'Edit your prompt to continue' : 'Pick an answer below or type one', state: 'input' }],
        });
      } else if (result.kind === 'battle-royale') {
        setQuestionFor(null);
        update(turnId, { ms, tone: 'info', text: result.text, steps: [readBy] });
      } else {
        setQuestionFor(null);
        const { request } = result;
        const elimination = request.format === 'Single elimination' || request.format === 'Double elimination';
        const slots = treeSlots(request.teamsCount);
        const teamNames = request.teams.map(t => t.college ? `${t.name} (${t.college})` : t.name);
        const teamSummary = teamNames.length >= 2
          ? `Extracted ${teamNames.length} teams: ${teamNames.slice(0, 8).join(', ')}${teamNames.length > 8 ? ` and ${teamNames.length - 8} more` : ''}.`
          : `${request.teamsCount} slots will be created.`;
        const isRandom = request.seeding === 'Random draw' || !request.openingMatches?.length;
        const reviewText = `Analyzed your prompt for ${request.game} (${request.format}, ${request.matchFormat}${elimination ? `, ${request.finalMatchFormat} final` : ''}). ${teamSummary} ${isRandom ? 'Seeding is set to Random draw, so a freshly randomized bracket will be generated every time.' : 'Using the fixed matchups specified in the prompt.'}`;
        update(turnId, {
          ms, tone: 'review', text: reviewText,
          steps: [readBy,
            { label: 'Found the settings', detail: `${request.game} · ${request.format} · ${request.matchFormat}${elimination ? `, ${request.finalMatchFormat} final` : ''}`, state: 'done' },
            { label: `Analyzed ${request.teamsCount} teams`, detail: elimination ? `${slots}-slot bracket${slots > request.teamsCount ? ` with ${slots - request.teamsCount} BYE${slots - request.teamsCount === 1 ? '' : 's'} for top seeds` : ', no BYEs needed'}` : `${request.teamsCount} teams in rounds`, state: 'done' },
            { label: 'Waiting for you to confirm', detail: 'Select Build bracket to generate the randomized matchups', state: 'input' }],
        });
        setPending({ turnId, prompt, request, source: result.source });
      }
    } catch (error) {
      update(turnId, { ms: performance.now() - started, tone: 'error', text: errorMessage(error, 'The prompt could not be read. Check your connection and try again.'),
        steps: [{ label: 'Reading your prompt', detail: 'The request failed', state: 'error' }] });
      setPromptText(rawInput);
    } finally {
      setIsGenerating(false);
    }
  };

  const build = (selection = pending) => {
    if (!selection) return;
    const { request, prompt, turnId } = selection;
    let draft: BracketDraft;
    try { draft = aiService.buildBracket(request, prompt); assertUniqueTeamNames(draft); }
    catch (error) {
      const message = errorMessage(error, 'The bracket could not be built.');
      update(turnId, { tone: 'error', text: message, steps: (turns.find(turn => turn.id === turnId)?.steps || []).map(step => step.state === 'input' ? { ...step, state: 'error' as const, detail: message } : step) });
      showToast(message, 'error');
      return;
    }
    const { schedule } = splitBracketSchedule(prompt);
    let scheduleMessage = '';
    if (schedule) {
      try {
        const updates = parseStreamSchedule(schedule, draft.matches);
        draft = { ...draft, matches: applyMatchSchedules(draft.matches, updates) };
        scheduleMessage = ` Added ${updates.length} match ${updates.length === 1 ? 'time' : 'times'} to Draft schedule.`;
      } catch (error) {
        scheduleMessage = ` Review the schedule instructions in Draft schedule. ${errorMessage(error, 'The schedule could not be applied.')}`;
      }
    }
    onDraft(draft);
    lastBuild.current = selection;
    const treeSize = treeSlots(draft.teamsCount);
    const byes = /elimination/i.test(draft.format) ? Math.max(0, treeSize - draft.teamsCount) : 0;
    const playable = draft.matches.filter(match => !match.inactive);
    const rounds = new Set(draft.matches.map(match => `${match.bracketType || 'main'}-${match.round}`)).size;
    const gameDescription = request.game === UNASSIGNED_BRACKET_GAME ? '' : ` for ${request.game}`;
    const explanation = `Built a ${draft.teamsCount}-team ${draft.format} bracket${gameDescription}.${scheduleMessage}`;
    onFeedback({
      source: 'ai', draft, teams: draft.teams, teamCount: draft.teamsCount, treeSize,
      byesCount: byes, format: draft.format, matchFormat: draft.matchFormat || 'Bo3', explanation,
    });
    const turn = turns.find(item => item.id === turnId);
    update(turnId, { tone: 'review', steps: (turn?.steps || []).map(step => step.state === 'input' ? { ...step, label: 'Confirmed by you', detail: undefined, state: 'done' as const } : step) });
    setTurns(prev => [...prev, {
      id: `b-${Date.now()}`, sender: 'assistant', tone: 'built', text: explanation,
      built: { teams: draft.teamsCount, matches: playable.length, rounds, byes, format: draft.format, game: request.game, draft: draft.matches },
      steps: [
        { label: 'Created the rounds and matches', detail: `${playable.length} matches across ${rounds} rounds`, state: 'done' },
        request.openingMatches?.length
          ? { label: 'Placed the numbered opening matchups', detail: `${request.openingMatches.length} matches follow the order you supplied.`, state: 'done' as const }
          : isRandomDraw(draft.seedingRule)
          ? { label: 'Drew the seeds at random', detail: `${draft.teams.slice(0, 8).map((team, i) => `${i + 1}. ${team.name}`).join(', ')}${draft.teams.length > 8 ? `, and ${draft.teams.length - 8} more` : ''}.${byes ? ` ${byes} BYE${byes === 1 ? '' : 's'} went to the top ${byes === 1 ? 'seed' : `${byes} seeds`} of this draw.` : ''} Build again for a new draw.`, state: 'done' as const }
          : { label: 'Placed the teams in your listed order', detail: byes ? `${byes} BYE${byes === 1 ? '' : 's'} advance the first ${byes === 1 ? 'team' : `${byes} teams`} you listed` : 'Every team plays in round 1', state: 'done' as const },
        { label: 'Opened it on the canvas below', detail: 'Unsaved until you select Save draft or Publish', state: 'done' },
      ],
    }]);
    setPending(null);
    showToast(explanation, 'success');
  };

  const editPrompt = () => {
    if (!pending) return;
    setPromptText(pending.prompt);
    setPending(null);
    input.current?.focus();
  };

  const reset = () => { setTurns([]); setPending(null); setQuestionFor(null); setClosedSteps(new Set()); };
  const lastAssistant = [...turns].reverse().find(turn => turn.sender === 'assistant');

  if (hidden) return null;
  return (
    <div className="aid">
      {turns.length === 0 ? <div className="aid-intro">
        <Sparkles size={20} className="aid-tone-active" aria-hidden="true" />
        <div>
          <h3>Describe the tournament</h3>
          <p>List the teams or describe the tournament in your own words. Review what Arena AI read before building the bracket.</p>
        </div>
        <div className="aid-examples" role="group" aria-label="Example prompts">
          {EXAMPLES.map(example => <button key={example} type="button" onClick={() => { setPromptText(example); input.current?.focus(); }}>{example}</button>)}
        </div>
      </div> : <section className="aid-thread-wrap" aria-label="Bracket assistant conversation">
        <header className="aid-thread-head">
          <span><Sparkles size={14} aria-hidden="true" /> Bracket assistant</span>
          <button type="button" className="chat-text-link" onClick={reset}><RotateCcw size={13} aria-hidden="true" /> New conversation</button>
        </header>
        <div className="aid-thread" ref={thread} aria-live="polite">
          {turns.map(turn => turn.sender === 'user'
            ? <p key={turn.id} className="aid-user">{turn.text}</p>
            : <article key={turn.id} className={`aid-turn is-${turn.tone || 'working'}`}>
              {turn.steps && <StepList steps={turn.steps} working={isGenerating && turn.id === lastAssistant?.id && !turn.tone} ms={turn.tone ? turn.ms : elapsed}
                open={!closedSteps.has(turn.id)} onToggle={() => setClosedSteps(prev => { const next = new Set(prev); if (next.has(turn.id)) next.delete(turn.id); else next.add(turn.id); return next; })} />}
              {turn.text && <p className="aid-answer">{turn.text}</p>}
              {turn.tone === 'question' && turn.id === lastAssistant?.id && turn.options && <div className="aid-options" role="group" aria-label="Quick answers">
                {turn.options.map(option => <button key={option} type="button" className="ah-chip" disabled={isGenerating} onClick={() => void send(option)}>{option}</button>)}
              </div>}
              {turn.id === lastAssistant?.id && turn.editPrompt && <button type="button" className="arena-outline arena-sm" onClick={() => {
                setPromptText(turn.editPrompt!);
                input.current?.focus();
              }}>Edit prompt</button>}
              {turn.tone === 'error' && <button type="button" className="arena-outline arena-sm" onClick={() => void send()} disabled={!promptText.trim() || isGenerating}><RotateCcw size={14} /> Try again</button>}
              {pending?.turnId === turn.id && <section className="studio-confirm" aria-label="Check the bracket settings">
                <RequestSummary request={pending.request} source={pending.source} />
                <div className="studio-confirm-actions">
                  <button type="button" className="arena-outline" onClick={editPrompt}>Edit prompt</button>
                  <button type="button" className="arena-primary" onClick={() => build()}><Check size={16} /> Build bracket</button>
                </div>
              </section>}
              {turn.built && turn.id === lastAssistant?.id && <BracketForge matches={turn.built.draft} />}
              {turn.built && <div className="aid-built">
                <dl>
                  <div><dt>Teams</dt><dd>{turn.built.teams}</dd></div>
                  <div><dt>Matches</dt><dd>{turn.built.matches}</dd></div>
                  <div><dt>Rounds</dt><dd>{turn.built.rounds}</dd></div>
                  <div><dt>BYEs</dt><dd>{turn.built.byes}</dd></div>
                </dl>
                <button type="button" className="arena-primary arena-sm" onClick={() => document.querySelector('.sb-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><ArrowDown size={15} /> View the bracket</button>
                {turn.id === lastAssistant?.id && lastBuild.current?.request.seeding === 'Random draw' && lastBuild.current.request.teams.length > 0 && <button type="button" className="arena-outline arena-sm" onClick={() => build(lastBuild.current)}><RotateCcw size={15} /> Draw again</button>}
              </div>}
            </article>)}
        </div>
      </section>}

      <div className="aid-composer-wrap">
        <label htmlFor="bracket-prompt" className="studio-label">{questionFor ? 'Your answer' : 'Tournament prompt'}<Req /></label>
        <div className="studio-composer">
          <textarea
            id="bracket-prompt"
            ref={input}
            aria-required="true"
            rows={3}
            value={promptText}
            onChange={event => setPromptText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !isGenerating) { event.preventDefault(); void send(); }
            }}
            placeholder={questionFor ? 'Answer the question above, or pick an answer.' : 'For example: 16-team Dota 2 single elimination, Bo3, Bo5 final.'}
            className="studio-prompt-input"
          />
          <div className="aid-composer-foot">
            <span className="studio-muted">{questionFor
              ? <button type="button" className="chat-text-link" onClick={() => setQuestionFor(null)}>Start over with a new prompt</button>
              : `2 to ${MAX_BRACKET_TEAMS} teams · Enter to send, Shift+Enter for a new line`}</span>
            <button type="button" onClick={() => void send()} disabled={isGenerating || !promptText.trim()} className="arena-primary"
              aria-label={isGenerating ? 'Reading prompt' : questionFor ? 'Send answer' : 'Generate bracket'}>
              {isGenerating ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4 stroke-[2.5]" />}
              <span>{isGenerating ? `Reading… ${seconds(elapsed)}` : questionFor ? 'Send answer' : 'Generate bracket'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
