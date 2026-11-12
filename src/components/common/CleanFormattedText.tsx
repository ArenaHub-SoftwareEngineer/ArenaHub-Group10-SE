import React from 'react';

interface CleanFormattedTextProps {
  text: string;
  isStreaming?: boolean;
}

export const CleanFormattedText: React.FC<CleanFormattedTextProps> = ({
  text,
  isStreaming = false,
}) => {
  if (!text) {
    return isStreaming ? (
      <span className="inline-block w-0.5 h-4 bg-[#ff6600] ml-0.5 align-text-bottom animate-pulse" />
    ) : null;
  }

  const lines = text.split('\n');

  return (
    <div className="space-y-1.5 text-sm text-[var(--formatted-text,#E2E2DE)] leading-relaxed">
      {lines.map((line, idx) => {
        let trimmed = line.trim();

        // Empty line -> simple clean spacing
        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }

        // Horizontal dividers: --- or ___ or ***
        if (/^[-*_]{3,}$/.test(trimmed)) {
          return <div key={idx} className="my-2 border-t border-[var(--formatted-border,#2F2F2C)]" />;
        }

        // Header detection: ###, ##, #
        const isHeader = /^#{1,4}\s+/.test(trimmed);
        if (isHeader) {
          trimmed = trimmed.replace(/^#{1,4}\s+/, '');
        }

        // Bullet detection: *, -, +, •
        const isBullet = /^[*•+-]\s+/.test(trimmed);
        if (isBullet) {
          trimmed = trimmed.replace(/^[*•+-]\s+/, '');
        }

        // Inline parser for **bold** and *italic*
        const parts = trimmed.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
        const formattedLine = parts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
            return (
              <strong key={pIdx} className="font-semibold text-[var(--formatted-emphasis,white)]">
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
            return (
              <span key={pIdx} className="font-medium text-[var(--formatted-emphasis,#F0F0EB)]">
                {part.slice(1, -1)}
              </span>
            );
          }
          // Remove stray asterisks or hashes
          return part.replace(/[*#]/g, '');
        });

        if (isHeader) {
          return (
            <div
              key={idx}
              className="font-bold text-[var(--formatted-emphasis,white)] text-[15px] pt-2 pb-0.5 tracking-tight"
            >
              {formattedLine}
            </div>
          );
        }

        if (isBullet) {
          return (
            <div key={idx} className="flex items-start gap-2.5 my-0.5 pl-0.5">
              <span className="text-[#ff6600] text-xs mt-1 shrink-0 select-none">•</span>
              <div className="flex-1 text-[var(--formatted-text,#E2E2DE)] leading-relaxed">
                {formattedLine}
              </div>
            </div>
          );
        }

        const isLastLine = idx === lines.length - 1;
        return (
          <p key={idx} className="leading-relaxed">
            {formattedLine}
            {isStreaming && isLastLine && (
              <span className="inline-block w-0.5 h-4 bg-[#ff6600] ml-0.5 align-text-bottom animate-pulse" />
            )}
          </p>
        );
      })}
      {isStreaming && lines.length === 0 && (
        <span className="inline-block w-0.5 h-4 bg-[#ff6600] ml-0.5 align-text-bottom animate-pulse" />
      )}
    </div>
  );
};
