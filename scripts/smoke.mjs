// Post-deploy smoke test for the ArenaHub API. Read-only: it never signs in and never calls a model.
//   node scripts/smoke.mjs <api-base-url> [--origin <website-origin>]
//   npm run smoke -- https://arenahub-api.example.app --origin https://arenahub-platform.web.app
// Checks: /api/health answers; the website origin passes CORS and an unrelated one does not;
// the assistant and video-review endpoints refuse unauthenticated calls. Exits 1 on any failure.
const args = process.argv.slice(2);
const base = (args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--origin') || '').replace(/\/+$/, '');
const origin = args.includes('--origin') ? args[args.indexOf('--origin') + 1] : undefined;
if (!/^https?:\/\//.test(base)) { console.error('Usage: node scripts/smoke.mjs <api-base-url> [--origin <website-origin>]'); process.exit(1); }

const results = [];
const check = async (name, fn) => {
  try { const note = await fn(); results.push({ name, ok: true, note: note || '' }); }
  catch (error) { results.push({ name, ok: false, note: error.message }); }
};
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(15000) });

let health = {};
await check('GET /api/health answers', async () => {
  const res = await request('/api/health', { headers: origin ? { Origin: origin } : {} });
  expect(res.status === 200, `status ${res.status}`);
  health = await res.json();
  expect(health.ok === true, 'body.ok is not true');
  if (origin) expect(res.headers.get('access-control-allow-origin') === origin, `no CORS header for ${origin}; add it to CORS_ORIGINS`);
  return `assistant ${health.assistant ? 'configured' : 'NOT configured'}, video review ${health.videoReview ? 'configured' : 'NOT configured'}`;
});
await check('health reveals no secrets', async () => {
  const text = JSON.stringify(health);
  expect(!/AIza|gsk_|sk-|-----BEGIN/.test(text), 'health output contains something that looks like a key');
});
if (origin) await check(`preflight from ${origin} is allowed`, async () => {
  const res = await request('/api/ai', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
  expect(res.status === 204, `status ${res.status}`);
  expect(res.headers.get('access-control-allow-origin') === origin, 'missing Access-Control-Allow-Origin');
});
await check('preflight from an unrelated site is refused', async () => {
  const res = await request('/api/ai', { method: 'OPTIONS', headers: { Origin: 'https://smoke-test.invalid', 'Access-Control-Request-Method': 'POST' } });
  expect(!res.headers.get('access-control-allow-origin'), 'an unrelated origin received CORS access');
  expect(res.status >= 400, `status ${res.status}`);
});
const refuses = (path, body) => async () => {
  const res = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  expect([401, 503].includes(res.status), `expected 401 (or 503 when not configured), got ${res.status}`);
  return res.status === 503 ? 'not configured (503)' : 'refused (401)';
};
await check('POST /api/ai without sign-in is refused', refuses('/api/ai', { query: 'smoke test', context: '' }));
await check('POST /api/fair-play/analyze without sign-in is refused', refuses('/api/fair-play/analyze', {}));

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? `  (${r.note})` : ''}`);
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll smoke checks passed.');
// exitCode, not process.exit(): exiting with fetch sockets still open crashes Node on Windows (0xC0000409).
process.exitCode = failed ? 1 : 0;
