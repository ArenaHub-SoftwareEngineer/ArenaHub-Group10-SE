import { expect, test } from '@playwright/test';
import { ORGANIZER, STUDENT, signIn } from './helpers';

test('viewer page search handles empty results and browser history', async ({ page }, testInfo) => {
  await signIn(page, STUDENT);
  const mobile = testInfo.project.name.startsWith('mobile');
  await expect(page.getByRole('main', { name: 'Home' })).toBeVisible();

  if (mobile) await page.getByRole('button', { name: 'Search pages' }).click();
  else await page.keyboard.press('/');
  const search = page.getByRole('combobox', { name: 'Search pages' });
  await expect(search).toBeFocused();
  await search.fill('zzzz');
  await expect(page.getByText('No pages found. Try a different search.')).toBeVisible();
  await search.fill('standings');
  await search.press('Enter');

  await expect(page).toHaveURL(/#\/arena\/standings$/);
  await expect(page.getByRole('main', { name: 'Standings' })).toBeFocused();
  await page.goBack();
  await expect(page.getByRole('main', { name: 'Home' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('main', { name: 'Standings' })).toBeVisible();
});

test('admin navigation shows the current page and works on narrow screens', async ({ page }, testInfo) => {
  await signIn(page, ORGANIZER);
  await expect(page.getByRole('main', { name: 'Overview' })).toBeVisible();
  const mobile = testInfo.project.name.startsWith('mobile');
  const nav = page.getByRole('navigation', { name: 'Admin navigation' });
  if (mobile) {
    await page.setViewportSize({ width: 320, height: 740 });
    const more = page.getByRole('button', { name: 'More pages' });
    await more.click();
    const drawer = page.getByRole('dialog', { name: 'Admin navigation' });
    await expect(drawer.getByRole('button', { name: 'Close navigation' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();
    await more.click();
    await nav.getByRole('link', { name: 'Games', exact: true }).click();
    await expect(drawer).toBeHidden();
    const current = page.getByRole('button', { name: 'More pages. Current page: Game catalog' });
    await current.click();
    await expect(nav.getByRole('link', { name: 'Games', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
  } else {
    await nav.getByRole('link', { name: 'Games', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'Games', exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await expect(page.getByRole('heading', { name: 'Game catalog' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
