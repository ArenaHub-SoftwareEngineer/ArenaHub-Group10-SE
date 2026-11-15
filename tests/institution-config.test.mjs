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

test('theme colours become CSS tokens, and palettes that fail WCAG AA stop the build', async t => {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'arenahub-theme-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(parent + sep));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'public'));
  await copyFile(new URL('../scripts/sync-institution.mjs', import.meta.url), join(root, 'scripts/sync-institution.mjs'));
  for (const file of ['firestore.rules', 'storage.rules']) await copyFile(new URL(`../${file}`, import.meta.url), join(root, file));
  await writeFile(join(root, 'public/school-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const base = { name: 'Western Mindanao State University', shortName: 'WMSU', emailDomain: 'wmsu.edu.ph' };
  const run = async (theme, ...args) => {
    await writeFile(join(root, 'institution.config.json'), JSON.stringify(theme === undefined ? base : { ...base, theme }));
    return spawnSync(process.execPath, [join(root, 'scripts/sync-institution.mjs'), ...args], { encoding: 'utf8' });
  };
  const css = () => readFile(join(root, 'src/generated/institution.css'), 'utf8');

  // No theme: ArenaHub's own orange, identical to the design system's defaults.
  assert.equal((await run(undefined)).status, 0);
  assert.match(await css(), /--brand: #ff6600;[^]*--on-brand: #1a0b00;[^]*--focus: #ff8a3d;/);
  assert.equal((await run(undefined, '--check')).status, 0);

  // A passing school palette is written as tokens.
  const blue = { primary: '#3b82f6', accent: '#60a5fa', primaryInk: '#93c5fd', onPrimary: '#0b1220', logo: '/school-logo.svg' };
  assert.equal((await run(blue)).status, 0);
  assert.match(await css(), /--brand: #3b82f6;[^]*--brand-soft: rgba\(59, 130, 246, \.16\);/);

  // Failing palettes name the pair and the ratio.
  const darkInk = await run({ ...blue, primaryInk: '#1e3a8a' });
  assert.notEqual(darkInk.status, 0);
  assert.match(darkInk.stderr, /WCAG AA[^]*primaryInk text on the page/);
  const whiteOnOrange = await run({ primary: '#ff6600', accent: '#ff7a1f', primaryInk: '#ff8a3d', onPrimary: '#ffffff' });
  assert.notEqual(whiteOnOrange.status, 0);
  assert.match(whiteOnOrange.stderr, /onPrimary button text on primary: 2\.\d+:1/);
  const maroon = await run({ ...blue, primary: '#7a0019' });
  assert.notEqual(maroon.status, 0, 'a dark maroon fill is invisible against dark surfaces');
  assert.match(maroon.stderr, /primary on the page/);
  assert.notEqual((await run({ ...blue, primary: 'red' })).status, 0, 'colours must be hex');

  // Logos must be existing files in public/.
  assert.notEqual((await run({ ...blue, logo: '/missing.svg' })).status, 0);
  assert.notEqual((await run({ ...blue, logo: '/../secrets.svg' })).status, 0);
  assert.notEqual((await run({ ...blue, logo: 'https://example.com/logo.svg' })).status, 0);

  // A stale generated file is caught by --check.
  assert.equal((await run(blue)).status, 0);
  await writeFile(join(root, 'src/generated/institution.css'), '/* edited by hand */');
  assert.notEqual((await run(blue, '--check')).status, 0);
});
