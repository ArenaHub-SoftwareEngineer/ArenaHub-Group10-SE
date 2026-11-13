// One-off design codemod (redesign phase 1). Replaces hard-coded Tailwind colours, tiny font sizes and the
// code font with the design tokens in src/design.css, so every component follows one palette and one type
// scale, and the same component turns dark automatically inside a `.stage` panel.
//
//   node scripts/design-codemod.mjs          dry run: prints what would change
//   node scripts/design-codemod.mjs --write  rewrites src/**/*.tsx
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const write = process.argv.includes('--write');
const files = [];
const walk = dir => { for (const name of readdirSync(dir)) { const p = join(dir, name); statSync(p).isDirectory() ? walk(p) : name.endsWith('.tsx') && files.push(p); } };
walk('src');

function rgb(hex) {
  let h = hex.slice(1); if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function hsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, c = max - min;
  let h = 0;
  if (c) h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return { h: (h * 60 + 360) % 360, l, c };
}
function family(h) {
  if (h < 12 || h >= 330) return 'danger';
  if (h < 33) return 'brand';
  if (h < 65) return 'warning';
  if (h < 170) return 'success';
  if (h < 255) return 'info';
  return 'violet';
}
/** Maps one hard-coded colour in one role (text, bg, border...) to a design token. */
function token(hex, role) {
  const { h, l, c } = hsl(rgb(hex));
  const lower = hex.toLowerCase();
  if (c < 0.12) { // neutrals, including grey-blue and grey-brown tints
    if (role === 'text' || role === 'placeholder') return l > 0.85 ? '--text-primary' : l > 0.62 ? '--text-secondary' : '--text-muted';
    if (role === 'border' || role === 'divide' || role === 'ring' || role === 'via') return l < 0.21 ? '--border' : '--border-strong';
    // backgrounds: the old dark theme's layers, darkest first
    return l < 0.095 ? '--bg-base' : l < 0.115 ? '--surface' : l < 0.15 ? '--surface-soft' : '--surface-elevated';
  }
  const f = family(h);
  if (l < 0.3) return role === 'border' || role === 'divide' ? `--${f}-border` : `--${f}-soft`; // dark tints
  if (f === 'brand') {
    if (lower === '#ff8533') return role === 'text' ? '--brand-ink' : '--brand-hover';
    if (lower === '#e65c00') return '--brand-hover';
    return role === 'text' ? '--brand-ink' : '--brand';
  }
  return `--${f}`;
}
const ROLE_PREFIX = 'text|bg|border|from|to|via|ring|fill|stroke|shadow|divide|outline|placeholder|accent|caret';
const COLOR_RE = new RegExp(`\\b(${ROLE_PREFIX})-\\[(#[0-9a-fA-F]{3,8})\\](/\\d+)?`, 'g');
const TYPED = new Set(['ring', 'shadow', 'outline', 'fill', 'stroke', 'accent', 'caret']);
// Type scale: 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36. Nothing below 12px.
const SIZE = { 8: 'text-xs', 9: 'text-xs', 10: 'text-xs', 11: 'text-xs', 12: 'text-xs', 13: 'text-sm', 14: 'text-sm', 15: 'text-base', 16: 'text-base', 17: 'text-lg', 18: 'text-lg' };

const stats = { colors: 0, sizes: 0, mono: 0, black: 0, white: 0, files: 0 }, samples = new Map();

// White and black only made sense on the old dark surfaces. Decide per class string: white text on a solid
// accent (orange, red or green button) or a dark video overlay stays white; anything else follows the theme.
const SOLID = /\bbg-(\[#(ff6600|ff8533|e65c00|E8544B|d9433a|B91C1C|3DD68C|EF4444|A855F7)\]|black\b|red-\d|green-\d|gradient)/i;
const WHITE_TEXT = /(^|[\s"'`{])((?:[a-z-]+:)*)text-white\b/g;
function themeWhite(str) {
  if (!/\b(text-white|text-black|bg-white)\b/.test(str)) return str;
  if (/\bbg-white\b/.test(str) && /\btext-black\b/.test(str)) {
    stats.white++;
    str = str.replace(/\bbg-white\b/g, 'bg-(--text-primary)').replace(/\btext-black\b/g, 'text-(--surface)');
  }
  if (!SOLID.test(str)) str = str.replace(WHITE_TEXT, (_m, pre, variants) => { stats.white++; return `${pre}${variants}text-(--text-primary)`; });
  return str;
}
const STRING_LITERAL = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let s = before.replace(STRING_LITERAL, themeWhite);
  s = s.replace(COLOR_RE, (_all, role, hex, alpha = '') => {
    const t = token(hex, role); stats.colors++;
    const out = TYPED.has(role) ? `${role}-(color:${t})${alpha}` : `${role}-(${t})${alpha}`;
    if (!samples.has(`${role}-[${hex}]`)) samples.set(`${role}-[${hex}]`, out);
    return out;
  });
  s = s.replace(/\btext-\[(\d+)px\]/g, (all, px) => SIZE[px] ? (stats.sizes++, SIZE[px]) : all);
  // The code font stays only where real codes are shown (pairing codes, commands), which use CSS classes.
  s = s.replace(/\bfont-mono\b/g, () => (stats.mono++, 'tabular-nums'));
  s = s.replace(/\bfont-black\b/g, () => (stats.black++, 'font-bold'));
  if (s !== before) { stats.files++; if (write) writeFileSync(file, s); }
}
console.log(write ? 'Rewrote' : 'Would rewrite', stats);
if (!write && process.argv.includes('--list')) for (const [k, v] of samples) console.log(`${k.padEnd(28)} -> ${v}`);
