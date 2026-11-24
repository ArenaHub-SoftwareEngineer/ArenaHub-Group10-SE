import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { ORGANIZER, QA_PASSWORD, STUDENT, signIn, watchErrors, openMonitorScans } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
});

test('the check-in QR verifies the player account and hands off to iPhone inspection', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page, ORGANIZER);
  await openMonitorScans(page);
  const room = page.getByRole('region', { name: 'Player check-in' });
  const generate = room.getByRole('button', { name: 'Generate check-in QR' });
  await expect(room.getByRole('heading', { name: 'Player check-in' })).toBeVisible({ timeout: 20000 });
  // A prior run can leave a QR open in the isolated monitor database.
  const close = room.getByRole('button', { name: 'Close check-in' });
  await expect(generate.or(close)).toBeEnabled();
  if (await close.isVisible()) { page.once('dialog', dialog => void dialog.accept()); await close.click(); }
  await generate.click();
  const qr = room.getByRole('img', { name: 'Player check-in QR' });
  await expect(qr).toBeVisible();
  const { pixels, width, height } = await qr.evaluate(async node => {
    const image = node as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return { pixels: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data), width: canvas.width, height: canvas.height };
  });
  const link = jsQR(new Uint8ClampedArray(pixels), width, height)?.data;
  expect(link).toMatch(/\/player-check-in\?room=[A-Za-z0-9_-]{12}$/);
  expect(link).toBe(await room.getByRole('link', { name: 'Open check-in link' }).getAttribute('href'));
  await expect(room.getByText(/choose a match/i)).toHaveCount(0);

  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, userAgent: IPHONE });
  try {
    const player = await phone.newPage();
    await player.goto(link!);
    await player.getByLabel('Email address').fill(STUDENT);
    await player.getByRole('textbox', { name: 'Password', exact: true }).fill(QA_PASSWORD);
    await player.getByRole('button', { name: 'Sign in with email' }).click();
    await expect(player.getByText(STUDENT, { exact: true })).toBeVisible();
    const name = `QA iPhone ${Date.now()}`;
    await player.getByLabel('In-game name').fill(name);
    await player.getByLabel('Team', { exact: true }).fill('QA Phoenix');
    await player.getByLabel('College', { exact: true }).fill('College of Computing Studies');
    await player.getByRole('combobox', { name: /^Game/ }).selectOption('codm-mp');
    // Check-in asks which match the player is about to play (it decides who watches their live screen).
    await player.getByRole('group', { name: 'Your match' }).getByRole('radio', { name: /Not on the schedule/ }).check();
    await player.getByRole('button', { name: 'Continue to device scan' }).click();
    await player.getByRole('button', { name: 'Agree and check in' }).click();
    await expect(player.getByRole('heading', { name: 'You are checked in' })).toBeVisible();
    await expect(player.getByRole('link', { name: 'Open screen sharing' })).toBeVisible();
    const row = room.locator('.room-player').filter({ hasText: name });
    await expect(row).toContainText('iPhone', { timeout: 20000 });
    await expect(row).toContainText(STUDENT);
  } finally {
    await phone.close();
    page.once('dialog', dialog => void dialog.accept());
    await close.click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('player-check-in.png'), fullPage: true });
});

