import AxeBuilder from '@axe-core/playwright';
import { devices, test, expect } from '@playwright/test';
import { addBroadcastThumbnail, ORGANIZER, STUDENT, QA_PASSWORD, signIn, watchErrors, openMonitorScans } from './helpers';

test('staff can save and reload the protected-game DLL policy through the configuration API', async ({ page, request }) => {
  await signIn(page, ORGANIZER);
  const token = await page.evaluate(async () => { const path = '/src/lib/firebase.ts'; return (await import(path)).auth.currentUser.getIdToken(); });
  const headers = { Authorization: `Bearer ${token}` };
  const original = await (await request.get('/api/integrity/config', { headers })).json();
  try {
    const fixture = { match: 'fixture-only.dll', label: 'Harmless policy fixture', severity: 'high' };
    const updated = { ...original, pc: { ...original.pc, blockedModules: [...original.pc.blockedModules, fixture] } };
    expect((await request.put('/api/integrity/config', { headers, data: updated })).ok()).toBe(true);
    const saved = await (await request.get('/api/integrity/config', { headers })).json();
    expect(saved.pc.blockedModules).toContainEqual(fixture);
  } finally {
    expect((await request.put('/api/integrity/config', { headers, data: original })).ok()).toBe(true);
  }
});

test('player anti-cheat entry prioritizes the required app scan and keeps disputes secondary', async ({ page }, info) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  await signIn(page, STUDENT); await page.goto('/#/arena/integrity');
  await expect(page.getByRole('heading', { name: 'Anti-cheat', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scan before you play' })).toBeVisible();
  await expect(page.locator('details').filter({ hasText: 'Disputes and appeals' })).not.toHaveAttribute('open', '');
  await expect(page.getByText(/check-in QR or link/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open room check-in' })).toHaveAttribute('href', /\/join\.html$/);
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
  await practice.getByRole('checkbox', { name: /Developer Mode/ }).check();
  await expect(practice.getByText('1 of 6 reviewed. A referee grants match clearance.')).toBeVisible();
  await expect(practice).toContainText('Turn Developer Mode off.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await practice.screenshot({ path: info.outputPath('player-practice.png') });
  expect(errors).toEqual([]);
});

test('iPhone check-in can retry status and displays expired clearance', async ({ browser, baseURL }) => {
  const phone = await browser.newContext({ baseURL, userAgent: devices['iPhone 13'].userAgent });
  try {
    const page = await phone.newPage();
    const player = { playerName: 'iPhone QA', matchLabel: 'Test match', gameLabel: 'Mobile Legends', platform: 'ios' };
    await page.route('**/api/integrity/device/pairing/ABCD2345', route => route.fulfill({ json: player }));
    await page.route('**/api/integrity/device/claim', route => route.fulfill({ json: { ...player, token: 'test-status-token', expiresAt: Date.now() + 60_000 } }));
    let mode: 'unavailable' | 'ready' | 'expired' = 'unavailable';
    await page.route('**/api/integrity/device/status', route => {
      if (mode === 'unavailable') return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { scan: { status: 'ready', validUntil: Date.now() + (mode === 'ready' ? 60_000 : -1000) } } });
    });

    await page.goto('/join.html?c=ABCD2345');
    await page.getByRole('button', { name: 'Agree and check in' }).click();
    await expect(page.getByRole('heading', { name: 'Status unavailable' })).toBeVisible();
    const refresh = page.getByRole('button', { name: 'Refresh inspection status' });
    mode = 'ready';
    await refresh.click();
    await expect(page.getByRole('heading', { name: 'Cleared to play' })).toBeVisible();
    mode = 'expired';
    await refresh.click();
    await expect(page.getByRole('heading', { name: 'Inspection expired' })).toBeVisible();
    await expect(page.getByText('Clearance valid for')).toBeHidden();
  } finally {
    await phone.close();
  }
});

test('Go live does not wait for scans; the staff panel still tracks each player and restricted software', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://www.youtube.com/embed/**', route => route.fulfill({ body: '' }));
  const errors = watchErrors(page);
  await signIn(page, ORGANIZER);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const servicePath = '/src/lib/firestore.ts', bracketsPath = '/src/lib/bracketUtils.ts';
    const { firestoreService } = await import(servicePath), { createBracketFromTeams } = await import(bracketsPath);
    const previous = firestoreService.getPublishedBrackets().find((bracket: any) => bracket.gameId === 'game-dota2') || null;
    const draft = createBracketFromTeams({ title: `Required scan QA ${Date.now()}`, teams: [{ name: 'Scan Alpha' }, { name: 'Scan Bravo' }], matchFormat: 'Bo1', finalMatchFormat: 'Bo1' });
    draft.matches[0].team1.players = [{ id: 'scan-a', ign: 'Scan Ace', name: 'Private A', collegeId: '', role: 'Player', isVerified: true }];
    draft.matches[0].team2.players = [{ id: 'scan-b', ign: 'Scan Bolt', name: 'Private B', collegeId: '', role: 'Player', isVerified: true }];
    draft.matches[0].scheduledDate = '2026-12-04';
    draft.matches[0].scheduledTime = '15:00';
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
    const panel = page.getByRole('region', { name: 'Required pre-match scans' });
    const openReadiness = async () => {
      await page.goto(`/#/admin/live-stream?streamBracket=${encodeURIComponent(fixture.id)}&streamMatch=${encodeURIComponent(fixture.matchId)}`);
      if (!(await panel.isVisible())) await page.getByText('Match scan readiness', { exact: true }).click();
    };
    await openReadiness();
    await expect(panel).toContainText('0 of 2 players ready', { timeout: 20_000 });
    await expect(panel).toContainText('Waiting on scans');
    // The organizer clears players before match time; Go live itself does not check scans.
    await page.goto(`/#/admin/live-stream?streamBracket=${encodeURIComponent(fixture.id)}&streamMatch=${encodeURIComponent(fixture.matchId)}`);
    await expect(page.getByText('Scan Alpha vs Scan Bravo', { exact: true })).toBeVisible();
    const wizard = page.getByRole('dialog', { name: 'Set up a broadcast' });
    await wizard.getByRole('textbox', { name: /Live link/ }).fill('https://www.youtube.com/live/m4zQpYzzM0g');
    await addBroadcastThumbnail(page, wizard);
    const goLive = wizard.getByRole('button', { name: 'Go live', exact: true });
    await goLive.click();
    await expect(wizard.getByText('Match is on air in ArenaHub.')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(async id => { const path = '/src/lib/firestore.ts'; return (await import(path)).firestoreService.getMatchById(id)?.status; }, fixture.matchId)).toBe('live');

    const readiness = await (await request.get(`/api/integrity/matches/${fixture.matchId}/readiness`, { headers: staff })).json();
    const one = await codeFor(readiness.players[0]); expect((await report(one)).ok()).toBe(true);
    const two = await codeFor(readiness.players[1]); expect((await report(two, true)).ok()).toBe(true);
    expect((await request.post(`/api/integrity/matches/${fixture.matchId}/admit`, { headers: staff, data: { ready: true } })).status()).toBe(409);
    await openReadiness();
    await expect(panel).toContainText('1 of 2 players ready', { timeout: 15_000 });
    await expect(panel).toContainText('Action required');
    await page.waitForTimeout(4100); expect((await report(two)).ok()).toBe(true);
    await expect(panel).toContainText('2 of 2 players ready', { timeout: 15_000 });
    await expect(panel).toContainText('Everyone has passed');
    await page.waitForTimeout(4100); expect((await report(two, false, true)).ok()).toBe(true);
    await expect(panel).toContainText('1 of 2 players ready', { timeout: 15_000 });
    await expect(panel).toContainText('speedhack-x86_64.dll');
    await expect(panel).toContainText('Waiting on scans');
    await page.waitForTimeout(4100); expect((await report(two)).ok()).toBe(true);
    await expect(panel).toContainText('2 of 2 players ready', { timeout: 15_000 });
    const axe = await new AxeBuilder({ page: page as never }).include('.scan-admission').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact || ''))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await panel.screenshot({ path: info.outputPath('all-players-scan-ready.png') });
    // The sample third-party video may probe a deliberately unavailable browser capability.
    // Keep the permission restricted; this warning and the expected /admit 409 are not app errors.
    expect(errors.filter(error => !error.includes('status of 409') && !error.includes('Permissions policy violation: compute-pressure'))).toEqual([]);
  } finally {
    for (const id of sessions) await request.post(`/api/integrity/sessions/${id}/end`, { headers: staff, data: {} });
    await page.evaluate(async fixture => { const path = '/src/lib/firestore.ts'; const service = (await import(path)).firestoreService; if (fixture.previous) await service.restorePublishedBracket(fixture.previous); else await service.unpublishBracket(fixture.id); }, fixture);
  }
});

