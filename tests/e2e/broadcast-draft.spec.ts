import { expect, test } from '@playwright/test';
import { addBroadcastThumbnail, ORGANIZER, signIn } from './helpers';

test('one broadcast link previews automatically and requires a thumbnail before going live', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  await page.route('https://www.youtube.com/embed/**', route => route.fulfill({ body: '' }));
  await page.route(/^https:\/\/www\.facebook\.com\/plugins\/video\.php\?/, route => route.fulfill({ body: '' }));
  await signIn(page, ORGANIZER);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/lib/firestore.ts';
    return (await import(path)).firestoreService.isPublishedLoaded();
  });
  const fixture = await page.evaluate(async () => {
    const bracketsPath = '/src/lib/bracketUtils.ts', storePath = '/src/lib/data/tournamentStore.ts';
    const { createBracketFromTeams } = await import(bracketsPath);
    const gameName = `QA game ${Date.now()}`;
    const draft = createBracketFromTeams({
      title: `Broadcast draft QA ${Date.now()}`, teams: [{ name: 'Draft Alpha' }, { name: 'Draft Bravo' }],
      matchFormat: 'Bo1', finalMatchFormat: 'Bo1',
    });
    // Older published brackets can still go live without a scheduled time.
    await (await import(storePath)).publishTournament({ ...draft, gameName, gameId: 'game-custom', status: 'published' });
    return { id: draft.id as string, gameName };
  });

  try {
    await page.goto('/#/admin/live-stream');
    const games = page.getByRole('group', { name: 'Broadcast games' });
    await expect(games.getByRole('button', { name: /Dota 2/ }).locator('img')).toBeVisible();
    await games.getByRole('button', { name: new RegExp(fixture.gameName) }).click();
    const bracket = page.getByRole('region', { name: /Broadcast draft QA/ });
    await bracket.getByRole('button', { name: /Draft Alpha vs Draft Bravo/ }).click();
    const wizard = page.getByRole('dialog', { name: 'Set up a broadcast' });
    await expect(wizard.getByText(/Schedule pending/)).toBeVisible();
    const url = wizard.getByRole('textbox', { name: /Live link/ });
    const title = wizard.getByRole('textbox', { name: 'Broadcast title' });
    const goLive = wizard.getByRole('button', { name: 'Go live', exact: true });
    const liveUrl = 'https://www.youtube.com/live/m4zQpYzzM0g';
    const iframe = wizard.locator('iframe[src*="youtube.com/embed/m4zQpYzzM0g"]');
    await url.focus();
    await expect(wizard.locator('.bw-url:focus-within')).toBeVisible();
    await expect(url).toHaveCSS('border-top-width', '0px');
    await url.fill(liveUrl);
    await expect(iframe).toBeVisible();
    await expect(goLive).toBeDisabled();
    const firstPlayer = await iframe.elementHandle();
    await title.fill('QA semifinal broadcast');
    await addBroadcastThumbnail(page, wizard);
    await expect(goLive).toBeEnabled();
    expect(await firstPlayer!.evaluate(el => el.isConnected)).toBe(true);
    await url.fill('https://www.youtube.com/watch?v=m4zQpYzzM0g');
    expect(await firstPlayer!.evaluate(el => el.isConnected)).toBe(true);
    await url.fill(liveUrl);
    await expect(wizard.getByRole('button', { name: 'Preview link' })).toHaveCount(0);
    await expect(wizard.getByText('Match platforms', { exact: true })).toHaveCount(0);
    await expect(wizard.getByRole('button', { name: 'Save for later' })).toHaveCount(0);

    await page.goto('/#/admin/match-monitor');
    await expect(page.getByRole('heading', { name: 'Anti-cheat', exact: true })).toBeVisible();
    await page.goBack();
    await expect(url).toHaveValue(liveUrl);
    await page.reload();
    await expect(url).toHaveValue(liveUrl);
    await expect(title).toHaveValue('QA semifinal broadcast');
    await expect(wizard.getByLabel('Replace thumbnail')).toBeAttached();
    await expect(iframe).toBeVisible();

    const discard = wizard.getByRole('button', { name: 'Discard draft' });
    const dialog = page.getByRole('dialog', { name: 'Discard broadcast draft?' });
    await discard.click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(url).toHaveValue(liveUrl);
    await discard.click();
    await dialog.getByRole('button', { name: 'Discard draft' }).click();
    await expect(dialog).toBeHidden();
    await expect(url).toHaveValue('');
    await expect(title).toHaveValue('Draft Alpha vs Draft Bravo');
    await expect(goLive).toBeDisabled();

    await url.fill('https://www.tiktok.com/@arenahub/live');
    await expect(url).toHaveValue('https://www.tiktok.com/@arenahub/live');
    await expect(url).toHaveAttribute('aria-invalid', 'true');
    await expect(wizard.locator('iframe')).toHaveCount(0);
    await url.fill('https://www.facebook.com/FacebookDevelopers/videos/10152454700553553/');
    await expect(wizard.locator('iframe[src*="facebook.com/plugins/video.php"]')).toBeVisible();
    await expect(goLive).toBeDisabled();
    await url.fill(liveUrl);
    await addBroadcastThumbnail(page, wizard);
    await goLive.click();
    await expect(wizard.getByText('Match is on air in ArenaHub.')).toBeVisible({ timeout: 40_000 });
    await expect(wizard.getByText('On air', { exact: true })).toBeVisible();
    const controls = wizard.getByRole('toolbar', { name: 'Broadcast controls' });
    await controls.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('dialog', { name: 'Pause this broadcast?' }).getByRole('button', { name: 'Pause broadcast' }).click();
    await expect(wizard.getByText('Paused', { exact: true })).toBeVisible({ timeout: 30_000 });
    await goLive.click();
    await expect(wizard.getByText('On air', { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: testInfo.outputPath('broadcast-setup.png') });
    await wizard.getByRole('link', { name: 'Viewer page' }).click();
    await expect(page).toHaveURL(/#\/arena\/live/);
    await expect(page.locator('.watch-primary iframe[src*="youtube.com/embed/m4zQpYzzM0g"]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open original' })).toHaveCount(0);
    await page.goBack();
    await expect(wizard).toBeVisible();
    await wizard.getByRole('button', { name: 'Close dialog' }).click();
    await expect(wizard).toBeHidden();

    const surface = page.locator('.bracket-board-viewport');
    const readBoardStyle = () => surface.evaluate(el => {
      const style = getComputedStyle(el);
      return [style.backgroundColor, style.backgroundImage, style.height];
    });
    const broadcastStyle = await readBoardStyle();
    await page.goto('/#/arena/brackets?bracket=' + encodeURIComponent(fixture.id));
    await expect(page.getByRole('heading', { name: /Broadcast draft QA/ })).toBeVisible();
    expect(await readBoardStyle()).toEqual(broadcastStyle);
    await expect(page.locator('.bracket-match-card').first()).toHaveCSS('width', '322px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await surface.screenshot({ path: testInfo.outputPath('published-bracket.png') });
    await page.goto('/#/admin/bracket-studio?editBracket=' + encodeURIComponent(fixture.id));
    await expect(page.getByRole('region', { name: 'Bracket editor' })).toBeVisible();
    expect(await readBoardStyle()).toEqual(broadcastStyle);
    await expect(page.locator('.bracket-match-card').first()).toHaveCSS('width', '322px');
  } finally {
    await page.evaluate(async ({ id }) => {
      const path = '/src/lib/firestore.ts';
      const { firestoreService } = await import(path);
      await firestoreService.unpublishBracket(id);
    }, fixture);
  }
});
