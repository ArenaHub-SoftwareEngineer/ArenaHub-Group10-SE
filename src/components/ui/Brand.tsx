import React from 'react';

interface BrandProps {
  compact?: boolean;
  context?: string;
  className?: string;
}

export const Brand: React.FC<BrandProps> = ({ compact = false, context, className = '' }) => (
  <div className={`inline-flex items-center gap-2.5 ${className}`}>
    <span className={`${compact ? 'h-8 w-8' : 'h-9 w-9'} brand-mark`}>
      <img src="/arenahub-logo.svg" alt="ArenaHub" className="brand-logo" width="424" height="508" />
    </span>
    {context && !compact && (
      <span className="rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-1.5 py-0.5 text-xs font-semibold tracking-[0.08em] text-[var(--text-muted)]">
        {context}
      </span>
    )}
  </div>
);