test('the scan chart shows game and team totals and opens individual player sessions', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  const staff = { Authorization: `Bearer ${(await login.json()).idToken}` };
  const matchId = `arena-${testInfo.project.name}-${Date.now()}`;
  const android = (over: Record<string, unknown>) => ({ platform: 'android', games: [{ packageName: 'com.mobile.legends', certSha256: ['a'.repeat(64)], installer: 'com.android.vending' }], installedFlagged: [], rootIndicators: [], emulatorIndicators: [], accessibilityServices: [], overlayPackages: [], developerOptions: false, usbDebugging: false, recording: true, ...over });
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
  await openMonitorScans(page);
  await expect(page.getByRole('group', { name: 'Scan chart by game' }).getByRole('button', { name: /^Mobile Legends,/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Evidence and appeals|Blocklists and thresholds|desktop alerts|Match arena/i)).toHaveCount(0);
  await page.getByLabel('Scan game').selectOption('mlbb');
  await page.getByLabel('Scan match').selectOption(matchId);
  const chart = page.getByRole('group', { name: 'Scan chart by team' });
  await expect(chart.getByRole('button', { name: /^CCS Phoenix, Mobile Legends, 2 scanned, 0 iPhone inspected, 0 awaiting/ })).toBeVisible();
  const titans = chart.getByRole('button', { name: /^COE Titans, Mobile Legends, 1 scanned, 0 iPhone inspected, 1 awaiting/ });
  await expect(titans).toBeVisible();
  await chart.screenshot({ path: testInfo.outputPath('scan-coverage.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await titans.click();
  const players = page.getByRole('dialog', { name: /^COE Titans/ });
  await expect(players.getByText('Dusk', { exact: true })).toBeVisible();
  await players.getByLabel('Check status').selectOption('scanned');
  await expect(players.getByText('Dusk', { exact: true })).toHaveCount(0);
  await players.getByRole('button', { name: 'Open session' }).click();
  const dialog = page.getByRole('dialog', { name: /^Cinder/ });
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

test('a referee adds a flagged file\'s fingerprint from the session', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const staff = await staffHeaders(request);
  const playerName = `Print ${testInfo.project.name} ${Date.now()}`;
  // A fixed, harmless value: not the fingerprint of any real file.
  const sha256 = testInfo.project.name === 'mobile-375' ? 'e'.repeat(64) : 'f'.repeat(64);
  const pair = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: `print-${Date.now()}`, matchLabel: 'Fingerprint test', game: 'dota2', playerName, serverUrl: 'http://192.168.50.10:3000' } })).json();
  const claim = await (await request.post('/api/integrity/device/claim', { data: { code: pair.code, device: { model: 'Test PC' } } })).json();
  const finding = { name: 'dota_helper.exe', folder: 'Downloads', reason: 'Unsigned program that references dota2.exe', sha256, severity: 'high' };
  expect((await request.post('/api/integrity/device/heartbeat', { headers: { Authorization: `Bearer ${claim.token}` }, data: { platform: 'pc', processes: [], gameRunning: true, screenshotOk: true, fileFindings: [finding] } })).ok()).toBe(true);
  try {
    await signIn(page, ORGANIZER);
    await openMonitorScans(page);
    await page.getByRole('button', { name: 'Player scans', exact: true }).click();
    await page.locator('.monitor-session').filter({ hasText: playerName }).first().getByRole('button', { name: /open session/i }).click({ timeout: 20_000 });
    const dialog = page.getByRole('dialog', { name: `${playerName} · Dota 2` });
    await dialog.getByRole('button', { name: 'Confirmed cheat? Add its fingerprint' }).click();
    await dialog.getByLabel(/Name for this file/).fill('Dota helper loader');
    await dialog.getByRole('button', { name: 'Add fingerprint', exact: true }).click();
    await expect(dialog).toContainText('Fingerprint added.');
    await expect(dialog).toContainText('This file is on the fingerprint list.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  } finally {
    // Leave the shared test settings as they were.
    const config = await (await request.get('/api/integrity/config', { headers: staff })).json();
    config.pc.blockedFileHashes = (config.pc.blockedFileHashes || []).filter((entry: { sha256: string }) => entry.sha256 !== sha256);
    await request.put('/api/integrity/config', { headers: staff, data: config });
  }
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
async function staffHeaders(request: any) {
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  return { Authorization: `Bearer ${(await login.json()).idToken}` };
}

test('one QR link: the join page adapts to Android, PC and iPhone', async ({ browser, request }) => {
  const staff = await staffHeaders(request);
  const make = async (game: string, platform: string, playerName: string) => (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: `join-${Date.now()}`, matchLabel: 'Join test', game, platform, playerName, serverUrl: 'http://192.168.50.10:3210' } })).json();

  const android = await browser.newPage({ userAgent: ANDROID });
  const a = await make('mlbb', 'android', 'Ace');
  expect(a.link).toMatch(/\/join\.html\?c=[A-Z2-9]{8}$/);
  await android.goto(`/join.html?c=${a.code}`);
  await expect(android.getByRole('heading', { name: 'Hi Ace' })).toBeVisible();
  await expect(android.getByRole('link', { name: /Download the app/ })).toHaveAttribute('href', '/api/integrity/downloads/arenahub-companion.apk');
  const open = await android.getByRole('link', { name: 'Open ArenaHub Companion' }).getAttribute('href');
  expect(open).toContain(`intent://pair?s=`); expect(open).toContain(`c=${a.code}`); expect(open).toContain('package=ph.edu.wmsu.arenahub.companion'); expect(open).toContain('browser_fallback_url=');
  await android.goto(`/join.html?c=${a.code}&install=1`);
  await expect(android.locator('#status')).toContainText('not installed yet');
  await android.close();

  const pc = await browser.newPage();
  await pc.waitForTimeout(400);
  const p = await make('dota2', 'pc', 'Dusk');
  await pc.goto(`/join.html?c=${p.code}`);
  // One click for a PC that has run the agent before; otherwise the download already carries the code.
  const origin = new URL(pc.url()).origin;
  await expect(pc.getByRole('link', { name: 'Start my scan' })).toHaveAttribute('href', `arenahub://scan?s=${encodeURIComponent(origin)}&c=${p.code}`);
  const download = pc.getByRole('link', { name: /Download my scan/ });
  await expect(download).toHaveAttribute('href', `/api/integrity/downloads/arenahub-agent.exe?code=${p.code}`);
  await pc.getByText('Start it by typing a command instead').click();
  await expect(pc.locator('#command')).toHaveText(new RegExp(`^arenahub-agent\\.exe --server http://[^ ]+ --code ${p.code}$`));
  expect(await pc.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await pc.locator('#pc').screenshot({ path: test.info().outputPath('join-pc.png') });
  await pc.close();
});

test('the iPhone page checks in and can still upload a recording', async ({ browser, request }) => {
  const page = await browser.newPage({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });
  const errors = watchErrors(page);
  const staff = await staffHeaders(request);
  const pair = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: `ios-${Date.now()}`, matchLabel: 'iPhone test match', game: 'codm-mp', platform: 'ios', playerName: 'Echo', serverUrl: 'http://192.168.50.10:3210' } })).json();
  await page.goto(`/join.html?c=${pair.code}`);
  await expect(page.getByRole('heading', { name: 'Hi Echo' })).toBeVisible();
  await expect(page.locator('#collects')).toContainText('Requires a referee to check your playing device');
  await page.getByRole('button', { name: 'Agree and check in' }).click();
  await expect(page.getByRole('heading', { name: 'You are checked in' })).toBeVisible();
  expect((await (await request.get(`/api/integrity/sessions/${pair.id}`, { headers: staff })).json()).connection).toBe('paired');
  await page.getByText('The referee asked for my own screen recording').click();
  // 9 MB spans three 4 MB chunks.
  const video = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(9 * 1024 * 1024, 3)]);
  await page.locator('#file').setInputFiles({ name: 'match.mov', mimeType: 'video/quicktime', buffer: video });
  await page.getByRole('button', { name: 'Upload recording' }).click();
  await expect(page.locator('#status')).toContainText('Upload complete', { timeout: 30_000 });
  const detail = await (await request.get(`/api/integrity/sessions/${pair.id}`, { headers: staff })).json();
  expect(detail.media).toHaveLength(1);
  expect(detail.media[0].bytes).toBe(video.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  await page.close();
});

