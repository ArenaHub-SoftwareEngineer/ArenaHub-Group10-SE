import { expect, test } from '@playwright/test';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { STUDENT, signIn, watchErrors } from './helpers';

// Uses the DEMO tournaments loaded by scripts/seed-demo.ts (npm run test:e2e loads them first).
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
const admin = () => getFirestore(getApps()[0] || initializeApp({ projectId: 'demo-arenahub' }));

test('student home lists published DEMO tournaments from the new collections', async ({ page }, info) => {
  const errors = watchErrors(page);
  await signIn(page, STUDENT);
  await expect(page.getByText(/DEMO Dota 2 Cup/).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `test-results/home-${info.project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('an organizer change reaches an open bracket viewer within 2 seconds', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-1440', 'one viewer is enough for the propagation check');
  await signIn(page, STUDENT);
  await page.getByText(/DEMO Dota 2 Cup/).first().click();
  const db = admin();
  const snapshot = (await db.collection('tournaments').where('status', '==', 'published').get()).docs.find(d => d.data().title === 'DEMO Dota 2 Cup')!;
  const data = snapshot.data();
  const index = data.matches.findIndex((m: any) => m.team1 && !m.team1.isBye && m.team2 && !m.team2.isBye);
  const original = data.matches[index].team1.name;
  await expect(page.getByText(original).first()).toBeVisible({ timeout: 15_000 });
  const marker = `DEMO Renamed ${Date.now() % 100000}`;
  const rename = (name: string) => JSON.parse(JSON.stringify(data.matches.map((m: any) => ({ ...m, team1: m.team1?.name === original ? { ...m.team1, name } : m.team1, team2: m.team2?.name === original ? { ...m.team2, name } : m.team2 }))));
  const started = Date.now();
  await snapshot.ref.update({ matches: rename(marker), revision: data.revision + 1, updatedAt: FieldValue.serverTimestamp() });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 2_000 });
  const elapsed = Date.now() - started;
  console.log(`Viewer received the change in ${elapsed} ms`);
  expect(elapsed).toBeLessThan(2_000);
  await snapshot.ref.update({ matches: rename(original), revision: data.revision + 2, updatedAt: FieldValue.serverTimestamp() });
});
