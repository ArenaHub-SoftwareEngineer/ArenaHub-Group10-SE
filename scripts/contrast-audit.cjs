// Contrast audit: with the local test site running (npm run demo -- --local), visits each page as Player and Admin and lists
// visible text below WCAG AA contrast (4.5:1, or 3:1 for large text). Usage: npm run audit:contrast [-- out.json]
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2] || 'test-results/contrast.json';
const ADMIN = ['overview', 'bracket-studio', 'live-stream', 'match-data', 'users', 'games', 'reports', 'integrity', 'match-monitor', 'operations', 'featured', 'ai-assistant'];
const PLAYER = ['home', 'current-live', 'brackets', 'teams', 'schedule', 'standings', 'integrity', 'operations', 'ai-assistant'];
const ACCOUNTS = { Player: 'student@wmsu.edu.ph', Admin: 'organizer@wmsu.edu.ph' };

async function audit(page, label) {
  return page.evaluate(label => {
    const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const bgOf = el => { const layers = []; let hasImage = false; for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage !== 'none' || n.tagName === 'IMG' || n.tagName === 'VIDEO') hasImage = true; const c = parse(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let bg = { r: 14, g: 14, b: 16, a: 1 }; for (const l of layers.reverse()) bg = blend(l, bg); return { bg, hasImage }; };
    const issues = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const text = t.textContent.trim(); if (!text) continue;
      const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight * 3) continue;
      if (el.closest('[aria-hidden=true], iframe, .sr-only, option')) continue;
      let fg = parse(cs.color); if (!fg) continue;
      const { bg, hasImage } = bgOf(el); if (hasImage) continue;
      fg = blend(fg, bg);
      let o = 1; for (let n = el; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; if (o < .99) fg = blend({ ...fg, a: o }, bg);
      const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
      const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 600, large = size >= 24 || (size >= 18.6 && bold);
      const disabled = el.closest('button:disabled, [aria-disabled=true], input:disabled');
      if (disabled) continue;
      if (ratio < (large ? 3 : 4.5)) issues.push({ page: label, ratio: +ratio.toFixed(2), text: text.slice(0, 50), size, cls: (el.className && el.className.baseVal === undefined ? el.className : '').toString().slice(0, 90), tag: el.tagName, path: (el.closest('[class]')?.className || '').toString().slice(0, 60) });
    }
    return issues;
  }, label);
}

(async () => {
  const browser = await chromium.launch();
  const all = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3210/'); await page.waitForTimeout(1500);
  all.push(...await audit(page, 'welcome'));
  await page.getByRole('button', { name: /sign in to arenahub/i }).first().click(); await page.waitForTimeout(800);
  all.push(...await audit(page, 'sign-in dialog'));
  await page.getByRole('tab', { name: 'Sign up' }).click(); await page.waitForTimeout(300); all.push(...await audit(page, 'sign-up dialog'));
  await page.getByRole('tab', { name: 'Scan QR' }).click(); await page.waitForTimeout(300); all.push(...await audit(page, 'qr dialog'));
  await page.getByRole('tab', { name: 'Sign in' }).click(); await page.waitForTimeout(300);
  for (const [who, base, ids] of [['Player', '#/arena/', PLAYER], ['Admin', '#/admin/', ADMIN]]) {
    if (who === 'Admin') { await page.goto('http://localhost:3210/'); await page.evaluate(() => { /* sign out by clearing auth */ }); }
    const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p2.goto('http://localhost:3210/');
    await p2.getByRole('button', { name: /sign in to arenahub/i }).first().click();
    await p2.getByLabel('Email address').fill(ACCOUNTS[who]);
    await p2.getByRole('textbox', { name: 'Password', exact: true }).fill('ArenaHub-QA-Only-27!');
    await p2.getByRole('button', { name: 'Sign in with email' }).click();
    await p2.locator('.auth-entry').waitFor({ state: 'detached', timeout: 30000 }); await p2.waitForTimeout(1500);
    for (const id of ids) { await p2.goto(`http://localhost:3210/${base}${id}`); await p2.waitForTimeout(1500); all.push(...await audit(p2, `${who}:${id}`)); }
    await p2.close();
  }
  fs.writeFileSync(out, JSON.stringify(all, null, 1));
  const byPage = {}; for (const i of all) byPage[i.page] = (byPage[i.page] || 0) + 1;
  console.log('issues:', all.length, byPage);
  await browser.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
