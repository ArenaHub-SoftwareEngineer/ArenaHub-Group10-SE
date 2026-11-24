import { expect, test } from '@playwright/test';
import { ORGANIZER, STUDENT, signIn, watchErrors } from './helpers';

test('scheduling a match: type or pick the start and end time, with the typical length as a hint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Bracket Studio is an organizer desktop tool; the phone layout is checked by resizing below.');
  test.setTimeout(120_000);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const errors = watchErrors(page);
  await signIn(page, ORGANIZER);
  await page.goto('/#/admin/bracket-studio?new=1');
  const builder = page.locator('details.studio-builder').filter({ has: page.locator('summary', { hasText: 'Build settings' }) });
  if (!(await builder.evaluate(el => (el as HTMLDetailsElement).open))) await builder.locator('summary').click();
  await page.getByRole('button', { name: 'Prompt', exact: true }).click();
  await page.getByLabel(/Tournament prompt/).fill('Create a seeded 4-team single-elimination Mobile Legends bracket with Bo3 matches. Schedule Match 3 on 2026-12-04 at 1 PM.');
  await page.getByRole('button', { name: 'Generate bracket' }).click();
  const settings = page.getByRole('region', { name: 'Check the bracket settings' });
  await expect(settings).toContainText('Bo3', { timeout: 30_000 });
  await settings.getByRole('button', { name: 'Build bracket' }).click();
  await expect(page.getByRole('heading', { name: /Single elimination/ })).toBeVisible({ timeout: 30_000 });

  await page.locator('details.studio-builder summary', { hasText: 'Draft schedule' }).click();
  await page.getByRole('button', { name: /December 4, 2026, 1 scheduled/ }).click();
  const dialog = page.getByRole('dialog', { name: 'December 4, 2026' });
  const unscheduled = dialog.getByLabel('Unscheduled matches');
  const optionFor = (number: number) => unscheduled.locator('option').filter({ hasText: new RegExp(`^Match ${number}\\b`) });
  await expect(dialog.getByRole('button', { name: 'Edit schedule for Match 3' })).toBeVisible();
  await unscheduled.selectOption((await optionFor(1).getAttribute('value'))!);
  const start = dialog.getByRole('combobox', { name: 'Start time' });
  const end = dialog.getByRole('combobox', { name: 'End time' });
  const note = dialog.locator('.match-estimate');

  // Typing the start fills the end with the typical length; the note explains it.
  await start.fill('8pm');
  await start.blur();
  await expect(start).toHaveValue('8:00 PM');
  await expect(end).toHaveValue('9:20 PM');
  await expect(note).toContainText('A typical Bo3 Mobile Legends takes 50 min to 1 h 20 min');
  await expect(note).toContainText('2 or 3 games of about 20 min, 10 min between games');

  // The list opens from the box and the arrow keys; on a phone it opens upward and stays on screen.
  const list = dialog.getByRole('listbox', { name: 'Times' });
  await page.setViewportSize({ width: 390, height: 844 });
  await start.click();
  await expect(list).toBeVisible();
  const box = await list.boundingBox();
  expect(box!.y + box!.height, 'the time list fits on a phone screen').toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath('schedule-time-phone.png') });
  await start.press('Escape');
  await expect(list).toBeHidden();
  await expect(dialog, 'Escape closes the list, not the dialog').toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await start.click();
  await expect(list.getByRole('option', { name: '8:00 PM' })).toHaveAttribute('aria-selected', 'true');
  await list.getByRole('option', { name: '8:30 PM' }).click();
  await expect(list).toBeHidden();
  await expect(start).toHaveValue('8:30 PM');
  await expect(end, 'an end the organizer has not touched follows the start').toHaveValue('9:50 PM');
  // The first ArrowDown opens the list on the current time, the second moves on.
  await start.press('ArrowDown');
  await start.press('ArrowDown');
  await start.press('Enter');
  await expect(start).toHaveValue('9:00 PM');

  // Typing narrows the list instead of covering the dialog with every time of day.
  await start.fill('7:3');
  await expect(list.getByRole('option')).toHaveText(['7:30 AM', '7:30 PM']);
  await start.fill('7:30 pm');
  await expect(list.getByRole('option')).toHaveText(['7:30 PM']);
  await start.blur();
  await expect(end).toHaveValue('8:50 PM');

  // The organizer's own end time wins and stays put when the start moves.
  await end.fill('9pm');
  await end.blur();
  await expect(end).toHaveValue('9:00 PM');
  await expect(dialog.getByRole('button', { name: 'Use 8:50 PM as the end time' })).toBeVisible();
  // An end before the start is caught before saving; a short slot gets a note.
  await end.fill('7pm');
  await expect(dialog.getByRole('alert')).toContainText('The end time must be later than the start time.');
  await end.fill('8:10 pm');
  await expect(note).toContainText('Your end time leaves 40 min, less than this match usually needs.');
  await end.fill('9:00 PM');
  await end.blur();
  await start.fill('25:99');
  await start.blur();
  await expect(dialog.getByRole('alert')).toContainText('Use a time such as 7:30 PM or 19:30.');
  await start.fill('7:30 pm');
  await start.blur();
  await expect(end).toHaveValue('9:00 PM');
  await page.screenshot({ path: testInfo.outputPath('schedule-time-desktop.png') });
  await dialog.getByRole('button', { name: 'Save to draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Match scheduled for' })).toContainText('7:30 to 9:00 PM Manila time');

  // Opening the match again brings back both times; a second match at an overlapping time is pointed out, not blocked.
  await dialog.getByRole('button', { name: 'Edit schedule for Match 1' }).click();
  await expect(start).toHaveValue('7:30 PM');
  await expect(end).toHaveValue('9:00 PM');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(optionFor(1)).toHaveCount(0);
  await unscheduled.selectOption((await optionFor(2).getAttribute('value'))!);
  await start.fill('8:30pm');
  await start.blur();
  await expect(end, 'the second match gets its own end time').toHaveValue('9:50 PM');
  await expect(dialog.locator('.match-estimate-clash')).toContainText('Runs at the same time as Match 1 (7:30 to 9:00 PM)');
  await page.screenshot({ path: testInfo.outputPath('schedule-time-clash.png') });
  await dialog.getByRole('button', { name: 'Save to draft' }).click();
  await page.getByRole('button', { name: 'Remove schedule for Match 1' }).click();
  await expect(page.getByRole('button', { name: 'Remove schedule for Match 2' })).toBeVisible();
  await expect(optionFor(1)).toHaveCount(1);
  await expect(optionFor(2)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('draft calendar dates open the generated schedule and let organizers add, move, and remove a match', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'The draft date dialog is also checked at phone width in this test.');
  page.setDefaultTimeout(15_000);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await signIn(page, ORGANIZER);
  await page.goto('/#/admin/bracket-studio?new=1');
  const builder = page.locator('details.studio-builder').filter({ has: page.locator('summary', { hasText: 'Build settings' }) });
  if (!(await builder.evaluate(el => (el as HTMLDetailsElement).open))) await builder.locator('summary').click();
  await page.getByRole('button', { name: 'Prompt', exact: true }).click();
  await page.getByLabel(/Tournament prompt/).fill('Create a seeded 4-team single-elimination MLBB bracket. Schedule Match 3 on 2027-01-08 at 1 PM.');
  await page.getByRole('button', { name: 'Generate bracket' }).click();
  await page.getByRole('button', { name: 'Build bracket' }).click({ timeout: 30_000 });
  await page.locator('details.schedule-section summary').first().click();

  const calendar = page.getByRole('group', { name: 'January 2027' });
  const generatedDate = calendar.getByRole('button', { name: 'Friday, January 8, 2027, 1 scheduled', exact: true });
  const emptyDate = calendar.getByRole('button', { name: 'Saturday, January 9, 2027', exact: true });
  await expect(generatedDate).toBeVisible();
  await expect(page.getByLabel('Draft match dates')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit schedule for/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await emptyDate.click();
  const day = page.getByRole('dialog', { name: 'January 9, 2027', exact: true });
  const agenda = day.getByRole('region', { name: 'Scheduled matches' });
  const unscheduled = day.getByLabel('Unscheduled matches');
  await expect(agenda).toContainText('No matches on this date.');
  const matchId = await unscheduled.locator('option').filter({ hasText: /^Match 1\b/ }).getAttribute('value');
  await unscheduled.selectOption(matchId!);
  await expect(day.getByLabel(/^Date/)).toHaveValue('2027-01-09');
  await day.getByRole('combobox', { name: 'Start time' }).fill('9:00 AM');
  await day.getByRole('button', { name: 'Save to draft' }).click();
  await expect(agenda).toContainText('9:00');
  await expect(unscheduled.locator('option').filter({ hasText: /^Match 1\b/ })).toHaveCount(0);

  await day.getByRole('button', { name: 'Edit schedule for Match 1' }).click();
  await day.getByLabel(/^Date/).fill('2027-01-08');
  await day.getByRole('combobox', { name: 'Start time' }).fill('10:00 AM');
  await day.getByRole('button', { name: 'Save to draft' }).click();
  const destination = page.getByRole('dialog', { name: 'January 8, 2027', exact: true });
  const destinationAgenda = destination.getByRole('region', { name: 'Scheduled matches' });
  await expect(destinationAgenda.locator('.schedule-entry')).toHaveCount(2);
  await expect(destinationAgenda.locator('.schedule-entry').first()).toContainText('10:00');
  await expect(destinationAgenda.getByRole('button', { name: 'Edit schedule for Match 3' })).toBeVisible();
  await destination.getByRole('button', { name: 'Close dialog' }).click();
  const populatedDate = calendar.getByRole('button', { name: 'Friday, January 8, 2027, 2 scheduled', exact: true });
  const slots = populatedDate.locator('.schedule-slot');
  await expect(slots.locator('.schedule-slot-compact').first()).toBeVisible();
  await expect(slots.locator('.schedule-slot-compact')).toHaveText(['10:00', '13:00']);
  const colors = await slots.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  expect(new Set(colors).size).toBe(2);
  await populatedDate.click();
  await destinationAgenda.getByRole('button', { name: 'Remove schedule for Match 1' }).click();
  await expect(destination.getByLabel('Unscheduled matches').locator('option').filter({ hasText: /^Match 1\b/ })).toHaveCount(1);
  await expect(destinationAgenda.locator('.schedule-entry')).toHaveCount(1);
  await destination.getByRole('button', { name: 'Close dialog' }).click();
  await expect(generatedDate).toBeVisible();
  await expect(emptyDate).toBeVisible();
  const bracket = page.getByRole('region', { name: 'Bracket editor' });
  await expect(bracket.locator('[data-match="#M1"] .bracket-match-time')).toHaveText('Schedule pending');
  await expect(bracket.locator('[data-match="#M3"] .bracket-match-time')).toHaveText('2027-01-08 · 13:00');
});

