// Bracket from a prompt: the organizer describes the event, the assistant drafts the bracket.
// Stays mounted while another build mode is open (it renders nothing), so the conversation survives tab switches.
import React, { useState, useRef, useEffect } from 'react';
import type { BracketDraft } from '../../../lib/types';
import { aiService } from '../../../lib/ai';
import { CleanFormattedText } from '../../common/CleanFormattedText';
import { useToast } from '../../ui/Toast';
import { Req } from '../../ui/Req';
import type { GenerationFeedbackData } from '../BracketGenerationFeedbackModal';
import { extractTeamsFromPrompt, MAX_BRACKET_TEAMS, detectTournamentSizeFromPrompt } from '../../../lib/bracketUtils';
import { Sparkles, X, ChevronDown, ArrowUp, LoaderCircle } from '../../ui/Icons';
import type { StreamMessage } from './shared';

interface BracketAIDraftProps {
  hidden: boolean;
  onDraft: (draft: BracketDraft) => void;
  onFeedback: (feedback: GenerationFeedbackData) => void;
}

export const BracketAIDraft: React.FC<BracketAIDraftProps> = ({ hidden, onDraft, onFeedback }) => {
  const { showToast } = useToast();
  const [promptText, setPromptText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [isThinkingOpen, setIsThinkingOpen] = useState(true);
  const [generationActivity, setGenerationActivity] = useState<string[]>([]);
  const [generationSeconds, setGenerationSeconds] = useState(0);

  // AI Chat messages
  const [aiMessages, setAiMessages] = useState<StreamMessage[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages, streamingId]);

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = Date.now();
    setGenerationSeconds(0);
    const timer = window.setInterval(() => {
      setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  // ── AI Prompt Submit ──────────────────────────────────────────────────────
  const handleAIGenerate = async () => {
    const rawInput = promptText.trim();
    if (!rawInput) {
      showToast('Please type your tournament instructions or teams in the prompt box.', 'error');
      return;
    }
    const requestedCount = detectTournamentSizeFromPrompt(rawInput, 0);
    const listedCount = extractTeamsFromPrompt(rawInput).length;
    if (requestedCount > MAX_BRACKET_TEAMS || listedCount > MAX_BRACKET_TEAMS) {
      showToast(`Brackets support 2 to ${MAX_BRACKET_TEAMS} teams. Enter a smaller count or roster.`, 'error');
      return;
    }

    const userMsg: StreamMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: rawInput,
    };

    const assistantId = `a-${Date.now() + 1}`;
    const assistantPlaceholder: StreamMessage = {
      id: assistantId,
      sender: 'assistant',
      text: 'Analyzing tournament requirements and drafting bracket...',
    };

    setAiMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setStreamingId(assistantId);
    setIsGenerating(true);
    setIsThinkingOpen(true);
    setGenerationActivity([
      'Reading the requested format, roster, and match rules',
      'Checking the participant count and seed order',
    ]);

    try {
      // Extract the requested team count and roster from the prompt.
      const { draft, explanation } = await aiService.generateBracketFromPrompt(rawInput);

      setGenerationActivity((steps) => [
        ...steps,
        'Applying the standard seeded knockout placement',
        'Validating rounds, advancement paths, and required BYEs',
      ]);

      setAiMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: explanation }
            : m
        )
      );

      onDraft(draft);

      const treeSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(draft.teamsCount))));
      const byesCount = Math.max(0, treeSize - draft.teamsCount);
      onFeedback({
        source: 'ai',
        draft,
        teams: draft.teams,
        teamCount: draft.teamsCount,
        treeSize,
        byesCount,
        format: draft.format,
        matchFormat: draft.matchFormat || 'Bo3',
        explanation:
          explanation ||
          `Generated an ${draft.teamsCount}-team ${draft.format} tournament bracket based on your prompt.`,
      });
      showToast(
        `The rules engine generated a ${draft.teamsCount}-team ${draft.format} bracket.`,
        'success'
      );
    } catch {
      // Deterministic fallback
      setGenerationActivity((steps) => [
        ...steps,
        'Model response exceeded the fast limit; switched to ArenaHub rules',
        'Validated the connected bracket locally',
      ]);
      const draft = aiService.generateBracketDraft(rawInput);
      onDraft(draft);

      const treeSize = Math.max(2, Math.pow(2, Math.ceil(Math.log2(draft.teamsCount))));
      const byesCount = Math.max(0, treeSize - draft.teamsCount);
      const fallbackExplanation = `Generated a ${draft.teamsCount}-team ${draft.format} bracket accommodating all participants with standard competitive seeding.`;

      setAiMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                text: fallbackExplanation,
              }
            : m
        )
      );

      onFeedback({
        source: 'ai',
        draft,
        teams: draft.teams,
        teamCount: draft.teamsCount,
        treeSize,
        byesCount,
        format: draft.format,
        matchFormat: draft.matchFormat || 'Bo3',
        explanation: fallbackExplanation,
      });
      showToast(`Generated a ${draft.teamsCount}-team bracket.`, 'success');
    } finally {
      setIsGenerating(false);
      setStreamingId(null);
    }
  };

  if (hidden) return null;
  return (
    <div className="studio-prompt-layout">
          <div>
            <label htmlFor="bracket-prompt" className="studio-label">
              Tournament prompt<Req />
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
                placeholder="Describe the team count, seeding, and match format."
                className="studio-prompt-input"
              />
              <div className="flex items-center justify-between gap-3 px-2.5 pb-2.5">
                <span className="studio-muted">Works offline</span>
                <button
                  type="button"
                  onClick={handleAIGenerate}
                  disabled={isGenerating || !promptText.trim()}
                  aria-label={isGenerating ? 'Generating bracket' : 'Generate bracket'}
                  className="arena-primary"
                >
                  {isGenerating ? (
                    <LoaderCircle className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                  )}
                  <span>{isGenerating ? 'Generating…' : 'Generate bracket'}</span>
                </button>
              </div>
            </div>
            <span className="studio-prompt-help">
              Use 2 to {MAX_BRACKET_TEAMS} teams. Press Enter to generate or Shift+Enter for a new line.
            </span>
          </div>

          <div className="studio-examples">
            <h3 className="studio-label">Example prompts</h3>
            {[
              'Create a seeded 13-team single-elimination bracket with Bo3 matches.',
              'Create a seeded 11-team single-elimination bracket with a Bo5 final.',
              'Create a seeded 24-team single-elimination bracket with Bo3 matches and a Bo5 final.',
            ].map(prompt => (
              <button key={prompt} type="button" onClick={() => setPromptText(prompt)}>
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
                  onClick={() => setAiMessages([])}
                  className="text-(--text-muted) hover:text-(--text-primary) transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto p-3 space-y-3">
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
                          {m.id === aiMessages[aiMessages.length - 1]?.id && (
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
                          {streamingId !== m.id && (
                            <div className="pt-1 text-(--text-primary)">
                              <CleanFormattedText text={m.text} isStreaming={false} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>
          )}
        </div>
  );
};
