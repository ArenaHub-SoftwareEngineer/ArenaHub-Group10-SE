import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { securityHeaderValues, inlineScriptHashes } from '../server/securityPolicy.mjs';
import { publicErrorHandler, securityHeaders } from '../server/securityHeaders';
import express from 'express';

test('production API responses carry browser protections and never expose the server framework', async t => {
  const server = createApp({}, { integrity: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('x-powered-by'), null);
  const csp = response.headers.get('content-security-policy')!;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
});

test('join-page bootstrap is approved by its exact bytes, without approving arbitrary inline scripts', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync('public/join.html', 'utf8');
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1];
  const fingerprint = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
  const hashes = inlineScriptHashes(['public/join.html']);
  assert.ok(hashes.includes(fingerprint));
  const policy = securityHeaderValues(hashes)['Content-Security-Policy'];
  assert.ok(policy.includes(fingerprint));
  assert.ok(!policy.includes(createHash('sha256').update('window.stolen = true').digest('base64')));
});

test('malformed bodies and unexpected server failures return generic JSON without internal details', async t => {
  const app = express();
  app.use(securityHeaders());
  app.use(express.json({ limit: '1kb' }));
  app.post('/data', (_req, _res, next) => next(new Error('INTERNAL_DATABASE_PATH_OR_SECRET')));
  app.use(publicErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/data`;
  const malformed = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'The request could not be read.' });
  const failure = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(failure.status, 500); assert.ok(!(await failure.text()).includes('INTERNAL_'));
  const large = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(2000) }) });
  assert.equal(large.status, 413);
});