test('published schedule lets staff make changes and spectators open read-only dates', async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  await signIn(page, ORGANIZER);
  const fixture = await page.evaluate(async () => {
    const calendarPath = '/src/lib/calendar.ts';
    const bracketPath = '/src/lib/bracketUtils.ts';
    const storePath = '/src/lib/data/tournamentStore.ts';
    const { manilaToday } = await import(calendarPath);
    const { createBracketFromTeams } = await import(bracketPath);
    const { publishTournament } = await import(storePath);
    const today = manilaToday();
    const next = new Date(today + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const tomorrow = next.toISOString().slice(0, 10);
    const game = `QA schedule game ${Date.now()}`;
    const bracket = createBracketFromTeams({
      title: `QA schedule ${Date.now()}`, teams: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map(name => ({ name })),
      matchFormat: 'Bo1', finalMatchFormat: 'Bo1',
    });
    bracket.matches[0].scheduledDate = today;
    bracket.matches[0].scheduledTime = '09:00';
    await publishTournament({ ...bracket, gameName: game, gameId: 'game-custom', status: 'published' });
    return { id: bracket.id, game, today, tomorrow, matchId: bracket.matches[1].id };
  });
  const dateLabel = (date: string) => new Intl.DateTimeFormat('en', { month:'long', day:'numeric', year:'numeric', timeZone:'UTC' }).format(new Date(date + 'T00:00:00Z'));
  await page.goto('/#/admin/schedule');
  try {
    const games = page.getByRole('group', { name: 'Schedule games' });
    await expect(games.getByRole('button', { name: /Dota 2/ }).locator('img')).toBeVisible();
    await games.getByRole('button', { name: new RegExp(fixture.game) }).click();
    const calendar = page.getByRole('region', { name: 'Manage match schedule' });
    await expect(calendar.getByText('2 unscheduled', { exact: true })).toBeVisible();
    const layout = await calendar.evaluate(panel => ({
      panel: panel.getBoundingClientRect().width,
      page: panel.closest('.schedule-page')!.getBoundingClientRect().width,
      day: panel.querySelector('.draft-calendar-day')!.getBoundingClientRect().height,
      desktop: window.innerWidth >= 1000,
    }));
    expect(layout.panel).toBeCloseTo(layout.page, 0);
    expect(layout.day).toBeGreaterThanOrEqual(layout.desktop ? 108 : 56);
    await expect(page.getByLabel('Published match dates')).toHaveCount(0);

    await calendar.getByRole('button', { name: new RegExp(dateLabel(fixture.today)) }).click();
    let day = page.getByRole('dialog', { name: dateLabel(fixture.today), exact: true });
    let unscheduled = day.getByLabel('Unscheduled matches');
    await expect(day.getByRole('button', { name: 'Edit schedule for Match 1' })).toBeVisible();
    await expect(unscheduled.locator('option').filter({ hasText: /Match 1 ·/ })).toHaveCount(0);
    await unscheduled.selectOption(fixture.matchId);
    await day.getByRole('combobox', { name: 'Start time' }).fill('1:00 PM');
    await day.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await expect(day.getByRole('status').filter({ hasText: 'Match scheduled for' })).toBeVisible({ timeout: 20_000 });
    await expect(day.getByRole('button', { name: 'Edit schedule for Match 2' })).toBeVisible();
    await expect(unscheduled.locator(`option[value="${fixture.matchId}"]`)).toHaveCount(0);

    await day.getByRole('button', { name: 'Edit schedule for Match 2' }).click();
    await day.getByLabel(/^Date/).fill(fixture.tomorrow);
    await day.getByRole('combobox', { name: 'Start time' }).fill('10:00 AM');
    await day.getByRole('button', { name: 'Save schedule' }).click();
    day = page.getByRole('dialog', { name: dateLabel(fixture.tomorrow), exact: true });
    await expect(day.getByRole('region', { name: 'Scheduled matches' })).toContainText('10:00', { timeout: 20_000 });
    await expect(day.getByRole('button', { name: 'Edit schedule for Match 1' })).toHaveCount(0);
    await day.getByRole('button', { name: 'Remove schedule for Match 2' }).click();
    unscheduled = day.getByLabel('Unscheduled matches');
    await expect(unscheduled.locator(`option[value="${fixture.matchId}"]`)).toHaveCount(1, { timeout: 20_000 });
    await expect(day.getByRole('region', { name: 'Scheduled matches' })).toContainText('No matches on this date.');
    await day.getByRole('button', { name: 'Close dialog' }).click();
    await page.reload();
    await expect(calendar.getByText('2 unscheduled', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    const viewer = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
    try {
      await signIn(viewer, STUDENT);
      await viewer.goto('/#/arena/schedule');
      await viewer.getByRole('combobox', { name: /^Tournament/ }).selectOption(fixture.id);
      await expect(viewer.getByLabel('Published match dates')).toHaveCount(0);
      const dateButton = viewer.getByRole('button', { name: new RegExp(dateLabel(fixture.today)) });
      await expect(dateButton.locator('.schedule-slot-compact')).toBeVisible();
      await dateButton.click();
      const readOnlyDay = viewer.getByRole('dialog', { name: dateLabel(fixture.today), exact: true });
      await expect(readOnlyDay.getByRole('region', { name: 'Scheduled matches' })).toContainText('Match 1');
      await expect(readOnlyDay.getByRole('button', { name: /edit|remove|save|manage/i })).toHaveCount(0);
      await expect(readOnlyDay.getByLabel('Unscheduled matches')).toHaveCount(0);
      await viewer.goto(`/#/arena/brackets?bracket=${fixture.id}`);
      await viewer.getByRole('button', { name: 'Match schedule', exact: true }).click();
      await dateButton.click();
      await expect(readOnlyDay.getByRole('region', { name: 'Scheduled matches' })).toContainText('Match 1');
      await readOnlyDay.getByRole('button', { name: 'Back to calendar' }).click();
      await expect(dateButton).toBeVisible();
    } finally {
      await viewer.close();
    }
  } finally {
    await page.evaluate(async id => {
      const path = '/src/lib/firestore.ts';
      await (await import(path)).firestoreService.unpublishBracket(id);
    }, fixture.id);
  }
});
