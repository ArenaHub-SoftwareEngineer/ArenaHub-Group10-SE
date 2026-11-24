import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mlbbPrompt, mlbbPairs } from '../bracket-prompt-fixture';
import { ORGANIZER, STUDENT, signIn } from './helpers';

test('the MLBB prompt keeps its matchups and carries a team image into the published canvas and PNG', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'The editor opens on desktop and the viewer is checked on mobile.');
  test.setTimeout(150_000);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await signIn(page, ORGANIZER);
  await page.goto('/#/admin/bracket-studio?new=1');
  await page.getByRole('button', { name: 'Prompt', exact: true }).click();
  await page.getByLabel(/Tournament prompt/).fill(mlbbPrompt);
  await page.getByRole('button', { name: 'Generate bracket' }).click();
  const review = page.getByRole('region', { name: 'Check the bracket settings' });
  await expect(review).toContainText('MLBB 16-TEAM BO3 CHAMPIONSHIP', { timeout: 50_000 });
  for (const [left, right] of mlbbPairs) await expect(review).toContainText(`${left} vs ${right}`);
  await review.getByRole('button', { name: 'Build bracket' }).click();
  const board = page.getByRole('region', { name: 'Bracket editor' });
  await expect(board.locator('.sb-card')).toHaveCount(15);
  await expect(board.locator('.sb-card-head').filter({ hasText: 'BO3' })).toHaveCount(15);
  await expect(board.locator('.sb-team .bracket-team-badge svg')).toHaveCount(16);
  for (const [index, pair] of mlbbPairs.entries()) {
    const slots = board.locator(`[data-match="#M${index + 1}"] input.sb-name`);
    await expect(slots.nth(0)).toHaveValue(pair[0]);
    await expect(slots.nth(1)).toHaveValue(pair[1]);
  }

  const openMatch = board.getByRole('button', { name: /^Match 1, .*Open match details/ });
  await openMatch.click();
  const details = page.getByRole('dialog', { name: 'Match details' });
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#18FFAC';
    context.fillRect(0, 0, 160, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const picture = { name: 'lag-spike.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  const upload = details.getByLabel('Upload image for Lag Spike');
  const name = details.getByRole('textbox', { name: 'Team 1 name' });
  expect((await upload.boundingBox())!.x).toBeLessThan((await name.boundingBox())!.x);
  await upload.setInputFiles(picture);
  await expect(details.getByLabel('Replace image for Lag Spike')).toBeAttached();
  await details.getByRole('button', { name: 'Remove image for Lag Spike' }).click();
  await expect(upload).toBeAttached();
  await upload.setInputFiles(picture);
  await expect(details.getByLabel('Replace image for Lag Spike')).toBeAttached();
  await details.getByRole('button', { name: 'Cancel' }).click();
  await expect(board.locator('[data-match="#M1"] .bracket-team-badge img')).toHaveCount(0);
  await openMatch.click();
  await upload.setInputFiles(picture);
  await expect(details.getByLabel('Replace image for Lag Spike')).toBeAttached();
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, Save Changes' }).click();
  const firstBadge = board.locator('[data-match="#M1"] .bracket-team-badge img');
  await expect(firstBadge).toBeVisible();
  expect(await firstBadge.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === image.naturalHeight)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('studio-team-badge.png') });

  const downloading = page.waitForEvent('download');
  await board.getByRole('button', { name: 'Save image' }).click();
  const download = await downloading;
  const file = await readFile((await download.path())!);
  expect(file.subarray(1, 4).toString()).toBe('PNG');
  expect(file.readUInt32BE(16) * 9).toBe(file.readUInt32BE(20) * 16);
  await download.saveAs(testInfo.outputPath('mlbb-bracket.png'));

  const row = page.locator('.studio-bracket-library-row').filter({ hasText: 'MLBB 16-TEAM BO3 CHAMPIONSHIP' }).first();
  await expect(row).toBeVisible({ timeout: 25_000 });
  const published = await page.evaluate(async () => {
    const servicePath = '/src/lib/firestore.ts', streamPath = '/src/lib/streamSchedule.ts';
    const { firestoreService } = await import(servicePath);
    const { parseStreamSchedule, applyMatchSchedules } = await import(streamPath);
    const saved = firestoreService.getSavedBracketDrafts().find((draft: { title: string }) => draft.title === 'MLBB 16-TEAM BO3 CHAMPIONSHIP');
    if (!saved) throw new Error('The bracket draft was not saved.');
    const updates = parseStreamSchedule('Schedule all matches tomorrow starting at 7 AM every 30 minutes', saved.matches);
    const scheduled = { ...saved, matches: applyMatchSchedules(saved.matches, updates) };
    const published = await firestoreService.publishBracket(scheduled, `QA artwork ${Date.now()}`, 'game-custom');
    return published.id as string;
  });
  const viewer = await browser.newPage({ viewport: { width: 390, height: 844 }, baseURL: testInfo.project.use.baseURL });
  try {
    await signIn(viewer, STUDENT);
    await viewer.goto(`/#/arena/brackets?bracket=${published}`);
    const canvas = viewer.locator('.bracket-canvas');
    await expect(canvas).toHaveAttribute('data-bracket-theme', 'navy-gold', { timeout: 25_000 });
    await expect(canvas.locator('.viewer-bracket-match').filter({ hasText: 'Lag Spike' }).locator('img')).toBeVisible();
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  } finally {
    await viewer.close();
    await page.evaluate(async id => {
      const servicePath = '/src/lib/firestore.ts';
      const { firestoreService } = await import(servicePath);
      await firestoreService.unpublishBracket(id);
      await firestoreService.deleteSavedBracketDraft(id);
    }, published);
  }
});
