import { expect, test } from '@playwright/test';
import { ORGANIZER, QA_PASSWORD, STUDENT, signIn, watchErrors } from './helpers';

test('organizer creates a match monitor pairing code', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await signIn(page, ORGANIZER);
  await page.evaluate(() => { window.location.hash = '#/admin/match-monitor'; });
  await expect(page.getByRole('heading', { name: /watch the devices/i })).toBeVisible({ timeout: 20_000 });

  // Labels wrap their selects, so select by the label element rather than its accessible name.
  const form = page.locator('.monitor-pair-form');
  await form.locator('label', { hasText: /^Match/ }).first().locator('select').selectOption('');
  await page.getByLabel('Match name').fill('E2E scrim CCS vs COE');
  await form.locator('label', { hasText: /^Game/ }).locator('select').selectOption('mlbb');
  await page.getByLabel('Player (IGN)').fill('E2E Ace');
  await page.getByLabel('Laptop address devices will use').fill('http://192.168.50.10:3000');
  await page.getByRole('button', { name: 'Create pairing code' }).click();

  await expect(page.getByAltText(/pairing qr code for e2e ace/i)).toBeVisible();
  await expect(page.locator('.monitor-code')).toHaveText(/^[A-Z2-9]{8}$/);
  await expect(page.locator('.monitor-session').filter({ hasText: 'E2E Ace' }).first()).toContainText('Waiting for device');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('match-monitor.png'), fullPage: true });

  await page.locator('.monitor-session').filter({ hasText: 'E2E Ace' }).first().getByRole('button', { name: /open session/i }).click();
  await expect(page.getByRole('dialog')).toContainText('No signals yet');
  await page.getByRole('button', { name: 'End monitoring' }).click();
  await expect(page.getByRole('dialog')).toContainText('Monitoring ended');
  expect(errors).toEqual([]);
});

test('the 3D arena shows flagged players by category and opens their evidence', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  const staff = { Authorization: `Bearer ${(await login.json()).idToken}` };
  const matchId = `arena-${testInfo.project.name}-${Date.now()}`;
  const android = (over: Record<string, unknown>) => ({ platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: ['a'.repeat(64)] }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: true, ...over });
  const roster: [string, string, 'android' | 'ios', Record<string, unknown> | null][] = [
    ['Ace', 'CCS Phoenix', 'android', {}],
    ['Blitz', 'CCS Phoenix', 'android', { installedFlagged: ['com.lbe.parallel.intl'], usbDebugging: true, developerOptions: true }],
    ['Cinder', 'COE Titans', 'android', { rootIndicators: ['/system/xbin/su'], installedFlagged: ['com.topjohnwu.magisk'], recording: false }],
    ['Dusk', 'COE Titans', 'ios', null],
  ];
  for (const [playerName, team, platform, facts] of roster) {
    const pair = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId, matchLabel: 'Arena test CCS vs COE', game: 'mlbb', platform, team, playerName, serverUrl: 'http://192.168.50.10:3000' } })).json();
    const claim = await request.post('/api/integrity/device/claim', { data: { code: pair.code, device: { model: 'Test phone' } } });
    expect(claim.ok()).toBe(true);
    if (facts) expect((await request.post('/api/integrity/device/heartbeat', { headers: { Authorization: `Bearer ${(await claim.json()).token}` }, data: android(facts) })).ok()).toBe(true);
    await page.waitForTimeout(1600);
  }

  await signIn(page, ORGANIZER);
  await page.evaluate(() => { window.location.hash = '#/admin/match-monitor'; });
  const arena = page.locator('.monitor3d');
  await expect(arena.getByRole('button', { name: /^Cinder, Android, risk 85 of 100, urgent/ })).toBeVisible({ timeout: 20_000 });
  await expect(arena.getByRole('button', { name: /^Ace, Android, risk 0 of 100, clear/ })).toBeVisible();
  await expect(arena.getByRole('button', { name: /^Dusk, iPhone, risk 0 of 100/ })).toBeVisible();
  await expect(arena.locator('.monitor3d-pillar.urgent .monitor3d-block.cat-cheat-tools')).toHaveCount(1);
  await arena.scrollIntoViewIfNeeded();
  await arena.screenshot({ path: testInfo.outputPath('arena.png') });
  await arena.getByLabel('Turn the view').fill('40');
  await arena.screenshot({ path: testInfo.outputPath('arena-turned.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await arena.getByRole('button', { name: /^Cinder/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Risk by category');
  await expect(dialog.locator('.monitor-breakdown li', { hasText: 'Cheat tools' })).toContainText('35');
  await expect(dialog).toContainText('Map hack (radar)');
  await dialog.locator('label', { hasText: 'I saw signs of' }).locator('select').selectOption('map-hack');
  await dialog.getByLabel('What you saw and when').fill('Rotated to a fogged gank at 08:15 with no vision');
  await dialog.getByRole('button', { name: 'Record observation' }).click();
  await expect(dialog).toContainText('Observation recorded');
  await expect(dialog.locator('.monitor-breakdown li', { hasText: 'Behaviour' })).toContainText('15');
  await dialog.screenshot({ path: testInfo.outputPath('session.png') });
  expect(errors).toEqual([]);
});

test('the iPhone page pairs and uploads a recording', async ({ page, request }) => {
  const errors = watchErrors(page);
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  const staff = { Authorization: `Bearer ${(await login.json()).idToken}` };
  const pair = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: `ios-${Date.now()}`, matchLabel: 'iPhone test match', game: 'codm-mp', platform: 'ios', playerName: 'Echo', serverUrl: 'http://192.168.50.10:3000' } })).json();
  await page.goto(`/proctor.html?c=${pair.code}`);
  await expect(page.getByLabel('Pairing code from the referee screen')).toHaveValue(pair.code);
  await page.getByRole('button', { name: 'Pair this iPhone' }).click();
  await expect(page.locator('#status')).toContainText('Tick the box');
  await page.getByLabel('I understand and agree for this match').check();
  await page.getByRole('button', { name: 'Pair this iPhone' }).click();
  await expect(page.locator('#status')).toContainText('Paired');
  await expect(page.locator('#who')).toContainText('Echo');
  // 9 MB spans three 4 MB chunks.
  const video = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(9 * 1024 * 1024, 3)]);
  await page.getByLabel('Choose the screen recording from Photos').setInputFiles({ name: 'match.mov', mimeType: 'video/quicktime', buffer: video });
  await page.getByRole('button', { name: 'Upload recording' }).click();
  await expect(page.locator('#status')).toContainText('Upload complete', { timeout: 30_000 });
  const detail = await (await request.get(`/api/integrity/sessions/${pair.id}`, { headers: staff })).json();
  expect(detail.media).toHaveLength(1);
  expect(detail.media[0].bytes).toBe(video.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('a signed-in student is refused by the match monitor API', async ({ request }) => {
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: STUDENT, password: QA_PASSWORD, returnSecureToken: true } });
  expect(login.ok()).toBe(true);
  const { idToken } = await login.json();
  const response = await request.get('/api/integrity/sessions', { headers: { Authorization: `Bearer ${idToken}` } });
  expect(response.status()).toBe(403);
  expect((await request.get('/api/integrity/sessions')).status()).toBe(401);
});
