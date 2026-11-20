import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { ORGANIZER, STUDENT, QA_PASSWORD, signIn, watchErrors } from './helpers';

test('staff can save and reload the protected-game DLL policy through anti-cheat settings', async ({ page, request }) => {
  await signIn(page, ORGANIZER);
  const token = await page.evaluate(async () => { const path = '/src/lib/firebase.ts'; return (await import(path)).auth.currentUser.getIdToken(); });
  const headers = { Authorization: `Bearer ${token}` };
  const original = await (await request.get('/api/integrity/config', { headers })).json();
  try {
    await page.evaluate(() => { location.hash = '#/admin/match-monitor'; });
    await page.getByText('Blocklists and thresholds', { exact: true }).click();
    const modules = page.getByLabel('Dota 2 restricted libraries (DLL names)');
    await expect(modules).toBeVisible();
    const previous = await modules.inputValue();
    await modules.fill(`${previous}\nfixture-only.dll | Harmless policy fixture | high`);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved. Devices pick up the new lists on their next report.')).toBeVisible();
    const saved = await (await request.get('/api/integrity/config', { headers })).json();
    expect(saved.pc.blockedModules).toContainEqual({ match: 'fixture-only.dll', label: 'Harmless policy fixture', severity: 'high' });
    await page.reload();
    await page.getByText('Blocklists and thresholds', { exact: true }).click();
    await expect(page.getByLabel('Dota 2 restricted libraries (DLL names)')).toHaveValue(/fixture-only\.dll/);
  } finally {
    expect((await request.put('/api/integrity/config', { headers, data: original })).ok()).toBe(true);
  }
});

