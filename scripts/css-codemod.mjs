// One-off design codemod for stylesheets (redesign, dark mode). Replaces hard-coded colours in color,
// background and border declarations with the design tokens from src/design.css, by role. Custom property
// definitions, shadows and gradients' stops that are pure white/black overlays are left alone.
//
//   node scripts/css-codemod.mjs          dry run
//   node scripts/css-codemod.mjs --write  rewrite
import { readFileSync, writeFileSync } from 'node:fs';

const write = process.argv.includes('--write');
const FILES = ['src/index.css', 'src/dashboard.css', 'src/operations.css', 'src/auth.css', 'src/interactions.css', 'src/monitor.css',
  'src/components/common/Broadcasting.css', 'src/components/spectator/RankGuide.css'];

const rgb = h => { h = h.slice(1); if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).concat(h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1); };
function hsl([r, g, b]) { const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, c = max - min; let h = 0; if (c) h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4; return { h: (h * 60 + 360) % 360, l, c }; }
const family = h => h < 12 || h >= 330 ? 'danger' : h < 33 ? 'brand' : h < 65 ? 'warning' : h < 170 ? 'success' : h < 255 ? 'info' : 'violet';
function token(hex, role) {
  const [r, g, b] = rgb(hex), { h, l, c } = hsl([r, g, b]);
  if (c < 0.12) {
    // Near-black text that sat on orange buttons stays dark on orange (readable); other dark text was body text.
    if (role === 'text' && ON_BRAND.has(hex.toLowerCase().slice(0, 7))) return '--on-brand';
    if (role === 'text') return l > 0.85 ? '--text-primary' : l > 0.6 ? '--text-secondary' : l > 0.45 ? '--text-muted' : l > 0.25 ? '--text-secondary' : '--text-primary';
    if (role === 'border') return (l > 0.7 && l < 0.85) || (l > 0.2 && l < 0.3) ? '--border-strong' : '--border';
    // backgrounds: light pages (white, off-white, warm greys) and the old dark layers both map to surfaces
    if (l > 0.97) return '--surface';
    if (l > 0.9) return '--surface-soft';
    if (l > 0.6) return '--surface-elevated';
    return l < 0.095 ? '--bg-base' : l < 0.13 ? '--surface' : l < 0.16 ? '--surface-soft' : '--surface-elevated';
  }
  const f = family(h);
  if (l > 0.82) return role === 'border' ? `--${f}-border` : role === 'text' ? (f === 'brand' ? '--brand-ink' : `--${f}`) : `--${f}-soft`; // pale tints
  if (role === 'text') return f === 'brand' ? '--brand-ink' : `--${f}`;
  if (l < 0.3 && role !== 'border') return `--${f}-soft`;
  return f === 'brand' ? (role === 'border' ? '--brand-border' : '--brand') : `--${f}`;
}
const roleOf = prop => /^(color|caret-color|-webkit-text-fill-color|fill)$/.test(prop) ? 'text'
  : /^(background|background-color)$/.test(prop) ? 'bg'
  : /^(border|border-(top|right|bottom|left)|border(-(top|right|bottom|left))?-color|outline|outline-color|stroke|column-rule|text-decoration-color)$/.test(prop) ? 'border' : null;

const ON_BRAND = new Set(['#191613', '#211309', '#21100e', '#1f1206', '#1a1a1a', '#111111', '#000000', '#000']);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
let total = 0; const samples = new Map();
for (const file of FILES) {
  const before = readFileSync(file, 'utf8');
  // Each declaration: property: value; (single-line or minified). Skip custom properties and gradients.
  const after = before.replace(/(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g, (all, pre, prop, value) => {
    const role = roleOf(prop);
    if (!role || prop.startsWith('--') || /gradient|url\(/.test(value)) return all;
    const next = value.replace(HEX, hex => {
      const alpha = rgb(hex)[3], t = token(hex, role); total++;
      const out = alpha < 1 ? `color-mix(in srgb, var(${t}) ${Math.round(alpha * 100)}%, transparent)` : `var(${t})`;
      if (!samples.has(`${role} ${hex}`)) samples.set(`${role} ${hex}`, out);
      return out;
    });
    return `${pre}${prop}: ${next.trimStart()}`.replace(`${pre}${prop}: ${value.trimStart()}`, all) === all && next === value ? all : `${pre}${prop}:${value.startsWith(' ') ? ' ' : ''}${next.trimStart()}`;
  });
  if (after !== before && write) writeFileSync(file, after);
}
console.log(write ? 'Rewrote' : 'Would rewrite', total, 'colours');
if (!write) for (const [k, v] of samples) console.log(k.padEnd(22), '->', v);
