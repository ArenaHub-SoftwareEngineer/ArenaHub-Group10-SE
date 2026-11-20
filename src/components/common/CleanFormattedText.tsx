import React from 'react';

interface CleanFormattedTextProps {
  text: string;
  isStreaming?: boolean;
}

const Caret = () => <span className="inline-block w-0.5 h-4 bg-(--brand) ml-0.5 align-text-bottom animate-pulse" />;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
/** Numbers, scores, ratios and K/D/A read better right-aligned. */
const numeric = (value: string) => /^[-+]?[\d.,]+%?$|^\d+\s*[–-]\s*\d+$|^\d+\/\d+\/\d+$/.test(value);

/** **bold** and *emphasis*; stray asterisks and hashes are dropped. React escapes everything else. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="font-semibold text-[var(--formatted-emphasis,white)]">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <span key={i} className="font-medium text-[var(--formatted-emphasis,#F0F0EB)]">{part.slice(1, -1)}</span>;
    return part.replace(/[*#]/g, '');
  });
}

function MarkdownTable({ rows }: { rows: string[] }) {
  const body = rows.filter(row => !TABLE_RULE.test(row)).map(cells);
  const hasHeader = rows.length > 1 && TABLE_RULE.test(rows[1]);
  const head = hasHeader ? body[0] : null, rest = hasHeader ? body.slice(1) : body;
  const width = Math.max(...body.map(row => row.length));
  return <div className="answer-table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens">
    <table className="answer-table">
      {head && <thead><tr>{Array.from({ length: width }, (_, i) => <th key={i} scope="col">{inline(head[i] || '')}</th>)}</tr></thead>}
      <tbody>{rest.map((row, r) => <tr key={r}>{Array.from({ length: width }, (_, i) => <td key={i} className={numeric(row[i] || '') ? 'is-number' : undefined}>{inline(row[i] || '')}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export const CleanFormattedText: React.FC<CleanFormattedTextProps> = ({ text, isStreaming = false }) => {
  if (!text) return isStreaming ? <Caret /> : null;

  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    // A run of table lines becomes one table. While streaming, a table shows once its rows have arrived.
    if (TABLE_ROW.test(line)) {
      const start = idx;
      while (idx + 1 < lines.length && TABLE_ROW.test(lines[idx + 1])) idx++;
      out.push(<MarkdownTable key={`t${start}`} rows={lines.slice(start, idx + 1)} />);
      continue;
    }
    let trimmed = line.trim();
    if (!trimmed) { out.push(<div key={idx} className="h-1" />); continue; }
    if (/^[-*_]{3,}$/.test(trimmed)) { out.push(<div key={idx} className="my-2 border-t border-[var(--formatted-border,#2F2F2C)]" />); continue; }

    const isHeader = /^#{1,4}\s+/.test(trimmed);
    if (isHeader) trimmed = trimmed.replace(/^#{1,4}\s+/, '');
    const isBullet = /^[*•+-]\s+/.test(trimmed);
    if (isBullet) trimmed = trimmed.replace(/^[*•+-]\s+/, '');
    const formatted = inline(trimmed);

    if (isHeader) out.push(<div key={idx} className="font-bold text-[var(--formatted-emphasis,white)] text-base pt-2 pb-0.5 tracking-tight">{formatted}</div>);
    else if (isBullet) out.push(<div key={idx} className="flex items-start gap-2.5 my-0.5 pl-0.5">
      <span className="text-(--brand-ink) text-xs mt-1 shrink-0 select-none">•</span>
      <div className="flex-1 text-[var(--formatted-text,#E2E2DE)] leading-relaxed">{formatted}</div>
    </div>);
    else out.push(<p key={idx} className="leading-relaxed">{formatted}{isStreaming && idx === lines.length - 1 && <Caret />}</p>);
  }

  return <div className="space-y-1.5 text-sm text-[var(--formatted-text,#E2E2DE)] leading-relaxed">{out}</div>;
};
