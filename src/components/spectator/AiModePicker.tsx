import React, { useEffect, useId, useRef, useState } from 'react';
import { Brain, ChevronDown, Gauge, Zap, Sparkles } from 'lucide-react';
import { AI_MODES, type Allowance } from '../../lib/ai';
import type { AiMode } from '../../lib/chatHistory';

const ICONS: Record<AiMode, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = { quick: Zap, think: Brain, deep: Sparkles };
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });

/** "Think ▾" in the composer: choose how Arena AI answers. */
export function AiModePicker({ mode, onChange, allowance, disabled }: { mode: AiMode; onChange: (mode: AiMode) => void; allowance: Allowance | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = AI_MODES.find(m => m.id === mode)!;
  const Icon = ICONS[mode];
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const usedUp = !!allowance?.exhausted;
  return <div className="ai-mode" ref={root}>
    <button type="button" className="ai-mode-button" aria-haspopup="true" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => setOpen(value => !value)}>
      <Icon size={14} aria-hidden /> <span>{current.name}</span><ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div className="ai-mode-menu" id={id}>
      <fieldset>
        <legend>How Arena AI answers</legend>
        {AI_MODES.map(option => {
          const OptionIcon = ICONS[option.id];
          const blocked = usedUp && option.id !== 'quick';
          return <label key={option.id} className={`ai-mode-option${option.id === mode ? ' is-chosen' : ''}`}>
            <input type="radio" name={`${id}-mode`} value={option.id} checked={option.id === mode} onChange={() => { onChange(option.id); setOpen(false); }} />
            <OptionIcon size={16} aria-hidden />
            <span><strong>{option.name}</strong><small>{blocked && allowance?.resetsAt ? `Allowance used. Back at ${clock(allowance.resetsAt)}; until then the live records answer.` : option.summary}</small></span>
          </label>;
        })}
      </fieldset>
      <AllowanceMeter allowance={allowance} detailed />
    </div>}
  </div>;
}

/** How much of the 5-hour allowance is used, and when it refreshes. */
export function AllowanceMeter({ allowance, detailed }: { allowance: Allowance | null; detailed?: boolean }) {
  if (!allowance) return detailed ? <p className="ai-allowance-copy">Your allowance shows here once you are signed in and Arena AI is online.</p> : null;
  const share = Math.min(1, allowance.used / allowance.limit), percent = Math.round(share * 100);
  const tone = allowance.exhausted ? 'is-out' : share >= 0.8 ? 'is-low' : '';
  const label = allowance.exhausted ? `Allowance used${allowance.resetsAt ? ` · refreshes ${clock(allowance.resetsAt)}` : ''}`
    : allowance.resetsAt ? `${percent}% used · refreshes ${clock(allowance.resetsAt)}` : 'Full allowance';
  return <div className={`ai-allowance ${tone}`}>
    <Gauge size={14} aria-hidden="true" />
    <span className="ai-allowance-bar" role="meter" aria-label="Arena AI allowance used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={label}>
      <span style={{ width: `${Math.max(allowance.used ? 3 : 0, percent)}%` }} />
    </span>
    <span className="ai-allowance-label">{label}</span>
    {detailed && <p className="ai-allowance-copy">
      Each person gets a fresh allowance every {allowance.windowHours} hours, counted from their first question in the window. Answers from the live records, refusals and reused answers are free. Think and Deep use more because the model reasons before answering.
    </p>}
  </div>;
}
