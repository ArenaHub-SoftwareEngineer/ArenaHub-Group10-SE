// Bracket from a prompt: the organizer describes the event, Arena AI reads it into parameters (or asks
// what is missing), and the organizer confirms before anything is built. The server model reads the
// prompt when it is available; the offline parser applies the same checks otherwise.
// Stays mounted while another build mode is open (it renders nothing), so the conversation survives tab switches.
import React, { useState, useRef, useEffect } from 'react';
import type { BracketDraft } from '../../../lib/types';
import { aiService } from '../../../lib/ai';
import type { BracketRequest } from '../../../lib/bracketRequest';
import { CleanFormattedText } from '../../common/CleanFormattedText';
import { useToast } from '../../ui/Toast';
import { Req } from '../../ui/Req';
import type { GenerationFeedbackData } from '../BracketGenerationFeedbackModal';
import { extractTeamsFromPrompt, MAX_BRACKET_TEAMS, detectTournamentSizeFromPrompt } from '../../../lib/bracketUtils';
import { Sparkles, X, ChevronDown, ArrowUp, LoaderCircle } from '../../ui/Icons';
import type { StreamMessage } from './shared';
import { errorMessage } from '../../../lib/errors';

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

/** The parsed settings, for the organizer to check before building. */
function RequestSummary({ request, source }: { request: BracketRequest; source: string }) {
  const d = (field: BracketRequest['defaults'][number]) => request.defaults.includes(field) ? DEFAULT_NOTE : '';
  const unnamed = request.teamsCount - request.teams.length;
  const rows: Array<[string, string]> = [
    ['Title', request.title + d('title')],
    ['Game', request.game],
    ['Format', request.format + d('format')],
    ['Series', request.matchFormat + d('matchFormat')],
    ['Final', request.finalMatchFormat + d('finalMatchFormat')],
    ['Teams', request.teams.length
      ? `${request.teamsCount}: ${request.teams.map(t => t.college ? `${t.name} (${t.college})` : t.name).join(', ')}${unnamed > 0 ? `, plus ${unnamed} numbered slot${unnamed === 1 ? '' : 's'} to rename before publishing` : ''}`
      : `${request.teamsCount} numbered slots (Team 1 to Team ${request.teamsCount}) to rename before publishing`],
    ['Seeding', request.seeding + d('seeding')],
    ...(request.constraints.length ? [['Noted', `${request.constraints.join('; ')}. Not applied automatically; adjust pairings on the canvas.`] as [string, string]] : []),
  ];
  return <>
    <dl className="studio-confirm-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="studio-muted">Read by {source}.{request.defaults.length ? ' Settings marked default were not in your prompt.' : ''}</p>
  </>;
}

