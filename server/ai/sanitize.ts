// Every reply passes through here before it reaches a viewer, whichever engine wrote it:
// no emoji, no raw HTML, no email addresses, and a hard length cap. Markdown tables are kept (the chat
// renders them) with every cell cleaned. The streaming version holds a table row until its line break,
// so a row is never released half-written.
import { stripEmoji } from '../../src/lib/emoji.ts';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;

/**
 * Hash marks read as noise to a viewer: heading markers ("## Results") and lone hashes go, a hashtag keeps
 * its word ("#ArenaHub" becomes "ArenaHub") and "#1" becomes "number 1". Links such as "#/arena/..." are
 * untouched because the hash is not followed by a letter or digit.
 */
const hashes = (text: string) => text
  .replace(/(^|[\s(])#{1,6}(?=\s|$)/g, '$1')
  .replace(/(^|[\s(])#(\d{1,4})(?!\w)/g, '$1number $2')
  .replace(/(^|[\s(])#([A-Za-z][\w-]*)/g, '$1$2');

/** Character-level cleaning, safe on any fragment that ends at whitespace. */
export function cleanText(text: string): string {
  return hashes(stripEmoji(text).replace(EMAIL, '[email hidden]').replace(/<\/?[a-z][^>]*>/gi, ''));
}

/** One complete line. A table row keeps its cells, each cleaned; the separator row is normalised. */
export function cleanLine(line: string): string | null {
  if (TABLE_RULE.test(line) && line.includes('-') && line.includes('|')) return `|${line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(() => ' --- ').join('|')}|`;
  const row = line.match(TABLE_ROW);
  return row ? `| ${row[1].split('|').map(cell => cleanText(cell).trim()).join(' | ')} |` : cleanText(line);
}

export function cleanReply(text: string, maxChars = 2400): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(cleanLine).filter((line): line is string => line !== null);
  return clip(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), maxChars);
}

/** Cuts at a sentence or word boundary so a capped reply never ends mid-word. */
export function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars - 1);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence > maxChars * 0.6) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Streaming cleaner: push model deltas in, get cleaned text out word by word.
 * Text is released at each whitespace, so an email address or an emoji sequence (which contain no spaces)
 * is always cleaned whole. A line that starts like a table row is held until its line break.
 */
export class StreamCleaner {
  private pending = '';
  /** The current line has already been partly released, so it is not a table row. */
  private midLine = false;
  private sent = 0;
  constructor(private readonly maxChars = 2400) {}
  get length() { return this.sent; }
  push(delta: string): string {
    this.pending += delta.replace(/\r\n?/g, '\n');
    let out = '';
    const end = this.pending.lastIndexOf('\n');
    if (end >= 0) out += this.lines(this.take(end + 1));
    if (!this.midLine && /^\s*\|/.test(this.pending)) return this.cap(out);
    const space = this.pending.search(/\s\S*$/);
    // A new line is released only once it has a word, so a table row cannot hide behind leading spaces.
    if (space >= 0 && (this.midLine || this.pending.slice(0, space + 1).trim())) {
      out += cleanText(this.take(space + 1));
      this.midLine = true;
    }
    return this.cap(out);
  }
  flush(): string {
    const rest = this.take(this.pending.length);
    return this.cap(rest ? (this.midLine ? cleanText(rest) : this.lines(rest)) : '');
  }
  private take(n: number) { const part = this.pending.slice(0, n); this.pending = this.pending.slice(n); return part; }
  /** Complete lines; the first may finish a line that was partly released already. */
  private lines(chunk: string) {
    const newline = chunk.endsWith('\n');
    const parts = (newline ? chunk.slice(0, -1) : chunk).split('\n');
    const out = parts.map((line, i) => i === 0 && this.midLine ? cleanText(line) : cleanLine(line)).filter((line): line is string => line !== null);
    this.midLine = !newline;
    return out.join('\n') + (newline ? '\n' : '');
  }
  private cap(out: string) {
    if (!out || this.sent >= this.maxChars) return '';
    if (this.sent + out.length > this.maxChars) {
      // Out of room: end at the last whole word already sent rather than splitting this piece,
      // unless the piece is long enough to cut cleanly at its own sentence or word boundary.
      const room = this.maxChars - this.sent;
      out = room > 80 ? clip(out, room) : '';
      this.sent = this.maxChars;
      return out;
    }
    this.sent += out.length;
    return out;
  }
}
