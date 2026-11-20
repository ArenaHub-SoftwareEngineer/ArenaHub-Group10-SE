/**
 * Visual blocks attached to an Arena AI answer: tables and match cards built on the server from the records
 * the tools actually read, never from the model's text. Shared by the server (builds them) and the browser
 * (renders them and re-checks them when loading saved history, which lives in browser storage).
 */
export interface TableColumn { key: string; label: string; align?: 'left' | 'right'; /** Draw a bar scaled to the column's largest value. */ bar?: boolean }
export type Cell = string | number | null;
export interface TableBlock { kind: 'table'; title: string; subtitle?: string; columns: TableColumn[]; rows: Array<Record<string, Cell>>; note?: string }
export interface MatchCard {
  label: string; team1: string; team2: string; college1?: string; college2?: string;
  score: string | null; status: string; when: string | null; winner?: string | null;
}
export interface MatchesBlock { kind: 'matches'; title: string; matches: MatchCard[] }
export type AnswerBlock = TableBlock | MatchesBlock;

export const MAX_BLOCKS = 4;
export const MAX_ROWS = 20;

const str = (value: unknown, max = 120) => typeof value === 'string' ? value.slice(0, max) : '';
const cell = (value: unknown): Cell => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' ? value.slice(0, 120) : null;

/** Keeps only well-formed blocks, with bounded sizes. Anything else is dropped, never rendered. */
export function parseBlocks(raw: unknown): AnswerBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_BLOCKS).flatMap((block: any): AnswerBlock[] => {
    if (block?.kind === 'table' && Array.isArray(block.columns) && Array.isArray(block.rows)) {
      const columns = block.columns.slice(0, 8).filter((c: any) => /^[a-z][a-zA-Z0-9]{0,30}$/.test(c?.key) && typeof c?.label === 'string')
        .map((c: any): TableColumn => ({ key: c.key, label: str(c.label, 40), ...(c.align === 'right' ? { align: 'right' } : {}), ...(c.bar === true ? { bar: true } : {}) }));
      if (!columns.length) return [];
      const rows = block.rows.slice(0, MAX_ROWS).map((row: any) => Object.fromEntries(columns.map((c: TableColumn) => [c.key, cell(row?.[c.key])])));
      return [{ kind: 'table', title: str(block.title), ...(block.subtitle ? { subtitle: str(block.subtitle, 200) } : {}), columns, rows, ...(block.note ? { note: str(block.note, 300) } : {}) }];
    }
    if (block?.kind === 'matches' && Array.isArray(block.matches)) {
      const matches = block.matches.slice(0, 12).map((m: any): MatchCard => ({
        label: str(m?.label), team1: str(m?.team1) || 'To be decided', team2: str(m?.team2) || 'To be decided',
        ...(m?.college1 ? { college1: str(m.college1, 30) } : {}), ...(m?.college2 ? { college2: str(m.college2, 30) } : {}),
        score: typeof m?.score === 'string' ? m.score.slice(0, 20) : null, status: str(m?.status, 30), when: typeof m?.when === 'string' ? m.when.slice(0, 80) : null,
        ...(m?.winner ? { winner: str(m.winner) } : {}),
      }));
      return matches.length ? [{ kind: 'matches', title: str(block.title), matches }] : [];
    }
    return [];
  });
}
