// Phase 2 modules in a real browser: Battle Royale placement scoring and live chat moderation.
// Runs against the demo-arenahub emulators only (npm run test:e2e).
import { expect, test, type Browser } from '@playwright/test';
import { ORGANIZER, QA_PASSWORD, STUDENT, watchErrors } from './helpers';

async function open(browser: Browser, email: string, viewport = { width: 1440, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /sign in to arenahub/i }).first().click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(QA_PASSWORD);
  await page.locator('button.auth-submit').click();
  await expect(page.locator('button.auth-submit')).toHaveCount(0, { timeout: 20_000 });
  return { page, errors };
}
// The YouTube embed reports a permissions-policy message that is not an ArenaHub error.
const ours = (errors: string[]) => errors.filter(e => !/Permissions policy violation/.test(e));

test('organizer runs a Battle Royale lobby and viewers see placement standings', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'One run covers both widths: the viewer checks 375 px itself.');
  test.setTimeout(120_000);
  const title = `E2E BR ${Date.now().toString(36)}`;
  const { page: admin, errors: adminErrors } = await open(browser, ORGANIZER);
  await admin.evaluate(() => { window.location.hash = '#/admin/battle-royale'; });
  await expect(admin.getByRole('heading', { name: /lobby events/i })).toBeVisible({ timeout: 20_000 });
  const newEvent = admin.getByRole('button', { name: 'New event' });
  if (await newEvent.isVisible().catch(() => false)) await newEvent.click();
  await admin.getByLabel(/Event title/).fill(title);
  await admin.getByLabel(/Squads, one per line/).fill(['Byte Brigade, CCS', 'Circuit Breakers, COE', 'Night Owls, CN', 'Chalk Dust, CED'].join('\n'));
  await admin.locator('label', { hasText: /^Games/ }).locator('select').selectOption('3');
  await admin.getByRole('button', { name: /review and publish/i }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Publish event' }).click();
  // The page behind a modal dialog is inert until publishing finishes and the dialog closes.
  await expect(admin.getByText('Battle Royale event published.').first()).toBeVisible({ timeout: 20_000 });
  await expect(admin.getByRole('heading', { name: `${title}: results` })).toBeVisible();

  const enter = async (rows: Array<[string, number, number]>) => {
    for (const [team, place, kills] of rows) {
      await admin.getByLabel(`${team} placement`).fill(String(place));
      await admin.getByLabel(`${team} eliminations`).fill(String(kills));
    }
    await admin.locator('label', { hasText: /^Status/ }).locator('select').selectOption('completed');
  };
  await enter([['Byte Brigade', 2, 7], ['Circuit Breakers', 1, 3], ['Night Owls', 3, 2], ['Chalk Dust', 4, 0]]);
  await admin.getByRole('button', { name: 'Save Game 1' }).click();
  await expect(admin.getByText('Game 1 saved and standings updated.')).toBeVisible({ timeout: 20_000 });

  // Two squads cannot share a placement.
  await enter([['Byte Brigade', 1, 4], ['Circuit Breakers', 1, 2], ['Night Owls', 4, 1], ['Chalk Dust', 3, 5]]);
  await admin.getByRole('button', { name: 'Save Game 2' }).click();
  await expect(admin.locator('.module-error')).toHaveText('Two squads cannot both finish #1.');
  await admin.getByLabel('Circuit Breakers placement').fill('2');
  await admin.getByRole('button', { name: 'Save Game 2' }).click();
  await expect(admin.getByText('Game 2 saved and standings updated.')).toBeVisible({ timeout: 20_000 });

  // 2nd (6) + 1st (10) placement points plus 11 eliminations = 27.
  const leader = admin.locator('.placement-table tbody tr').first();
  await expect(leader).toContainText('Byte Brigade');
  await expect(leader.locator('.total')).toHaveText('27');

  const { page: viewer, errors: viewerErrors } = await open(browser, STUDENT, { width: 375, height: 812 });
  await viewer.evaluate(() => { window.location.hash = '#/arena/choose-tournament'; });
  await viewer.getByText(title).first().click();
  await expect(viewer.getByRole('heading', { name: 'Overall standings' })).toBeVisible({ timeout: 20_000 });
  await expect(viewer.locator('.placement-table tbody tr').first().locator('.total')).toHaveText('27');
  expect(await viewer.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // Unpublish from Bracket Studio: the event leaves the published list only after the cloud write succeeds.
  await admin.evaluate(() => { window.location.hash = '#/admin/bracket-studio'; });
  const library = admin.locator('details.studio-builder').filter({ has: admin.locator('summary', { hasText: 'Live published brackets' }) });
  await library.locator('summary').click();
  const row = library.locator('.studio-bracket-library-row').filter({ hasText: title });
  await row.getByRole('button', { name: 'Unpublish' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Unpublish Bracket' }).click();
  await expect(admin.getByText(`Bracket "${title}" unpublished.`)).toBeVisible({ timeout: 20_000 });
  await expect(row).toHaveCount(0);
  await expect(viewer.getByRole('heading', { name: 'Overall standings' })).toHaveCount(0, { timeout: 20_000 });
  expect(ours(adminErrors)).toEqual([]);
  expect(ours(viewerErrors)).toEqual([]);
});

test('Bracket Studio: prompt draft, mode switch, manual setup, PNG export and publish dialog', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Bracket Studio is an organizer desktop tool.');
  test.setTimeout(90_000);
  const { page, errors } = await open(browser, ORGANIZER);
  await page.evaluate(() => { window.location.hash = '#/admin/bracket-studio'; });
  // Build settings is a <details> that closes once a bracket is on the canvas.
  const builder = page.locator('details.studio-builder').filter({ has: page.locator('summary', { hasText: 'Build settings' }) });
  const openBuilder = async () => { if (!(await builder.evaluate(el => (el as HTMLDetailsElement).open))) await builder.locator('summary').click(); };
  await openBuilder();
  await page.getByRole('button', { name: 'Prompt', exact: true }).click();

  await page.getByLabel(/Tournament prompt/).fill('Create a seeded 6-team single-elimination bracket with Bo3 matches.');
  await page.getByRole('button', { name: 'Generate bracket' }).click();
  await expect(page.getByRole('heading', { name: /Single elimination/ })).toBeVisible({ timeout: 30_000 });
  await openBuilder();
  await expect(page.getByText('Thinking complete')).toBeVisible();
  await expect(page.getByText('Bracket assistant')).toBeVisible();

  // The conversation lives in BracketAIDraft and survives switching build modes.
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await expect(page.getByText('Bracket assistant')).toHaveCount(0);
  // Choosing Manual opens the setup dialog straight away.
  await expect(page.getByRole('dialog', { name: 'Create Manual Bracket' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Prompt', exact: true }).click();
  await expect(page.getByText('Bracket assistant')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save bracket image' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);

  await page.getByRole('button', { name: 'Publish Bracket' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Publish Bracket' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).or(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).first().click();
  await expect(page.getByRole('dialog', { name: 'Publish Bracket' })).toHaveCount(0);
  expect(ours(errors)).toEqual([]);
});

test('staff pin, slow mode, mute and unmute in live chat', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Two signed-in browsers; the chat panel is the same at both widths.');
  test.setTimeout(120_000);
  const { page: student, errors: studentErrors } = await open(browser, STUDENT);
  await student.evaluate(() => { window.location.hash = '#/arena/current-live'; });
  await student.locator('.watch-card.is-live').first().click();
  await expect(student.getByRole('heading', { name: 'Live chat' })).toBeVisible({ timeout: 20_000 });
  const watchHash = await student.evaluate(() => window.location.hash);
  const text = `E2E hello ${Date.now() % 100000}`;
  await student.getByLabel('Match chat message').fill(text);
  await student.getByRole('button', { name: 'Send chat message' }).click();
  await expect(student.locator('.watch-chat-message').filter({ hasText: text })).toBeVisible({ timeout: 10_000 });

  const { page: staff, errors: staffErrors } = await open(browser, ORGANIZER);
  await staff.evaluate(hash => { window.location.hash = hash; }, watchHash);
  await expect(staff.locator('.watch-chat-staffbar')).toBeVisible({ timeout: 20_000 });

  await staff.getByLabel('Match chat message').fill('E2E staff notice');
  await staff.getByRole('button', { name: 'Send chat message' }).click();
  const staffMessage = staff.locator('.watch-chat-message.is-staff').filter({ hasText: 'E2E staff notice' }).last();
  await expect(staffMessage.locator('.watch-chat-badge')).toHaveText('Staff');
  await expect(staffMessage.locator('time')).toHaveText(/\d{1,2}:\d{2}/);

  const target = staff.locator('.watch-chat-message').filter({ hasText: text }).last();
  const moderate = async (item: string) => {
    await target.hover();
    await target.getByRole('button', { name: /Moderate message by/ }).click();
    await staff.getByRole('menuitem', { name: item }).click();
  };
  await moderate('Pin message');
  await expect(student.locator('.watch-chat-pinned')).toContainText(text, { timeout: 10_000 });

  await staff.locator('.watch-chat-staffbar select').selectOption('10');
  await expect(student.locator('.watch-chat-slow')).toHaveText(/Slow mode 10 seconds/, { timeout: 10_000 });

  await moderate('5 minutes');
  await expect(student.locator('.watch-chat-muted')).toContainText(/post again in [45]:\d{2}/, { timeout: 10_000 });
  await expect(student.getByLabel('Match chat message')).toHaveCount(0);
  await staff.locator('.watch-chat-mutes-toggle').click();
  await expect(staff.locator('.watch-chat-mutes')).toContainText('Test Student');

  await staff.locator('.watch-chat-mutes').getByRole('button', { name: 'Lift' }).first().click();
  await expect(student.getByLabel('Match chat message')).toBeVisible({ timeout: 10_000 });

  await staff.locator('.watch-chat-staffbar select').selectOption('0');
  await staff.getByRole('button', { name: 'Unpin message' }).click();
  await expect(student.locator('.watch-chat-pinned')).toHaveCount(0, { timeout: 10_000 });
  expect(ours(studentErrors)).toEqual([]);
  expect(ours(staffErrors)).toEqual([]);
});
