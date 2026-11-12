import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

test('changing institution config regenerates both security policies and detects stale rules', async t => {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'arenahub-institution-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(parent + sep));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'scripts'));
  await copyFile(new URL('../scripts/sync-institution.mjs', import.meta.url), join(root, 'scripts/sync-institution.mjs'));
  for (const file of ['firestore.rules', 'storage.rules']) await copyFile(new URL(`../${file}`, import.meta.url), join(root, file));
  const config = { name: 'Example University', shortName: 'EU', emailDomain: 'example.edu' };
  const save = () => writeFile(join(root, 'institution.config.json'), JSON.stringify(config));
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/sync-institution.mjs'), ...args], { encoding: 'utf8' });
  await save();
  assert.notEqual(run('--check').status, 0);
  assert.equal(run().status, 0);
  for (const file of ['firestore.rules', 'storage.rules']) {
    const rules = await readFile(join(root, file), 'utf8');
    assert.ok(rules.includes("matches('[^@]+@example[.]edu')"));
    assert.ok(!rules.includes('wmsu[.]edu[.]ph'));
  }
  assert.equal(run('--check').status, 0);
  config.emailDomain = 'example.edu|evil.test'; await save();
  assert.notEqual(run().status, 0, 'Domain text must not inject a rule expression.');
});
