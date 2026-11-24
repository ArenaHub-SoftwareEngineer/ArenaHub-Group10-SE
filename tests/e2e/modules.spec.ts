// Organizer brackets and live chat in a real browser.
// Runs against the demo-arenahub emulators only (npm run test:e2e).
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { ORGANIZER, QA_PASSWORD, STUDENT, scheduleDraft, signIn, watchErrors } from './helpers';

// Every context a test opens is closed after it; leaked signed-in pages keep live listeners and slow later tests.
const contexts: BrowserContext[] = [];
test.afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });

async function open(browser: Browser, email: string, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  const page = await context.newPage();
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
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

test('Bracket Studio redraws the same named teams into different slots', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Bracket Studio is an organizer desktop tool.');
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await signIn(page, ORGANIZER);
  await page.goto('/#/admin/bracket-studio?new=1');
  await page.getByRole('button', { name: 'Prompt', exact: true }).click();
  await page.getByLabel(/Tournament prompt/).fill('Please shuffle a bracket for Iron Owls and Storm Bears.');
  await page.getByRole('button', { name: 'Generate bracket' }).click();
  const settings = page.getByRole('region', { name: 'Check the bracket settings' });
  await expect(settings).toContainText('Iron Owls, Storm Bears');
  await expect(settings).toContainText('Choose when publishing');
  await settings.getByRole('button', { name: 'Build bracket' }).click();
  const slots = page.getByRole('region', { name: 'Bracket editor' }).locator('input.sb-name');
  await expect(slots).toHaveCount(2);
  const sides = await slots.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
  const builder = page.locator('details.studio-build');
  if (!await builder.evaluate(el => (el as HTMLDetailsElement).open)) await builder.locator('summary').click();
  await page.getByRole('button', { name: 'Draw again' }).click();
  await expect(slots.nth(0)).toHaveValue(sides[1]);
  await expect(slots.nth(1)).toHaveValue(sides[0]);
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
  // No game named: Arena AI asks instead of silently choosing one, and builds nothing yet.
  await expect(page.getByText(/Which game is this bracket for/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /Single elimination/ })).toHaveCount(0);
  // One-click answers are offered for the missing game.
  await page.getByRole('group', { name: 'Quick answers' }).getByRole('button', { name: 'Mobile Legends: Bang Bang' }).click();
  // The organizer checks the parsed settings, defaults marked, before building.
  const settings = page.getByRole('region', { name: 'Check the bracket settings' });
  await expect(settings).toContainText('Mobile Legends: Bang Bang', { timeout: 30_000 });
  await expect(settings).toContainText('6 numbered slots');
  await expect(settings).toContainText('Bo5 (default)');
  await settings.getByRole('button', { name: 'Build bracket' }).click();
  await expect(page.getByRole('heading', { name: /Single elimination/ })).toBeVisible({ timeout: 30_000 });
  await openBuilder();
  await expect(page.getByText('Opened it on the canvas below')).toBeVisible();
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
  await page.getByRole('button', { name: 'Save image' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);

  await page.getByRole('button', { name: 'Publish Bracket' }).first().click();
  await expect(page.getByText(/remaining matches before publishing/)).toBeVisible();
  await scheduleDraft(page);
  await page.getByRole('button', { name: 'Publish Bracket' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Publish Bracket' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).or(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).first().click();
  await expect(page.getByRole('dialog', { name: 'Publish Bracket' })).toHaveCount(0);
  expect(ours(errors)).toEqual([]);
});

test('staff can create and publish a new bracket while matches are live', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const viewport = testInfo.project.use.viewport ?? undefined;
  const { page: admin } = await open(browser, ORGANIZER, viewport);
  const game = `QA Brackets ${testInfo.project.name} ${Date.now()}`;
  const liveTitle = `${game} Live`;
  const nextTitle = `${game} Next`;
  const create = async (title: string) => {
    await admin.getByRole('button', { name: 'Create bracket manually' }).click();
    const setup = admin.getByRole('dialog', { name: 'Create Manual Bracket' });
    await setup.getByLabel('Bracket Name').fill(title);
    await setup.getByLabel('Number of Teams').fill('4');
    await setup.getByRole('button', { name: 'Proceed to Preview' }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Yes, Create Bracket' }).click();
  };
  const review = async () => {
    await admin.getByRole('button', { name: 'Publish Bracket', exact: true }).first().click();
    const dialog = admin.getByRole('dialog', { name: 'Publish Bracket', exact: true });
    await dialog.getByRole('button', { name: 'Use a custom game' }).click();
    await dialog.getByLabel('Custom game title').fill(game);
    return dialog;
  };
  const publish = async () => {
    await admin.getByRole('dialog', { name: 'Publish Bracket', exact: true })
      .getByRole('button', { name: 'Publish Bracket', exact: true }).click();
    const success = admin.getByRole('dialog', { name: 'Bracket published' });
    await expect(success).toBeVisible({ timeout: 45_000 });
    await success.getByRole('button', { name: 'Done', exact: true }).click();
  };

  await admin.goto('/#/arena/choose-tournament');
  await admin.getByRole('button', { name: 'Create bracket', exact: true }).click();
  await create(liveTitle);
  await scheduleDraft(admin);
  await admin.locator('.sb-board').getByRole('button', { name: /^Increase/ }).first().click();
  await review();
  await publish();

  const { page: viewer } = await open(browser, STUDENT, viewport);
  await viewer.goto('/#/arena/choose-tournament');
  await expect(viewer.getByRole('button', { name: 'Create bracket', exact: true })).toHaveCount(0);
  await viewer.locator('.stream-game-card').filter({ hasText: liveTitle }).click();
  await expect(viewer.getByRole('button', { name: 'Watch live' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Create bracket', exact: true })).toHaveCount(0);

  await admin.goto(viewer.url());
  await expect(admin.getByRole('button', { name: 'Watch live' })).toBeVisible();
  await admin.getByRole('button', { name: 'Create bracket', exact: true }).click();
  await create(nextTitle);
  await scheduleDraft(admin);
  const reviewDialog = await review();
  await expect(reviewDialog.getByText(`Publishing will replace “${liveTitle}”`, { exact: false })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Watch live' })).toBeVisible();
  await publish();

  await viewer.goto('/#/arena/choose-tournament');
  await expect(viewer.locator('.stream-game-card').filter({ hasText: liveTitle })).toHaveCount(0);
  await viewer.locator('.stream-game-card').filter({ hasText: nextTitle }).click();
  await expect(viewer.getByRole('heading', { name: nextTitle, exact: true })).toBeVisible();
  const library = admin.getByRole('complementary', { name: 'Bracket library' });
  await library.getByRole('tab', { name: /^Versions/ }).click();
  await expect(library.getByText(liveTitle, { exact: true })).toBeVisible();

  await admin.goto(viewer.url());
  await admin.getByRole('button', { name: 'Match schedule' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Manage schedule' }).click();
  const staffCalendar = admin.getByRole('region', { name: 'Manage match schedule' });
  await staffCalendar.getByRole('button', { name: /, \d+ scheduled$/ }).first().click();
  const removeFirst = admin.getByRole('button', { name: 'Remove schedule for Match 1' });
  await removeFirst.click();
  await expect(removeFirst).toHaveCount(0, { timeout: 45_000 });
  await expect(admin.getByRole('button', { name: 'Remove schedule for Match 2' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Match schedule' }).click();
  await viewer.getByRole('dialog', { name: 'Match schedule' }).getByRole('button', { name: /, \d+ scheduled$/ }).first().click();
  const agenda = viewer.getByRole('dialog').getByRole('region', { name: 'Scheduled matches' });
  await expect(agenda.getByText(/^Match 1 ?/)).toHaveCount(0);
  await expect(agenda.getByText(/^Match 2 ?/)).toBeVisible();
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
