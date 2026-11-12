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

test('a signed-in student is refused by the match monitor API', async ({ request }) => {
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: STUDENT, password: QA_PASSWORD, returnSecureToken: true } });
  expect(login.ok()).toBe(true);
  const { idToken } = await login.json();
  const response = await request.get('/api/integrity/sessions', { headers: { Authorization: `Bearer ${idToken}` } });
  expect(response.status()).toBe(403);
  expect((await request.get('/api/integrity/sessions')).status()).toBe(401);
});
