import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ORGANIZER, STUDENT, signIn, watchErrors } from './helpers';

test('Battle Royale captains check in through the lobby desk and referees confirm every squad', async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const captainContext = await browser.newContext({ viewport: info.project.use.viewport });
  const captain = await captainContext.newPage();
  let fixture: any;
  try {
    await signIn(page, ORGANIZER);
    fixture = await page.evaluate(async () => {
      const servicePath = '/src/lib/firestore.ts', placementPath = '/src/lib/formats/placement.ts', operationsPath = '/src/lib/operationsService.ts';
      const { firestoreService } = await import(servicePath);
      const { createPlacementEvent } = await import(placementPath);
      const operations = await import(operationsPath);
      const previous = firestoreService.getPublishedBrackets().find((item: any) => item.placement) || null;
      const draft = createPlacementEvent({ title: `Lobby desk QA ${Date.now()}`, teams: [{ name: 'Lobby Alpha' }, { name: 'Lobby Bravo' }, { name: 'Lobby Charlie' }], games: 1, config: { pointsTable: [10, 6, 3], killPoints: 1 } });
      await firestoreService.publishBracket(draft, draft.gameName, 'game-codm-br');
      await operations.saveTournamentPolicy({ tournamentId: draft.id, gameId: 'game-codm-br', playersRequired: 4, maxSubstitutes: 0, registrationOpen: true });
      return { previous: previous ? JSON.parse(JSON.stringify(previous)) : null, id: draft.id, teams: draft.placement.teams, matchId: draft.placement.games[0].id };
    });
    await signIn(captain, STUDENT);
    const ids = await captain.evaluate(async fixture => {
      const path = '/src/lib/operationsService.ts', operations = await import(path);
      const ids = [];
      for (const [i, team] of fixture.teams.entries()) ids.push(await operations.submitRegistration({ tournamentId: fixture.id, teamId: team.id, teamName: team.name, gameId: 'game-codm-br', college: 'CCS', players: Array.from({ length: 4 }, (_, j) => ({ name: `Private ${i}-${j}`, ign: `Ace ${i}-${j}`, studentId: `${fixture.id}-s-${i}-${j}`, accountId: `${fixture.id}-a-${i}-${j}`, substitute: false })) }));
      return ids;
    }, fixture);
    await page.evaluate(async ids => {
      const path = '/src/lib/operationsService.ts', operations = await import(path);
      for (const id of ids) {
        await operations.reviewRegistration(id, 'approved', 'Verified the complete squad against school registration records.');
        await operations.reviewRegistration(id, 'locked', 'Locked the verified squad before entering the Battle Royale lobby.');
      }
    }, ids);
    await page.evaluate(() => { location.hash = '#/admin/operations'; });
    await expect(page.getByRole('heading', { name: 'Tournament desk', exact: true })).toBeVisible();
    await page.getByLabel('Published tournament').selectOption(fixture.id);
    await page.getByRole('button', { name: 'Match readiness', exact: true }).click();
    await page.getByRole('button', { name: 'Schedule check-in', exact: true }).click();
    const schedule = page.getByRole('dialog');
    await schedule.getByLabel('Upcoming match').selectOption(fixture.matchId);
    await expect(schedule).toContainText('All 3 participating teams have eligible locked rosters.');
    const phTime = (offset: number) => new Date(Date.now() + 8 * 3600000 + offset).toISOString().slice(0, 16);
    await schedule.getByLabel('Opens (Philippine time)').fill(phTime(-60000));
    await schedule.getByLabel('Deadline (Philippine time)').fill(phTime(600000));
    await schedule.getByRole('button', { name: 'Save check-in window', exact: true }).click();
    await expect(schedule).toHaveCount(0);
    await expect(page.locator('.operations-checkin')).toHaveCount(3);

    await captain.evaluate(() => { location.hash = '#/arena/operations'; });
    await expect(captain.getByRole('heading', { name: 'My team', exact: true })).toBeVisible();
    await captain.getByLabel('Published tournament').selectOption(fixture.id);
    await captain.getByRole('button', { name: 'Check in', exact: true }).click();
    const squad = captain.locator('.operations-checkin').filter({ hasText: 'Lobby Charlie' });
    await squad.getByRole('button', { name: 'Check in', exact: true }).click();
    const lineup = captain.getByRole('dialog');
    await expect(lineup.getByRole('combobox', { name: /^Match/ })).toHaveValue(fixture.matchId);
    await expect(lineup.getByLabel('Observed account ID')).toHaveCount(4);
    await lineup.getByLabel('Lobby screenshot or recording link').fill('https://youtu.be/qa-br-browser');
    await lineup.getByRole('button', { name: 'Confirm lineup', exact: true }).click();
    await expect(lineup).toHaveCount(0);
    await expect(squad.locator('.operations-status')).toHaveText('pending');

    const staffSquad = page.locator('.operations-checkin').filter({ hasText: 'Lobby Charlie' });
    await staffSquad.getByRole('button', { name: 'View readiness', exact: true }).click();
    const review = page.getByRole('dialog');
    await expect(review).toContainText('No registration discrepancies found.');
    await review.getByLabel('Referee note').fill('Confirmed the four squad players in the lobby against their locked roster.');
    await review.getByRole('button', { name: 'Confirm players', exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(squad.locator('.operations-status')).toHaveText('confirmed');
    const accessibility = await new AxeBuilder({ page: page as never }).include('.operations-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact || ''))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('lobby-readiness.png'), fullPage: true });

    await captain.evaluate(() => { location.hash = '#/arena/integrity'; });
    await captain.getByText('Disputes and appeals', { exact: true }).click();
    await captain.locator('.fairplay-game-grid').getByRole('button', { name: /CODM Battle Royale/ }).click();
    const evidence = captain.getByRole('dialog');
    await expect(evidence.locator('.video-match-label select option', { hasText: '3-squad lobby' })).toHaveCount(1);
    await evidence.getByText('Have a screenshot or recording link instead?').click();
    await evidence.locator('.evidence-link-option select').selectOption(fixture.matchId);
    expect(errors).toEqual([]);
  } finally {
    if (fixture) await page.evaluate(async fixture => {
      const path = '/src/lib/firestore.ts', { firestoreService } = await import(path);
      if (fixture.previous) await firestoreService.restorePublishedBracket(fixture.previous);
      else await firestoreService.unpublishBracket(fixture.id);
    }, fixture);
    await captainContext.close();
  }
});
