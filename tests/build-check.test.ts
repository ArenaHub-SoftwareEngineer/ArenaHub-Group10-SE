// scripts/check-production-build.mjs must catch a server key value that leaked into the site,
// and must not flag the public Firebase key, which shares the "AIza" prefix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const run = (dir: string, env: Record<string, string>) => new Promise<{ code: number; out: string }>(resolve => {
  execFile(process.execPath, ['scripts/check-production-build.mjs', dir], { env: { ...process.env, ...env } }, (error, stdout, stderr) =>
    resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, out: stdout + stderr }));
});

test('the build check finds leaked server key values and never prints them', async t => {
  const dir = join('.test-data', `build-check-${process.pid}`);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  t.after(() => { for (const f of ['assets/app.js', 'index.html']) rmSync(join(dir, f), { force: true }); });
  const groq = 'gsk_test_only_value_0123456789abcdef';
  const publicFirebase = 'AIzaSyPublicFirebaseKeyForTheBrowser01';
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>ArenaHub</title>');
  writeFileSync(join(dir, 'assets', 'app.js'), `const firebase = { apiKey: "${publicFirebase}" };`);

  const clean = await run(dir, { GROQ_API_KEY: groq });
  assert.equal(clean.code, 0, clean.out);
  assert.match(clean.out, /no demo accounts, emulator links or server keys/);

  writeFileSync(join(dir, 'assets', 'app.js'), `const firebase = { apiKey: "${publicFirebase}" }; const leaked = "${groq}";`);
  const leaked = await run(dir, { GROQ_API_KEY: groq });
  assert.equal(leaked.code, 1);
  assert.match(leaked.out, /contains the value of GROQ_API_KEY/);
  assert.ok(!leaked.out.includes(groq), 'the key value is never printed');
});
