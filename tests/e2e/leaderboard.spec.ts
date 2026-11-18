import { expect, test } from '@playwright/test';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { STUDENT, signIn, watchErrors } from './helpers';

// Player leaderboard (M10): a past (archived) and a current tournament feed one table, and a newly saved game
// reaches an open viewer without a refresh. Writes its own QA tournaments and removes them afterwards.
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
const admin = () => getFirestore(getApps()[0] || initializeApp({ projectId: 'demo-arenahub' }));
const run = `${Date.now() % 1_000_000}`;
const PAST = `qa-lb-past-${run}`, NOW = `qa-lb-now-${run}`;
const IGN = `QaRiley${run}`;

const team = (id: string, name: string, collegeCode: string) => ({ id, name, collegeId: '', collegeCode, gameId: 'game-mlbb', seed: 1 });
const sheet = (playerId: string, kills: number, deaths: number, assists: number, foe: string) =>
  ({ playerStats: { [playerId]: { kills, deaths, assists, ign: IGN, teamCode: 'CCS' }, [foe]: { kills: 1, deaths: 2, assists: 0, teamCode: 'COE' } }, notes: '' });
function tournament(id: string, status: 'published' | 'archived', games: Record<string, unknown>, score: [number, number]) {
  return {
    id, title: status === 'archived' ? `QA Past Cup ${run}` : `QA Current Cup ${run}`, gameId: 'game-mlbb', gameName: 'Mobile Legends: Bang Bang', gameKey: 'game-mlbb',
    format: 'Single Elimination', matchFormat: 'Bo3', teamsCount: 2, seedingRule: 'Seed', createdAt: '11/18/2026', status, revision: 1, featured: false,
    matches: [{
      id: `${id}-m1`, matchNumber: 'M1', tournamentId: id, gameId: 'game-mlbb', round: 1, roundName: 'Grand Final', bracketType: 'final', matchFormat: 'Bo3',
      status: 'completed', score: { team1Score: score[0], team2Score: score[1] }, winnerId: score[0] > score[1] ? `${id}-a` : `${id}-b`,
      scheduledDate: '2026-11-18', scheduledTime: '13:00', organizerName: 'QA', team1: team(`${id}-a`, 'CCS Alpha', 'CCS'), team2: team(`${id}-b`, 'COE Bravo', 'COE'),
      statGames: games,
    }],
    updatedAt: FieldValue.serverTimestamp(),
  };
}
const roster = (id: string, mine: string) => ({ teams: [
  { ...team(`${id}-a`, 'CCS Alpha', 'CCS'), players: [{ id: mine, ign: IGN, role: 'Jungler', isVerified: true }] },
  { ...team(`${id}-b`, 'COE Bravo', 'COE'), players: [{ id: `${id}-foe`, ign: `QaFoe${run}`, role: 'Roamer', isVerified: true }] },
] });

test.beforeAll(async () => {
  const db = admin();
  // Different player IDs in each tournament, as real registrations produce.
  await db.doc(`tournaments/${PAST}`).set(tournament(PAST, 'archived',
    { 1: sheet(`${PAST}-p0`, 5, 1, 3, `${PAST}-foe`), 2: sheet(`${PAST}-p0`, 2, 2, 4, `${PAST}-foe`) }, [2, 0]));
  await db.doc(`tournaments/${PAST}/public/rosters`).set(roster(PAST, `${PAST}-p0`));
  await db.doc(`tournaments/${NOW}`).set(tournament(NOW, 'published',
    { 1: sheet(`${NOW}-p0`, 3, 1, 1, `${NOW}-foe`) }, [2, 1]));
  await db.doc(`tournaments/${NOW}/public/rosters`).set(roster(NOW, `${NOW}-p0`));
});
test.afterAll(async () => {
  const db = admin();
  for (const id of [PAST, NOW]) { await db.doc(`tournaments/${id}/public/rosters`).delete(); await db.doc(`tournaments/${id}`).delete(); }
});

test('past and current tournaments merge into one player row that updates live', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, STUDENT);
  await page.goto('/#/arena/leaderboard?game=game-mlbb');
  await expect(page.getByRole('heading', { name: 'Player leaderboard' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: IGN });
  // Past: 5/1/3 + 2/2/4. Current: 3/1/1. Total 10/4/8 over 3 games, 2 series won.
  await expect(row).toContainText('10', { timeout: 15_000 });
  // The first cell is the rank, which depends on any other QA players in the emulator.
  const rank = /^([0-9]+|–)$/;
  await expect(row.getByRole('cell')).toHaveText([rank, '3', '2–0', '10', '4', '8', '4.50', '0']);

  // The organizer saves game 3 of the current series while the page is open.
  const ref = admin().doc(`tournaments/${NOW}`);
  const data = (await ref.get()).data()!;
  const matches = data.matches.map((m: any) => ({ ...m, statGames: { ...m.statGames, 2: sheet(`${NOW}-p0`, 4, 0, 2, `${NOW}-foe`), 3: sheet(`${NOW}-p0`, 1, 3, 0, `${NOW}-foe`) } }));
  await ref.update({ matches, revision: data.revision + 1, updatedAt: FieldValue.serverTimestamp() });
  await expect(row.getByRole('cell')).toHaveText([rank, '5', '2–0', '15', '7', '10', '3.57', '0'], { timeout: 5_000 });

  await page.screenshot({ path: `test-results/leaderboard-table-${test.info().project.name}.png`, fullPage: true });
  if (test.info().project.name === 'mobile-375') {
    // On a phone the numbers scroll sideways while the rank and player stay pinned.
    const table = page.getByRole('region', { name: /leaderboard table/i });
    await table.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await expect(row.getByRole('button', { name: new RegExp(IGN) })).toBeInViewport();
    await expect(row.getByRole('cell').nth(7)).toBeInViewport();
    await page.screenshot({ path: 'test-results/leaderboard-table-mobile-scrolled.png' });
  }

  // The breakdown shows where each number came from.
  await row.getByRole('button', { name: new RegExp(IGN) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`QA Past Cup ${run}`);
  await expect(dialog).toContainText(`QA Current Cup ${run}`);
  await expect(dialog).toContainText('3 games: 8/4/3');
  await expect(dialog).toContainText('2 games: 7/3/7');
  await page.screenshot({ path: `test-results/leaderboard-${test.info().project.name}.png`, fullPage: true });

  // The match page agrees: series totals by default, one game on request (3/1/1, 4/0/2, 1/3/0).
  await page.goto(`/#/arena/live?match=${NOW}-m1`);
  const statsRow = page.getByRole('row').filter({ hasText: IGN });
  await expect(page.getByText(/Series totals · 3 games with stats/)).toBeVisible({ timeout: 15_000 });
  await expect(statsRow.getByRole('cell').nth(3)).toHaveText('8');
  await expect(statsRow.getByRole('cell').nth(4)).toHaveText('4');
  await expect(statsRow.getByRole('cell').nth(5)).toHaveText('3');
  await page.getByRole('tab', { name: 'Game 2' }).click();
  await expect(page.getByText('Game 2 only')).toBeVisible();
  await expect(statsRow.getByRole('cell').nth(3)).toHaveText('4');
  await page.screenshot({ path: `test-results/match-stats-${test.info().project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});
