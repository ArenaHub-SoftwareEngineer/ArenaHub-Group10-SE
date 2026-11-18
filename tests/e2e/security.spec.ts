import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app';
import { ORGANIZER, QA_PASSWORD, signIn, watchErrors } from './helpers';

test('production CSP runs the approved bootstrap and blocks injected inline JavaScript', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'arenahub-csp-'));
  const file = join(dir, 'index.html');
  await writeFile(file, '<!doctype html><html><body><h1>CSP fixture</h1><script>window.approvedBootstrap = true;</script></body></html>');
  // Hash the approved bytes at server start, then simulate a stored inline-script injection.
  const server = createApp({}, { site: dir, integrity: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  try {
    await writeFile(file, '<!doctype html><html><body><h1>CSP fixture</h1><script>window.approvedBootstrap = true;</script><script>window.injectedPayload = true;</script></body></html>');
    const response = await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    expect(response!.headers()['content-security-policy']).not.toContain('unsafe-inline');
    await expect(page.getByRole('heading', { name: 'CSP fixture' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).approvedBootstrap)).toBe(true);
    expect(await page.evaluate(() => (window as any).injectedPayload)).toBeUndefined();
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await unlink(file); await rmdir(dir);
  }
});

test('staff can configure fingerprints and inspect installed-software findings with honest coverage', async ({ page, request }, testInfo) => {
  const errors = watchErrors(page);
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  const staff = { Authorization: `Bearer ${(await login.json()).idToken}` };
  const original = await (await request.get('/api/integrity/config', { headers: staff })).json();
  const fingerprint = 'c'.repeat(64);
  let sessionId = '';
  try {
    await signIn(page, ORGANIZER);
    await page.evaluate(() => { location.hash = '#/admin/match-monitor'; });
    await page.getByText('Blocklists and thresholds', { exact: true }).click();
    const installed = page.getByLabel('PC installed software (registered display names)');
    await expect(installed).toBeVisible();
    await installed.fill('arenahub harmless fixture | Harmless installed test fixture | medium');
    await page.getByText('Fingerprint checks', { exact: true }).click();
    await page.getByLabel('PC executable SHA-256 fingerprints').fill('invalid | Fixture | high');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '64 hexadecimal' })).toBeVisible();
    await page.getByLabel('PC executable SHA-256 fingerprints').fill(`${fingerprint} | Harmless running test fixture | high`);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved. Devices' })).toBeVisible();
    const saved = await (await request.get('/api/integrity/config', { headers: staff })).json();
    expect(saved.pc.blockedFileHashes[0].sha256).toBe(fingerprint);
    expect(saved.android.games).toEqual(original.android.games);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('monitor-fingerprint-settings.png'), fullPage: true });

    const created = await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: `fingerprints-${testInfo.project.name}-${Date.now()}`, matchLabel: 'Fingerprint verification', game: 'dota2', platform: 'pc', playerName: 'Harmless fixture player', record: false, serverUrl: 'https://api.example.test' } });
    expect(created.ok()).toBe(true);
    const pair = await created.json(); sessionId = pair.id;
    await page.waitForTimeout(1600);
    const claim = await request.post('/api/integrity/device/claim', { data: { code: pair.code } });
    expect(claim.ok()).toBe(true);
    const { token } = await claim.json();
    expect((await request.post('/api/integrity/device/heartbeat', { headers: { Authorization: `Bearer ${token}` }, data: {
      platform: 'pc', gameRunning: true, screenshotOk: true,
      processes: [{ name: 'renamed-harmless-fixture.exe', sha256: fingerprint }],
      installedApplications: [{ name: 'ArenaHub harmless fixture' }],
      checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'partial' },
    } })).ok()).toBe(true);
    const row = page.locator('.monitor-session').filter({ hasText: 'Harmless fixture player' }).first();
    await row.getByRole('button', { name: /Open session/i }).click({ timeout: 20_000 });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Detection coverage: limited');
    await expect(dialog).toContainText('Listed software is installed');
    await expect(dialog).toContainText('execution not established');
    await expect(dialog).toContainText('Listed executable fingerprint found');
    await expect(dialog).toContainText('Some device checks did not complete');
    await dialog.screenshot({ path: testInfo.outputPath('monitor-coverage-and-findings.png') });
    expect(errors).toEqual([]);
  } finally {
    if (sessionId) await request.post(`/api/integrity/sessions/${sessionId}/end`, { headers: staff, data: {} });
    await request.put('/api/integrity/config', { headers: staff, data: original });
  }
});
