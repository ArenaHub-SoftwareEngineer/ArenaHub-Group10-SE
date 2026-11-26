import { expect, type Locator, type Page } from '@playwright/test';

export const QA_PASSWORD = 'ArenaHub-QA-Only-27!';
export const ORGANIZER = 'organizer@wmsu.edu.ph';
export const STUDENT = 'student@wmsu.edu.ph';
/** Personal-email guest admitted with a student invite (tests/seed-emulators.mjs). */
export const GUEST = 'guest@example.com';

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
  const openSignIn = page.getByRole('button', { name: /sign in to arenahub/i }).first();
  const emailAddress = page.getByRole('textbox', { name: 'Email address' });
  await expect(openSignIn.or(emailAddress).first()).toBeVisible();
  if (!await emailAddress.isVisible()) await openSignIn.click();
  await emailAddress.fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(QA_PASSWORD);
  await page.locator('button.auth-submit').click();
  await expect(page.locator('button.auth-submit')).toHaveCount(0, { timeout: 20_000 });
}

export async function addBroadcastThumbnail(page: Page, dialog: Locator) {
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#216fbc';
    context.fillRect(0, 0, 160, 90);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.getByLabel('Upload thumbnail').setInputFiles({ name: 'thumbnail.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(dialog.getByText('Thumbnail added.', { exact: true })).toBeVisible();
}

export async function scheduleDraft(page: Page) {
  const schedule = page.locator('details.schedule-section');
  if (!(await schedule.evaluate(el => (el as HTMLDetailsElement).open))) await schedule.locator(':scope > summary').click();
  const instructions = schedule.getByText('Schedule from a prompt', { exact: true });
  if (!(await instructions.evaluate(el => (el.parentElement as HTMLDetailsElement).open))) await instructions.click();
  await schedule.getByLabel('Schedule instructions or CSV').fill('Schedule all matches tomorrow starting at 8 AM every 60 minutes');
  await schedule.getByRole('button', { name: 'Apply schedule' }).click();
  await expect(schedule.getByRole('status')).toContainText(/matches? scheduled/);
}

/** Anti-cheat opens on Screens. Device scans are on its Scans tab. */
export async function openMonitorScans(page: Page) {
  await page.evaluate(() => { location.hash = '#/admin/match-monitor'; });
  await page.getByRole('tab', { name: /^Scans/ }).click({ timeout: 20_000 });
}
