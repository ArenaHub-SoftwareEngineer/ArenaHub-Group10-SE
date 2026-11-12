import { expect, test } from '@playwright/test';
import { ORGANIZER, STUDENT, signIn, watchErrors } from './helpers';

test('signed-out entry page renders without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /sign in to arenahub/i }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('organizer can sign in and reach the workspace', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, ORGANIZER);
  await expect(page.locator('body')).not.toContainText('Sign in to ArenaHub');
  expect(errors).toEqual([]);
});

test('student can sign in and reach home', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, STUDENT);
  await expect(page.locator('body')).not.toContainText('Sign in to ArenaHub');
  expect(errors).toEqual([]);
});
