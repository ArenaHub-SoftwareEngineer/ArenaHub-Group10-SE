import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { findEmoji, stripEmoji, hasEmoji } from '../src/lib/emoji.ts';

const ROOTS = ['src', 'server', 'scripts', 'tests/fixtures', 'tools', 'companion'];
const SKIP = new Set(['build', '.gradle', 'node_modules', '.idea']);
const TEXT = /\.(tsx?|mjs|js|css|json|html|md|kt|kts|xml)$/;
// Temporary: removed from production paths in Phase 1, then this list must be empty.
const PENDING: string[] = [];

function files(dir: string): string[] {
  try { statSync(dir); } catch { return []; }
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? (SKIP.has(name) ? [] : files(path)) : TEXT.test(name) ? [path] : [];
  });
}

test('no emoji code points in source, scripts or fixtures', () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap(files)) {
    const normalized = file.split(sep).join('/');
    if (PENDING.includes(normalized)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const found = findEmoji(line);
      if (found.length) offenders.push(`${normalized}:${index + 1} ${found.map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase()).join(',')}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('emoji detector blocks emoji but allows typographic symbols', () => {
  for (const sample of ['\u{1F534} LIVE', '\u{1F3C6}', '\u{1F4A1} tip', '\u{2764}\u{FE0F}', '1\u{FE0F}\u{20E3}', '\u{1F1F5}\u{1F1ED}']) assert.ok(hasEmoji(sample), sample);
  for (const sample of ['ArenaHub \u{A9} 2026', 'Open \u{2197}', '5 \u{2605}', 'Done \u{2713}', 'Score 2–1', 'Upper · Bo3']) assert.ok(!hasEmoji(sample), sample);
});

test('stripEmoji removes emoji and keeps the text readable', () => {
  assert.equal(stripEmoji('\u{1F534} LIVE NOW'), 'LIVE NOW');
  assert.equal(stripEmoji('Final \u{1F3C6} result'), 'Final result');
  assert.equal(stripEmoji('Heart \u{2764}\u{FE0F} ok'), 'Heart ok');
});