test('player anti-cheat entry prioritizes the required app scan and keeps disputes secondary', async ({ page }, info) => {
  const errors = watchErrors(page);
  await signIn(page, STUDENT); await page.goto('/#/arena/integrity');
  await expect(page.getByRole('heading', { name: 'Anti-cheat', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scan before you play' })).toBeVisible();
  await expect(page.locator('details').filter({ hasText: 'Disputes and appeals' })).not.toHaveAttribute('open', '');
  await page.getByLabel('My match scan code').fill('ABC');
  await page.getByRole('button', { name: 'Open my scan' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '8-character scan code' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('player-required-scan.png'), fullPage: true });

  // Practice before match day: no code, one way per device, and the iPhone self-check list.
  const practice = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Practice before match day' }) });
  await expect(practice.getByRole('link', { name: 'Scan this PC' })).toHaveAttribute('href', /^arenahub:\/\/practice\?s=http%3A%2F%2F127\.0\.0\.1%3A\d+$/);
  await practice.getByText('Start it by typing a command instead').click();
  await expect(practice).toContainText('arenahub-agent.exe --practice --server http://127.0.0.1:');
  await expect(practice).toContainText('Server address for the app:');
  await practice.getByText('The six referee checks').click();
  await expect(practice.locator('.anticheat-ios-checks li')).toHaveCount(6);
  await expect(practice).toContainText('Turn Developer Mode off.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await practice.screenshot({ path: info.outputPath('player-practice.png') });
  expect(errors).toEqual([]);
});

test('every roster player must pass before the real Go live control saves; restricted software locks admission', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const errors = watchErrors(page);
  await signIn(page, ORGANIZER);
  await expect(page.getByRole('heading', { name: 'Organizer overview' })).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const servicePath = '/src/lib/firestore.ts', bracketsPath = '/src/lib/bracketUtils.ts';
    const { firestoreService } = await import(servicePath), { createBracketFromTeams } = await import(bracketsPath);
    const previous = firestoreService.getPublishedBrackets().find((bracket: any) => bracket.gameId === 'game-dota2') || null;
    const draft = createBracketFromTeams({ title: `Required scan QA ${Date.now()}`, teams: [{ name: 'Scan Alpha' }, { name: 'Scan Bravo' }], matchFormat: 'Bo1', finalMatchFormat: 'Bo1' });
    draft.matches[0].team1.players = [{ id: 'scan-a', ign: 'Scan Ace', name: 'Private A', collegeId: '', role: 'Player', isVerified: true }];
    draft.matches[0].team2.players = [{ id: 'scan-b', ign: 'Scan Bolt', name: 'Private B', collegeId: '', role: 'Player', isVerified: true }];
    const published = await firestoreService.publishBracket(draft, 'Dota 2', 'game-dota2');
    return { previous: previous ? JSON.parse(JSON.stringify(previous)) : null, id: published.id, matchId: published.matches[0].id };
  });
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  const staff = { Authorization: `Bearer ${(await login.json()).idToken}` }, sessions: string[] = [];
  const codeFor = async (player: any) => {
    const response = await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: fixture.matchId, matchLabel: 'Required scan QA', game: 'dota2', playerKey: player.playerKey, playerName: player.playerName, platform: 'pc', record: false, serverUrl: 'https://api.example.test' } });
    expect(response.ok()).toBe(true); const paired = await response.json(); sessions.push(paired.id);
    await page.waitForTimeout(1600);
    const claimed = await request.post('/api/integrity/device/claim', { data: { code: paired.code, device: { agent: 'QA v3 fixture' } } });
    expect(claimed.ok()).toBe(true); return claimed.json();
  };
  const report = (claim: any, blocked = false, restrictedModule = false) => request.post('/api/integrity/device/heartbeat', { headers: { Authorization: `Bearer ${claim.token}` }, data: { platform: 'pc', processes: blocked ? [{ name: 'cheatengine.exe' }] : [], loadedModules: restrictedModule ? [{ name: 'speedhack-x86_64.dll', process: 'dota2.exe' }] : [], installedApplications: [], dota: { found: true, buildId: '26632873', manifestSha256: 'c'.repeat(64), modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] }, gameRunning: restrictedModule, screenshotOk: false, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', modules: 'complete', dotaFiles: 'complete', fileSweep: 'complete' }, scan: claim.monitor.scan } });
  try {
    await page.evaluate(() => { location.hash = '#/admin/match-monitor'; });
    await expect(page.getByRole('heading', { name: 'Anti-cheat', exact: true })).toBeVisible();
    await page.getByLabel('Match to clear for play').selectOption(fixture.matchId);
    const panel = page.getByRole('region', { name: 'Required pre-match scans' });
    await expect(panel).toContainText('0 of 2 players ready', { timeout: 20_000 });
    await expect(panel.getByRole('button', { name: 'Verify match admission' })).toBeDisabled();
    await page.evaluate(() => { location.hash = '#/admin/live-stream'; });
    await page.getByRole('button', { name: /^Dota 2/ }).first().click();
    await page.getByLabel('Bracket', { exact: true }).selectOption(fixture.id);
    await expect(page.getByRole('heading', { name: 'Scan Alpha vs Scan Bravo' })).toBeVisible();
    await page.locator('.desk-queue-item').first().click();
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.getByText(/Anti-cheat scan required: 0 of 2/)).toBeVisible();
    expect(await page.evaluate(async id => { const path = '/src/lib/firestore.ts'; return (await import(path)).firestoreService.getMatchById(id).status; }, fixture.matchId)).toBe('upcoming');

    const readiness = await (await request.get(`/api/integrity/matches/${fixture.matchId}/readiness`, { headers: staff })).json();
    const one = await codeFor(readiness.players[0]); expect((await report(one)).ok()).toBe(true);
    const two = await codeFor(readiness.players[1]); expect((await report(two, true)).ok()).toBe(true);
    expect((await request.post(`/api/integrity/matches/${fixture.matchId}/admit`, { headers: staff, data: { ready: true } })).status()).toBe(409);
    await page.evaluate(() => { location.hash = '#/admin/match-monitor'; }); await page.getByLabel('Match to clear for play').selectOption(fixture.matchId);
    await expect(panel).toContainText('1 of 2 players ready', { timeout: 15_000 });
    await expect(panel).toContainText('Action required');
    await page.waitForTimeout(4100); expect((await report(two)).ok()).toBe(true);
    await expect(panel).toContainText('2 of 2 players ready', { timeout: 15_000 });
    await expect(panel.getByRole('button', { name: 'Verify match admission' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Verify match admission' }).click();
    await expect(panel).toContainText('All required scans are current.');
    await page.waitForTimeout(4100); expect((await report(two, false, true)).ok()).toBe(true);
    await expect(panel).toContainText('1 of 2 players ready', { timeout: 15_000 });
    await expect(panel).toContainText('speedhack-x86_64.dll');
    await expect(panel.getByText(/All required scans are current/)).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Verify match admission' })).toBeDisabled();
    await page.waitForTimeout(4100); expect((await report(two)).ok()).toBe(true);
    await expect(panel).toContainText('2 of 2 players ready', { timeout: 15_000 });
    const axe = await new AxeBuilder({ page: page as never }).include('.scan-admission').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact || ''))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await panel.screenshot({ path: info.outputPath('all-players-scan-ready.png') });
    await page.evaluate(() => { location.hash = '#/admin/live-stream'; }); await page.getByRole('button', { name: /^Dota 2/ }).first().click();
    await page.getByLabel('Bracket', { exact: true }).selectOption(fixture.id);
    await page.locator('.desk-queue-item').first().click();
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Go live', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(async id => { const path = '/src/lib/firestore.ts'; return (await import(path)).firestoreService.getMatchById(id)?.status; }, fixture.matchId)).toBe('live');
    // The sample third-party video may probe a deliberately unavailable browser capability.
    // Keep the permission restricted; this warning and the expected admission 409 are not app errors.
    expect(errors.filter(error => !error.includes('status of 409') && !error.includes('Permissions policy violation: compute-pressure'))).toEqual([]);
  } finally {
    for (const id of sessions) await request.post(`/api/integrity/sessions/${id}/end`, { headers: staff, data: {} });
    await page.evaluate(async fixture => { const path = '/src/lib/firestore.ts'; const service = (await import(path)).firestoreService; if (fixture.previous) await service.restorePublishedBracket(fixture.previous); else await service.unpublishBracket(fixture.id); }, fixture);
  }
});