export const BracketAIDraft: React.FC<BracketAIDraftProps> = ({ hidden, onDraft, onFeedback }) => {
  const { showToast } = useToast();
  const [promptText, setPromptText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [isThinkingOpen, setIsThinkingOpen] = useState(true);
  const [generationActivity, setGenerationActivity] = useState<string[]>([]);
  const [generationSeconds, setGenerationSeconds] = useState(0);

  const [aiMessages, setAiMessages] = useState<StreamMessage[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  /** Parsed and waiting for the organizer's confirmation. */
  const [pending, setPending] = useState<{ prompt: string; request: BracketRequest; source: string } | null>(null);
  /** The prompt Arena AI asked a question about; the next message answers it. */
  const [questionFor, setQuestionFor] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages, streamingId, pending]);

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = Date.now();
    setGenerationSeconds(0);
    const timer = window.setInterval(() => {
      setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  const say = (id: string, text: string) => setAiMessages(prev => prev.map(m => m.id === id ? { ...m, text } : m));

  const handleAIGenerate = async () => {
    const rawInput = promptText.trim();
    if (!rawInput) {
      showToast('Please type your tournament instructions or teams in the prompt box.', 'error');
      return;
    }
    // An answer to Arena AI's question completes the earlier prompt.
    const prompt = questionFor ? `${questionFor}\n${rawInput}` : rawInput;
    const requestedCount = detectTournamentSizeFromPrompt(prompt, 0);
    const listedCount = extractTeamsFromPrompt(prompt).length;
    if (requestedCount > MAX_BRACKET_TEAMS || listedCount > MAX_BRACKET_TEAMS) {
      showToast(`Brackets support 2 to ${MAX_BRACKET_TEAMS} teams. Enter a smaller count or roster.`, 'error');
      return;
    }

    const assistantId = `a-${Date.now() + 1}`;
    setAiMessages(prev => [...prev, { id: `u-${Date.now()}`, sender: 'user', text: rawInput }, { id: assistantId, sender: 'assistant', text: '' }]);
    setStreamingId(assistantId);
    setIsGenerating(true);
    setIsThinkingOpen(true);
    setPending(null);
    setGenerationActivity(['Reading the game, format, teams and match rules']);

    try {
      const result = await aiService.readBracketPrompt(prompt);
      setPromptText('');
      if (result.kind === 'question') {
        setQuestionFor(prompt);
        setGenerationActivity(steps => [...steps, `Missing: ${result.missing.join(' and ')}. Asking before building anything`]);
        say(assistantId, result.text);
      } else if (result.kind === 'battle-royale') {
        setQuestionFor(null);
        setGenerationActivity(steps => [...steps, 'Battle Royale events use lobby placement scoring']);
        say(assistantId, result.text);
      } else {
        setQuestionFor(null);
        setGenerationActivity(steps => [...steps, 'Checked the team count and that every team name comes from your prompt', 'Waiting for you to confirm']);
        say(assistantId, 'Here is what I read. Check the settings, then build the bracket.');
        setPending({ prompt, request: result.request, source: result.source });
      }
    } catch {
      say(assistantId, 'The prompt could not be read. Try again.');
    } finally {
      setIsGenerating(false);
      setStreamingId(null);
    }
  };

  const build = () => {
    if (!pending) return;
    let draft: BracketDraft;
    try { draft = aiService.buildBracket(pending.request, pending.prompt); }
    catch (error) { showToast(errorMessage(error, 'The bracket could not be built.'), 'error'); return; }
    onDraft(draft);
    const treeSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(draft.teamsCount))));
    const explanation = `Built a ${draft.teamsCount}-team ${draft.format} bracket for ${pending.request.game}.`;
    onFeedback({
      source: 'ai', draft, teams: draft.teams, teamCount: draft.teamsCount, treeSize,
      byesCount: Math.max(0, treeSize - draft.teamsCount), format: draft.format, matchFormat: draft.matchFormat || 'Bo3', explanation,
    });
    setAiMessages(prev => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: explanation }]);
    setPending(null);
    showToast(explanation, 'success');
  };

  const editPrompt = () => {
    if (!pending) return;
    setPromptText(pending.prompt);
    setPending(null);
  };

  if (hidden) return null;
  return (
    <div className="studio-prompt-layout">
          <div>
            <label htmlFor="bracket-prompt" className="studio-label">
              {questionFor ? 'Your answer' : 'Tournament prompt'}<Req />
            </label>
            <div className="studio-composer">
              <textarea
                id="bracket-prompt"
                aria-required="true"
                rows={4}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isGenerating) {
                    e.preventDefault();
                    void handleAIGenerate();
                  }
                }}
                placeholder={questionFor ? 'Answer the question above, for example "MLBB".' : 'Describe the game, teams or team count, format, and match series.'}
                className="studio-prompt-input"
              />
              <div className="flex items-center justify-between gap-3 px-2.5 pb-2.5">
                <span className="studio-muted">{questionFor ? <button type="button" className="chat-text-link" onClick={() => setQuestionFor(null)}>Start over</button> : 'Works offline'}</span>
                <button
                  type="button"
                  onClick={handleAIGenerate}
                  disabled={isGenerating || !promptText.trim()}
                  aria-label={isGenerating ? 'Reading prompt' : questionFor ? 'Send answer' : 'Generate bracket'}
                  className="arena-primary"
                >
                  {isGenerating ? (
                    <LoaderCircle className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                  )}
                  <span>{isGenerating ? 'Reading…' : questionFor ? 'Send answer' : 'Generate bracket'}</span>
                </button>
              </div>
            </div>
            <span className="studio-prompt-help">
              Name the game and use 2 to {MAX_BRACKET_TEAMS} teams. Press Enter to send or Shift+Enter for a new line.
            </span>
          </div>

          <div className="studio-examples">
            <h3 className="studio-label">Example prompts</h3>
            {EXAMPLES.map(prompt => (
              <button key={prompt} type="button" onClick={() => { setQuestionFor(null); setPromptText(prompt); }}>
                {prompt}
              </button>
            ))}
          </div>

          {/* AI conversation panel */}
          {aiMessages.length > 0 && (
            <div className="studio-assistant border overflow-hidden">
              <div className="px-3 py-2 border-b border-(--border) flex items-center justify-between">
                <span className="text-xs font-bold text-(--text-muted)">
                  Bracket assistant
                </span>
                <button
                  type="button"
                  aria-label="Clear the bracket assistant conversation"
                  onClick={() => { setAiMessages([]); setPending(null); setQuestionFor(null); }}
                  className="text-(--text-muted) hover:text-(--text-primary) transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto p-3 space-y-3">
                {aiMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${
                      m.sender === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[94%] text-xs leading-relaxed ${
                        m.sender === 'user'
                          ? 'bg-(--surface-soft) text-(--text-primary) font-medium px-3 py-2.5 rounded-[10px]'
                          : 'text-(--text-primary) w-full'
                      }`}
                    >
                      {m.sender === 'user' ? (
                        m.text
                      ) : (
                        <div className="space-y-2.5">
                          {m.id === aiMessages[aiMessages.length - 1]?.id && generationActivity.length > 0 && (
                            <div>
                              <button
                                type="button"
                                onClick={() => setIsThinkingOpen((open) => !open)}
                                className="flex items-center gap-2 py-1 text-(--text-secondary) hover:text-(--text-primary) transition-colors cursor-pointer"
                                aria-expanded={isThinkingOpen}
                              >
                                {streamingId === m.id ? (
                                  <LoaderCircle className="w-3.5 h-3.5 animate-spin text-(--brand-ink)" />
                                ) : (
                                  <Sparkles className="w-3.5 h-3.5 text-(--brand-ink)" />
                                )}
                                <span className="font-semibold">
                                  {streamingId === m.id ? 'Thinking' : 'Thinking complete'}
                                </span>
                                <span className="text-xs text-(--text-muted)">{generationSeconds}s</span>
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isThinkingOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {isThinkingOpen && (
                                <div className="ml-1.5 mt-1 border-l border-(--border-strong) pl-3 space-y-2 text-xs text-(--text-muted)">
                                  {generationActivity.map((step, index) => (
                                    <div key={`${step}-${index}`} className="flex items-start gap-2">
                                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${index === generationActivity.length - 1 && isGenerating ? 'bg-(--brand)' : 'bg-(--surface-elevated)'}`} />
                                      <span>{step}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {streamingId !== m.id && m.text && (
                            <div className="pt-1 text-(--text-primary)">
                              <CleanFormattedText text={m.text} isStreaming={false} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {pending && (
                  <section className="studio-confirm" aria-label="Check the bracket settings">
                    <RequestSummary request={pending.request} source={pending.source} />
                    <div className="studio-confirm-actions">
                      <button type="button" className="arena-outline" onClick={editPrompt}>Edit prompt</button>
                      <button type="button" className="arena-primary" onClick={build}>Build bracket</button>
                    </div>
                  </section>
                )}
                <div ref={bottomRef} />
              </div>
            </div>
          )}
        </div>
  );
};
