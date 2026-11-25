import { expect, test, type Page } from '@playwright/test';
import { QA_PASSWORD, watchErrors } from './helpers';

// Account emails are Firebase links. The Auth emulator does not send mail; it lists every link it would
// have sent, so these tests click the same link a player would get in their inbox.
const OOB = 'http://127.0.0.1:9098/emulator/v1/projects/demo-arenahub/oobCodes';
type Oob = { email: string; requestType: string; oobLink: string };
async function linkFor(email: string, requestType: 'VERIFY_EMAIL' | 'PASSWORD_RESET') {
  let found: Oob | undefined;
  await expect.poll(async () => {
    const { oobCodes } = await (await fetch(OOB)).json() as { oobCodes: Oob[] };
    found = oobCodes.filter(c => c.email === email && c.requestType === requestType).at(-1);
    return Boolean(found);
  }, { timeout: 15_000 }).toBe(true);
  return found!.oobLink;
}
// Sign-up creates the profile twice at once (accountRegistration's transaction and authContext's first-load
// profile). The loser's commit gets 409 already-exists and Firestore retries the transaction as an update,
// so the profile ends up complete. The browser still logs that one 409; anything else is a real error.
const realErrors = (errors: string[]) => errors.filter(e => !e.includes('status of 409 (Conflict)'));
const newEmail = (tag: string) => `qa-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@wmsu.edu.ph`;

async function signUp(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /sign in to arenahub/i }).first().click();
  await page.getByRole('tab', { name: 'Sign up' }).click();
  // Every field the player must fill in is marked with a red asterisk.
  await expect(page.locator('.auth-flow-form .required-mark')).toHaveCount(5);
  await page.getByLabel('First name').fill('QA');
  await page.getByLabel('Last name').fill('Verify');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(QA_PASSWORD);
  await page.getByLabel('Confirm password').fill(QA_PASSWORD);
  await page.locator('button.auth-submit').click();
}

test('sign-up: the emailed link verifies the account and ArenaHub opens by itself', async ({ page, context }) => {
  const errors = watchErrors(page);
  const email = newEmail('verify');
  await signUp(page, email);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 20_000 });

  const link = await linkFor(email, 'VERIFY_EMAIL');
  const back = new URL(new URL(link).searchParams.get('continueUrl') || '');
  expect(back.searchParams.get('account'), 'the email links back to ArenaHub').toBe('verified');

  // The player clicks the link somewhere else (another tab, or their phone).
  const inbox = await context.newPage();
  await inbox.goto(link);
  await inbox.close();

  // Without pressing anything, the waiting page notices and lets them in.
  await page.bringToFront();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toHaveCount(0, { timeout: 20_000 });
  expect(realErrors(errors)).toEqual([]);
});

test('password reset: the email links back to sign-in with a clear message', async ({ page }) => {
  const errors = watchErrors(page);
  const email = newEmail('reset');
  await signUp(page, email);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Use a different account' }).click();

  await page.getByRole('button', { name: /sign in to arenahub/i }).first().click();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.locator('button.auth-submit').click();
  await expect(page.getByText('you’ll receive a password reset link')).toBeVisible();

  const link = await linkFor(email, 'PASSWORD_RESET');
  const back = new URL(new URL(link).searchParams.get('continueUrl') || '');
  expect(back.searchParams.get('account')).toBe('password-reset');

  // "Continue" on the reset page returns here: sign-in opens with the message, and a refresh does not repeat it.
  await page.goto(back.pathname + back.search);
  await expect(page.getByText('Your password was changed. Sign in with your new password.')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('account')).toBe(false);
  expect(realErrors(errors)).toEqual([]);
});