test('collector 3.2: iPhone sideload indicators gate approval and Dota install findings are explained', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  const staff = { Authorization: `Bearer ${(await login.json()).idToken}` };
  const suffix = `${info.project.name}-${Date.now()}`;
  const iphone = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: `ios32-${suffix}`, matchLabel: 'Collector 3.2 iPhone', game: 'codm-mp', platform: 'ios', playerName: `Indigo ${suffix}`, serverUrl: 'http://192.168.50.10:3210' } })).json();
  expect((await request.post('/api/integrity/device/claim', { data: { code: iphone.code, device: { model: 'iPhone' } } })).ok()).toBe(true);
  await page.waitForTimeout(1600); // device claims are rate-limited per address
  const pc = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: `pc32-${suffix}`, matchLabel: 'Collector 3.2 Dota', game: 'dota2', platform: 'pc', playerName: `Quartz ${suffix}`, serverUrl: 'http://192.168.50.10:3210' } })).json();
  await page.waitForTimeout(1600);
  const claimed = await request.post('/api/integrity/device/claim', { data: { code: pc.code, device: { model: 'Fixture PC', agent: 'pc-agent 3.2.0' } } });
  expect(claimed.ok(), await claimed.text()).toBe(true);
  const claim = await claimed.json();
  const dota = { found: true, buildId: '26632873', manifestSha256: 'c'.repeat(64), modifiedFiles: ['dota/bin/win64/client.dll'], missingFiles: [], unlistedBinaries: ['bin/win64/version.dll'], contentOverrides: ['dota_mods holds 1 content pack (VPK); Valve ships none there'], launchFlags: ['-insecure (VAC disabled)'] };
  expect((await request.post('/api/integrity/device/heartbeat', { headers: { Authorization: `Bearer ${claim.token}` }, data: { platform: 'pc', processes: [], installedApplications: [], dota, gameRunning: true, screenshotOk: true, checks: { processes: 'complete', installedApplications: 'complete', fileHashes: 'not-configured', dotaFiles: 'complete', fileSweep: 'complete' } } })).ok()).toBe(true);

  await signIn(page, ORGANIZER);
  await page.evaluate(() => { location.hash = '#/admin/match-monitor'; });

  // Dota 2: the install row shows the build and Valve list fingerprint; each finding has its own signal.
  await page.locator('.monitor-session').filter({ hasText: `Quartz ${suffix}` }).getByRole('button', { name: 'Open session' }).click();
  const pcDialog = page.getByRole('dialog');
  await expect(pcDialog.getByText('Dota 2 install')).toBeVisible({ timeout: 20_000 });
  await expect(pcDialog).toContainText('Build 26632873');
  for (const title of ['Dota 2 file differs from Valve\'s list', 'Extra program file beside Dota 2', 'Custom Dota 2 content folder', 'Restricted Dota 2 launch option']) await expect(pcDialog.getByText(title).first()).toBeVisible();
  expect(await pcDialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('dota-install-findings.png') });
  await pcDialog.getByRole('button', { name: /close/i }).first().click();

  // iPhone: every indicator needs an explicit answer; Found blocks approval.
  await page.locator('.monitor-session').filter({ hasText: `Indigo ${suffix}` }).getByRole('button', { name: 'Open session' }).click();
  const dialog = page.getByRole('dialog');
  const indicators = dialog.getByRole('group', { name: 'Sideload and jailbreak indicators' });
  await expect(indicators).toBeVisible({ timeout: 20_000 });
  await expect(indicators.getByRole('radiogroup')).toHaveCount(6);
  for (const box of await dialog.locator('.settings-toggle input[type=checkbox]').all()) await box.check();
  for (const group of await indicators.getByRole('radiogroup').all()) await group.getByText('Not present', { exact: true }).click();
  await indicators.getByRole('radiogroup', { name: 'Developer Mode is on' }).getByText('Found', { exact: true }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'An indicator is marked found' })).toBeVisible();
  const approve = dialog.getByRole('button', { name: 'Approve supervised iPhone' });
  await expect(approve).toBeDisabled();
  await expect(indicators).toContainText('Checked 6 of 6');
  await expect(indicators.locator('.ios-fix')).toHaveText('Tell the player: Turn Developer Mode off. Then check this place again.');
  await indicators.locator('.ios-indicator').filter({ hasText: 'Developer Mode is on' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('ios-indicator-found.png') });
  const axe = await new AxeBuilder({ page: page as never }).include('.feature-dialog').disableRules(['color-contrast']).analyze();
  expect(axe.violations.map(v => v.id)).toEqual([]);
  await indicators.getByRole('radiogroup', { name: 'Developer Mode is on' }).getByText('Not present', { exact: true }).click();
  await expect(indicators.locator('.ios-fix')).toHaveCount(0);
  // The drafted note leaves the two things only a person knows; saving waits until they are filled in.
  await dialog.getByRole('button', { name: 'Write note from checks' }).click();
  const note = dialog.getByLabel('iPhone inspection note');
  await expect(note).toHaveValue(new RegExp(`^Inspected Indigo ${suffix}'s .+ All 6 sideload and jailbreak indicators were not present\\. Recording source: \\[fill in\\]\\. Supervising referee: \\[fill in\\]\\.$`));
  await expect(approve).toBeDisabled();
  await expect(dialog.getByText('Replace each [fill in] in the note before saving.')).toBeVisible();
  await note.fill((await note.inputValue()).replace('Recording source: [fill in]', 'Recording source: observer slot').replace('Supervising referee: [fill in]', 'Supervising referee: Referee B'));
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(dialog.getByText('iPhone inspection saved.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('collector 3.3: the folder check is on by default, staff can change it, and pin a Dota reference file list', async ({ page, request }) => {
  await signIn(page, ORGANIZER);
  const token = await page.evaluate(async () => { const path = '/src/lib/firebase.ts'; return (await import(path)).auth.currentUser.getIdToken(); });
  const headers = { Authorization: `Bearer ${token}` };
  const original = await (await request.get('/api/integrity/config', { headers })).json();
  try {
    // The local monitor store may hold settings from earlier runs; start from the shipped default (required).
    expect((await request.put('/api/integrity/config', { headers, data: { ...original, pc: { ...original.pc, fileSweep: true } } })).ok()).toBe(true);
    await page.evaluate(() => { location.hash = '#/admin/match-monitor'; });
    await page.getByText('Blocklists and thresholds', { exact: true }).click();
    const sweep = page.getByLabel('Cheat-file folder check on player PCs');
    await expect(sweep).toBeChecked();
    await sweep.uncheck();
    await page.getByText('Fingerprint checks', { exact: true }).click();
    await page.getByLabel('Dota 2 reference file lists (dota.signatures SHA-256)').fill(`${'c'.repeat(64)} | Build 26632873 | high`);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved. Devices pick up the new lists on their next report.')).toBeVisible();
    const saved = await (await request.get('/api/integrity/config', { headers })).json();
    expect(saved.pc.fileSweep).toBe(false);
    expect(saved.pc.trustedDotaManifests).toEqual([{ sha256: 'c'.repeat(64), label: 'Build 26632873', severity: 'high' }]);
  } finally {
    expect((await request.put('/api/integrity/config', { headers, data: original })).ok()).toBe(true);
  }
});
