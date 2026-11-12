import { expect, type Page } from '@playwright/test';

export const QA_PASSWORD = 'ArenaHub-QA-Only-27!';
export const ORGANIZER = 'organizer@wmsu.edu.ph';
export const STUDENT = 'student@wmsu.edu.ph';

/** Collects console errors and uncaught page errors so a test can assert none happened. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The emulator connection warning and favicon misses are not application errors.
    if (/favicon|Failed to load resource: the server responded with a status of 404/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

export async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /sign in to arenahub/i }).first().click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(QA_PASSWORD);
  await page.locator('button.auth-submit').click();
  await expect(page.locator('button.auth-submit')).toHaveCount(0, { timeout: 20_000 });
}
