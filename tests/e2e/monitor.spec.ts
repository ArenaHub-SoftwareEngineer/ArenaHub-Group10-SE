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
  await page.getByLabel('Address players will use').fill('http://192.168.50.10:3000');
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
  await expect(pc.locator('#command')).toHaveText(new RegExp(`^arenahub-agent\\.exe --server http://[^ ]+ --code ${p.code}$`));
  await expect(pc.getByRole('link', { name: /Download the agent/ })).toHaveAttribute('href', '/api/integrity/downloads/arenahub-agent.exe');
  await pc.close();
});

test('the iPhone page checks in and can still upload a recording', async ({ browser, request }) => {
  const page = await browser.newPage({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });
  const errors = watchErrors(page);
  const staff = await staffHeaders(request);
  const pair = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId: `ios-${Date.now()}`, matchLabel: 'iPhone test match', game: 'codm-mp', platform: 'ios', playerName: 'Echo', serverUrl: 'http://192.168.50.10:3210' } })).json();
  await page.goto(`/join.html?c=${pair.code}`);
  await expect(page.getByRole('heading', { name: 'Hi Echo' })).toBeVisible();
  await expect(page.locator('#collects')).toContainText('no checks run on your phone');
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
  await page.evaluate(() => { window.location.hash = '#/admin/match-monitor'; });
  await expect(page.getByRole('heading', { name: /watch the devices/i })).toBeVisible({ timeout: 20_000 });

  const pair = await (await request.post('/api/integrity/pairings', { headers: staff, data: { matchId, matchLabel: label, game: 'mlbb', platform: 'ios', team: 'COE Titans', playerName: 'Fable', serverUrl: 'http://192.168.50.10:3210' } })).json();
  const phone = await browser.newPage({ userAgent: IPHONE });
  await phone.goto(`/join.html?c=${pair.code}`);
  phone.once('dialog', dialog => void dialog.accept());
  await phone.getByRole('button', { name: 'Decline monitoring for this match' }).click();
  await expect(phone.getByRole('heading', { name: 'You declined' })).toBeVisible();
  await phone.close();

  const alert = page.getByRole('alert', { name: 'Needs your attention' });
  await expect(alert).toContainText(`Fable (COE Titans) declined monitoring for ${label}`, { timeout: 15_000 });
  await expect(page).toHaveTitle(/^\(\d+\) /);
  await alert.locator('li', { hasText: label }).getByRole('button', { name: 'Done' }).click();
  await expect(alert.locator('li', { hasText: label })).toHaveCount(0);
  await expect(page.locator('.monitor-session', { hasText: label }).first()).toContainText('Declined');
});

test('a signed-in student is refused by the match monitor API', async ({ request }) => {
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: STUDENT, password: QA_PASSWORD, returnSecureToken: true } });
  expect(login.ok()).toBe(true);
  const { idToken } = await login.json();
  const response = await request.get('/api/integrity/sessions', { headers: { Authorization: `Bearer ${idToken}` } });
  expect(response.status()).toBe(403);
  expect((await request.get('/api/integrity/sessions')).status()).toBe(401);
});
