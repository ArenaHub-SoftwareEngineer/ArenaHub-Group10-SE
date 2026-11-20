import React from 'react';
import type { AnswerBlock, Cell, MatchesBlock, TableBlock } from '../../lib/aiBlocks';

const show = (value: Cell) => value === null || value === '' ? '—' : typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : value;

function DataTable({ block }: { block: TableBlock }) {
  // A bar column is scaled to its own largest value, so the leader's bar is full width.
  const peaks = Object.fromEntries(block.columns.filter(c => c.bar).map(c => [c.key, Math.max(0, ...block.rows.map(r => typeof r[c.key] === 'number' ? r[c.key] as number : 0))]));
  return <figure className="answer-block">
    <figcaption><strong>{block.title}</strong>{block.subtitle && <span>{block.subtitle}</span>}</figcaption>
    <div className="answer-table-wrap" tabIndex={0} role="region" aria-label={`${block.title}, scrolls sideways on small screens`}>
      <table className="answer-table">
        <thead><tr>{block.columns.map(c => <th key={c.key} scope="col" className={c.align === 'right' ? 'is-number' : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, i) => <tr key={i}>{block.columns.map(c => {
          const value = row[c.key];
          const peak = peaks[c.key];
          return <td key={c.key} className={c.align === 'right' ? 'is-number' : undefined}>
            {c.bar && typeof value === 'number' && peak > 0
              ? <span className="answer-bar-cell"><span className="answer-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, (value / peak) * 100)}%` }} /></span>{show(value)}</span>
              : show(value)}
          </td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    {block.note && <p className="answer-block-note">{block.note}</p>}
  </figure>;
}

function MatchCards({ block }: { block: MatchesBlock }) {
  return <figure className="answer-block">
    <figcaption><strong>{block.title}</strong></figcaption>
    <ul className="answer-matches">{block.matches.map((m, i) => {
      const live = /live/i.test(m.status), done = /completed/i.test(m.status);
      const [s1, s2] = m.score?.split(/[-–]/).map(Number) ?? [];
      const lead = Number.isFinite(s1) && Number.isFinite(s2) && s1 !== s2 ? (s1 > s2 ? 1 : 2) : 0;
      return <li key={i} className={`answer-match${live ? ' is-live' : ''}`}>
        <div className="answer-match-meta"><span>{m.label}</span><span className={`status-pill ${live ? 'is-danger' : done ? 'is-success' : 'is-info'}`}>{live ? 'Live' : done ? 'Final' : m.status || 'Scheduled'}</span></div>
        <div className="answer-match-teams">
          <span className={lead === 1 || m.winner === m.team1 ? 'is-ahead' : undefined}>{m.team1}{m.college1 && <small>{m.college1}</small>}</span>
          <b aria-label={m.score ? `Score ${m.score}${live ? ', not final' : ''}` : 'No score yet'}>{m.score ?? 'vs'}</b>
          <span className={lead === 2 || m.winner === m.team2 ? 'is-ahead' : undefined}>{m.team2}{m.college2 && <small>{m.college2}</small>}</span>
        </div>
        {m.when && <div className="answer-match-when">{m.when}</div>}
      </li>;
    })}</ul>
  </figure>;
}

/** Tables and match cards built from the records the answer used. */
export function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
  if (!blocks.length) return null;
  return <div className="answer-blocks">{blocks.map((block, i) => block.kind === 'table' ? <DataTable key={i} block={block} /> : <MatchCards key={i} block={block} />)}</div>;
}
