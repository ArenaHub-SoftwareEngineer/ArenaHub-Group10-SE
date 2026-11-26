import { expect, test } from '@playwright/test';
import { GUEST, ORGANIZER, STUDENT, signIn } from './helpers';

const routes = {
  arena: ['home', 'current-live', 'live', 'choose-tournament', 'brackets', 'teams', 'schedule', 'standings', 'integrity', 'ai-assistant', 'support', 'settings'],
  admin: ['overview', 'bracket-studio', 'teams', 'schedule', 'live-stream', 'users', 'logs', 'games', 'reports', 'match-monitor', 'ai-assistant', 'support', 'settings'],
  // Invited guests watch and comment; Anti-cheat and Arena AI are not theirs (those routes open Home).
  guest: ['home', 'current-live', 'live', 'choose-tournament', 'brackets', 'teams', 'schedule', 'standings', 'support', 'settings'],
};
// Phones (small Android, iPhone mini/standard/Plus) on the mobile project; tablets and laptops on the desktop one.
const PHONE_WIDTHS = [375, 320, 360, 390, 414];
const WIDE_WIDTHS = [1440, 1280, 1024, 834, 768];

for (const workspace of ['arena', 'admin', 'guest'] as const) {
  test(`every ${workspace} page fits phones, tablets and desktops`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page, workspace === 'arena' ? STUDENT : workspace === 'guest' ? GUEST : ORGANIZER);
    const mobile = testInfo.project.name.startsWith('mobile');
    const widths = mobile ? PHONE_WIDTHS : WIDE_WIDTHS;
    const problems: string[] = [];
    for (const tab of routes[workspace]) {
      const route = `#/${workspace === 'guest' ? 'arena' : workspace}/${tab}`;
      await page.evaluate(hash => { window.location.hash = hash; }, route);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      // Poster pages (admin Teams, for one) title themselves with a level-2 heading.
      await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible({ timeout: 12_000 });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 850 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (overflow > 1) problems.push(`${workspace} ${route} at ${width}px overflows by ${overflow}px`);
        if (width === widths[0] && ['home', 'current-live', 'schedule', 'overview', 'games', 'live-stream', 'bracket-studio'].includes(tab)) {
          await page.screenshot({ path: testInfo.outputPath(`${workspace}-${tab}.png`), animations: 'disabled' });
        }
      }
    }
    expect(problems).toEqual([]);
  });
}

test('an invited guest has no Arena AI or Anti-cheat', async ({ page }) => {
  await signIn(page, GUEST);
  for (const tab of ['ai-assistant', 'integrity']) {
    await page.evaluate(hash => { window.location.hash = hash; }, `#/arena/${tab}`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole('main').getByText(/Just\s+ask|Arena AI answers/)).toHaveCount(0);
  }
  await expect(page.getByRole('navigation', { name: 'Viewer navigation' }).getByRole('button', { name: /Assistant|Anti-cheat/ })).toHaveCount(0);
});

test('standalone match check-in shows a readable room-code form', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/join.html');
  await expect(page.getByRole('heading', { name: 'Join your match' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Check-in code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