test('collector 3.2: iPhone sideload indicators gate approval and Dota install findings are explained', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
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
  await openMonitorScans(page);

  // Dota 2: the install row shows the build and Valve list fingerprint; each finding has its own signal.
  await page.getByRole('button', { name: 'Player scans', exact: true }).click();
  await page.locator('.monitor-session').filter({ hasText: `Quartz ${suffix}` }).getByRole('button', { name: 'Open session' }).click();
  const pcDialog = page.getByRole('dialog', { name: `Quartz ${suffix} · Dota 2` });
  await expect(pcDialog.getByText('Dota 2 install')).toBeVisible({ timeout: 20_000 });
  await expect(pcDialog).toContainText('Build 26632873');
  for (const title of ['Dota 2 file differs from Valve\'s list', 'Extra program file beside Dota 2', 'Custom Dota 2 content folder', 'Restricted Dota 2 launch option']) await expect(pcDialog.getByText(title).first()).toBeVisible();
  expect(await pcDialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('dota-install-findings.png') });
  await pcDialog.getByRole('button', { name: /close/i }).first().click();

  // iPhone: every indicator needs an explicit answer; Found blocks approval.
  await page.locator('.monitor-session').filter({ hasText: `Indigo ${suffix}` }).getByRole('button', { name: 'Open session' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`^Indigo ${suffix} ·`) });
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
    const pinned = { sha256: 'c'.repeat(64), label: 'Build 26632873', severity: 'high' };
    const updated = { ...original, pc: { ...original.pc, fileSweep: false, trustedDotaManifests: [pinned] } };
    expect((await request.put('/api/integrity/config', { headers, data: updated })).ok()).toBe(true);
    const saved = await (await request.get('/api/integrity/config', { headers })).json();
    expect(saved.pc.fileSweep).toBe(false);
    expect(saved.pc.trustedDotaManifests).toEqual([pinned]);
  } finally {
    expect((await request.put('/api/integrity/config', { headers, data: original })).ok()).toBe(true);
  }
});