test('a player who declines is shown to staff as an alert', async ({ page, browser, request }, testInfo) => {
  const staff = await staffHeaders(request);
  const matchId = `decline-${testInfo.project.name}-${Date.now()}`;
  // A label unique to this run: monitor data persists between runs, so earlier 'Decline test' alerts may still be listed.
  const label = `Decline test ${Date.now() % 100000}`;
  await signIn(page, ORGANIZER);
  await openMonitorScans(page);
  await expect(page.getByRole('heading', { name: /^monitor$/i })).toBeVisible({ timeout: 20_000 });

  const pair = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId, matchLabel: label, game: 'mlbb', platform: 'ios', team: 'COE Titans', playerName: 'Fable', serverUrl: 'http://192.168.50.10:3210' } })).json();
  const phone = await browser.newPage({ userAgent: IPHONE });
  await phone.goto(`/join.html?c=${pair.code}`);
  phone.once('dialog', dialog => void dialog.accept());
  await phone.getByRole('button', { name: 'Decline monitoring for this match' }).click();
  await expect(phone.getByRole('heading', { name: 'You declined' })).toBeVisible();
  await phone.close();

  await page.getByRole('button', { name: /^Needs your attention/ }).click({ timeout: 15_000 });
  const alert = page.getByRole('alert', { name: 'Needs your attention' });
  await expect(alert).toContainText(`Fable (COE Titans) declined monitoring for ${label}`, { timeout: 15_000 });
  await alert.locator('li', { hasText: label }).getByRole('button', { name: 'Done' }).click();
  await expect(alert.locator('li', { hasText: label })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Needs your attention' }).getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Player scans', exact: true }).click();
  await expect(page.locator('.monitor-session', { hasText: label }).first()).toContainText(/declined/i);
});

test('a signed-in student is refused by the match monitor API', async ({ request }) => {
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: STUDENT, password: QA_PASSWORD, returnSecureToken: true } });
  expect(login.ok()).toBe(true);
  const { idToken } = await login.json();
  const response = await request.get('/api/integrity/sessions', { headers: { Authorization: `Bearer ${idToken}` } });
  expect(response.status()).toBe(403);
  expect((await request.get('/api/integrity/sessions')).status()).toBe(401);
});
