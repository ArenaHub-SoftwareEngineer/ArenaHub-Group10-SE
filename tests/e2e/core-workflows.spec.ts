import { expect, test } from '@playwright/test';
import { ORGANIZER, STUDENT, signIn } from './helpers';

test('Fair Play evidence reaches staff, the decision reaches its reporter and their inbox', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'Two accounts; the reporter also exercises the mobile layout.');
  test.setTimeout(90_000);
  const reporterContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const staffContext = await browser.newContext();
  try {
    const reporter = await reporterContext.newPage();
    const staff = await staffContext.newPage();
    await signIn(reporter, STUDENT);
    await reporter.goto('/#/arena/integrity');
    await reporter.getByText('Disputes and appeals', { exact: true }).click();
    await reporter.getByRole('button', { name: /Mobile Legends/ }).first().click();
    const submit = reporter.getByRole('dialog');
    await submit.getByText('Have a screenshot or recording link instead?').click();
    const form = submit.locator('.evidence-link-option form');
    await expect(form.locator('select option')).not.toHaveCount(1);
    await form.locator('select').selectOption({ index: 1 });
    await form.getByLabel('Evidence link').fill('https://youtu.be/P5E3LDzWTRg');
    const marker = `QA evidence ${Date.now()}`;
    await form.getByLabel('Optional note').fill(marker);
    await form.getByRole('button', { name: 'Send evidence' }).click();
    await expect(submit).toContainText('Private evidence review', { timeout: 20_000 });
    const caseText = await submit.locator('.dialog-heading p').textContent();
    const id = caseText!.replace(/^Case /, '').trim();

    await signIn(staff, ORGANIZER);
    await staff.goto(`/#/admin/integrity?case=${encodeURIComponent(id)}`);
    await expect(staff).toHaveURL(`/#/admin/reports?case=${encodeURIComponent(id)}`);
    await expect(staff.getByRole('link', { name: 'Cases', exact: true })).toHaveCount(0);
    const review = staff.getByRole('dialog', { name: 'Private evidence review' });
    await expect(review).toContainText(id, { timeout: 20_000 });
    await review.getByLabel('What did you establish?').fill('QA review completed. No violation established from the submitted clip.');
    await review.getByRole('button', { name: 'Dismiss concern' }).click();
    await expect(review.locator('.operations-status')).toHaveText('dismissed', { timeout: 20_000 });
    await expect(submit.locator('.operations-status')).toHaveText('dismissed', { timeout: 20_000 });
    await expect(submit).toContainText('No violation established');
    await submit.getByRole('button', { name: 'Close dialog' }).click();
    await reporter.getByRole('button', { name: /^Notifications/ }).click();
    await expect(reporter.locator('.notification-popover')).toContainText(/review|decision|dismissed/i, { timeout: 20_000 });
    expect(await reporter.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  } finally {
    await reporterContext.close();
    await staffContext.close();
  }
});
