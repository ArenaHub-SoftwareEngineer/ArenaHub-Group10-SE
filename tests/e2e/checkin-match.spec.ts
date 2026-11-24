import { expect, test } from '@playwright/test';
import { ORGANIZER, QA_PASSWORD, STUDENT, signIn } from './helpers';

// The player picks the match they are about to play, so its facilitators see their live screen.
test('player check-in asks for the match and binds the sharing link to it', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile-375', 'Phone check-in only');
  test.setTimeout(90_000);
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  const headers = { Authorization: 'Bearer ' + (await login.json()).idToken };
  const room = await (await request.post('/api/integrity/rooms', { headers, data: { verifiedCheckIn: true, label: 'Player check-in', hours: 1 } })).json();
  const phone = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  });
  try {
    const page = await phone.newPage();
    await signIn(page, STUDENT);
    await page.goto('/player-check-in?room=' + room.id);
    await page.getByRole('combobox', { name: 'Game' }).selectOption('mlbb');
    const matches = page.getByRole('group', { name: 'Your match' });
    await expect(matches.getByRole('radio').first()).toBeVisible({ timeout: 15_000 });
    await expect(matches.getByRole('radio', { name: /Not on the schedule/ })).toBeVisible();
    const first = matches.getByRole('radio').first();
    await expect(page.getByRole('button', { name: 'Continue to device scan' })).toBeDisabled();
    await first.check();
    await page.getByLabel('In-game name').fill('QA Player');
    await page.getByLabel('Team').fill('CN Pulse');
    await page.screenshot({ path: info.outputPath('checkin-match.png'), fullPage: true });
    await page.getByRole('button', { name: 'Continue to device scan' }).click();
    await page.waitForURL(/join\.html/);
    // join.html keeps the private sharing key in session storage (and removes it from the address bar).
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('arena-pov') || '{}').key || ''), { timeout: 15_000 }).toMatch(/^[\w-]+\.[\w-]+\.m-[\w-]+\.[\w-]+$/);
  } finally {
    await phone.close();
    await request.post('/api/integrity/rooms/' + room.id + '/close', { headers, data: {} });
  }
});
