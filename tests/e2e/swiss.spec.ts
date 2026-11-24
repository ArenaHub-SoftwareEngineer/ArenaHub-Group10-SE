import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ORGANIZER, STUDENT, scheduleDraft, signIn, watchErrors } from './helpers';

test('Swiss setup, scoring, publication and viewer standings work at both widths', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await signIn(page, ORGANIZER);
  await page.goto('/#/admin/bracket-studio?new=1');
  await page.getByRole('button', { name: 'Create bracket manually' }).click();
  const setup = page.getByRole('dialog', { name: 'Create Manual Bracket' });
  const title = `QA Swiss ${info.project.name} ${Date.now()}`;
  await setup.getByLabel('Bracket Name').fill(title);
  await setup.getByRole('button', { name: /^Swiss/ }).click();
  await expect(setup.getByRole('button', { name: /^Swiss/ })).toHaveAttribute('aria-pressed', 'true');
  await setup.getByLabel('Number of Teams').fill('129');
  await expect(setup.getByRole('button', { name: 'Proceed to Preview' })).toBeDisabled();
  await expect(setup.getByRole('status')).toContainText('128');
  await setup.getByLabel('Number of Teams').fill('5');
  const axe = await new AxeBuilder({ page: page as never }).include('[role="dialog"], dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact || '')).map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  await setup.getByRole('button', { name: 'Proceed to Preview' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, Create Bracket' }).click();
  const stages = page.locator('.sb-board');
  await expect(stages).toContainText('Swiss rounds');
  const series = stages.getByLabel('Series format for Round 1');
  await expect(series).toBeEnabled();
  await series.selectOption('Bo1');
  const matches = stages.locator('.sb-card[data-round="1"]');
  await expect(matches).toHaveCount(3);
  // Every real fixture ends in one click; the automatic bye is already complete.
  for (const index of [0, 1]) await matches.nth(index).getByRole('button', { name: /^Increase/ }).first().click();
  await expect(stages.locator('.sb-round-head')).toHaveCount(2);
  await expect(stages).toContainText('Round 3 is drawn');
  await expect(stages.getByLabel('Series format for Round 1')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('swiss-rounds.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  await scheduleDraft(page);
  await page.getByRole('button', { name: 'Publish Bracket', exact: true }).first().click();
  const publish = page.getByRole('dialog', { name: 'Publish Bracket', exact: true });
  await publish.getByRole('button', { name: 'Use a custom game' }).click();
  await publish.getByLabel('Custom game title').fill(`QA Swiss ${info.project.name}`);
  await publish.getByRole('button', { name: 'Publish Bracket', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bracket published' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('dialog', { name: 'Bracket published' }).getByRole('button', { name: /close/i }).click();

  const viewerContext = await browser.newContext({ viewport: info.project.use.viewport });
  try {
    const viewer = await viewerContext.newPage();
    await viewer.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    const viewerErrors = watchErrors(viewer);
    await signIn(viewer, STUDENT);
    await viewer.goto('/#/arena/standings');
    await viewer.getByLabel('Published bracket').selectOption({ label: `QA Swiss ${info.project.name} · ${title}` });
    await expect(viewer.getByRole('columnheader', { name: 'Buchholz' })).toBeVisible();
    await expect(viewer.locator('.published-standings tbody tr')).toHaveCount(5);
    await viewer.getByLabel('Find a team in standings').fill('Team 5');
    await expect(viewer.locator('.published-standings tbody tr')).toHaveCount(1);
    await expect(viewer.locator('.published-standings tbody tr')).toContainText('1–0');
    await viewer.reload();
    await expect(viewer.getByRole('columnheader', { name: 'Buchholz' })).toBeVisible();
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(viewerErrors).toEqual([]);
  } finally { await viewerContext.close(); }
  expect(errors).toEqual([]);
});
