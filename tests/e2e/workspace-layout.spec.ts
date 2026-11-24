import { expect, test } from '@playwright/test';
import { ORGANIZER, STUDENT, signIn } from './helpers';

const routes = {
  arena: ['home', 'current-live', 'live', 'choose-tournament', 'brackets', 'teams', 'schedule', 'standings', 'operations', 'integrity', 'ai-assistant', 'support', 'settings'],
  admin: ['overview', 'bracket-studio', 'operations', 'schedule', 'live-stream', 'users', 'logs', 'games', 'reports', 'match-monitor', 'ai-assistant', 'support', 'settings'],
};

for (const workspace of ['arena', 'admin'] as const) {
  test(`every ${workspace} page fits the workspace at narrow and wide widths`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, workspace === 'arena' ? STUDENT : ORGANIZER);
    const mobile = testInfo.project.name.startsWith('mobile');
    const widths = mobile ? [375, 320] : [1440, 768];
    const problems: string[] = [];
    for (const tab of routes[workspace]) {
      const route = `#/${workspace}/${tab}`;
      await page.evaluate(hash => { window.location.hash = hash; }, route);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible({ timeout: 12_000 });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 850 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (overflow > 1) problems.push(`${route} at ${width}px overflows by ${overflow}px`);
        if (width === widths[0] && ['home', 'current-live', 'schedule', 'overview', 'games', 'live-stream', 'bracket-studio'].includes(tab)) {
          await page.screenshot({ path: testInfo.outputPath(`${tab}.png`), animations: 'disabled' });
        }
      }
    }
    expect(problems).toEqual([]);
  });
}

test('standalone match check-in shows a readable room-code form', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/join.html');
  await expect(page.getByRole('heading', { name: 'Join your match' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Room code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
