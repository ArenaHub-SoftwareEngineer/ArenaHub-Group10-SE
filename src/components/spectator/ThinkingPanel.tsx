import React, { useEffect, useState } from 'react';
import { Brain, ChevronDown, Check } from 'lucide-react';

/**
 * What Arena AI did before answering: the lookups it made (live) and the model's own reasoning summary.
 * Open while it works; folds to "Thought for 4.2 s · 3 checks" once the answer starts, and can be reopened.
 */
export function ThinkingPanel({ steps, thinking, working, thoughtMs, startedAt }: {
  steps: string[]; thinking?: string; working: boolean; thoughtMs?: number; startedAt?: number;
}) {
  const [open, setOpen] = useState(working);
  const [, tick] = useState(0);
  useEffect(() => { setOpen(working); }, [working]);
  // A live clock while it works.
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => tick(n => n + 1), 250);
    return () => window.clearInterval(timer);
  }, [working]);
  if (!working && !steps.length && !thinking) return null;
  const seconds = working ? (startedAt ? (Date.now() - startedAt) / 1000 : 0) : (thoughtMs ?? 0) / 1000;
  const checks = steps.length ? ` · ${steps.length} check${steps.length === 1 ? '' : 's'}` : '';
  const title = working ? `Thinking… ${seconds.toFixed(1)} s` : `Thought for ${seconds < 1 ? 'under 1' : seconds.toFixed(1)} s${checks}`;
  return <div className={`thinking-panel${working ? ' is-working' : ''}`}>
    <button type="button" className="thinking-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Brain size={15} aria-hidden="true" className="thinking-icon" />
      <span role={working ? 'status' : undefined}>{title}</span>
      <ChevronDown size={14} aria-hidden="true" className="thinking-chevron" />
    </button>
    {open && <div className="thinking-body">
      {steps.length > 0 && <ol className="thinking-steps">{steps.map((step, i) => {
        const current = working && i === steps.length - 1;
        return <li key={i} className={current ? 'is-current' : undefined}>
          {current ? <span className="thinking-dot" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{step}
        </li>;
      })}</ol>}
      {working && !steps.length && !thinking && <p className="thinking-wait">Reading your question…</p>}
      {thinking && <div className="thinking-text"><span className="thinking-label">Reasoning</span><p>{thinking}</p><small>The model’s own summary. Facts in the answer are checked against the records; this is not.</small></div>}
    </div>}
  </div>;
}
