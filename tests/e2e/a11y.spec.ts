// Phase 4.1: an axe scan of every route (WCAG 2.1 A and AA). Serious and critical issues fail the test.
// Moderate and minor ones are printed so they can be worked through, but do not fail it.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ORGANIZER, STUDENT, signIn } from './helpers';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Always include unread-badge contrast, even before any other workflow creates notifications.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
const demoDb = () => getFirestore(getApps().find(app => app.name === 'a11y-demo') || initializeApp({ projectId: 'demo-arenahub' }, 'a11y-demo'));

const ARENA = ['home', 'current-live', 'choose-tournament', 'brackets', 'teams', 'schedule', 'standings', 'leaderboard', 'ai-assistant', 'integrity', 'operations', 'support', 'settings'];
const ADMIN = ['overview', 'users', 'games', 'reports', 'featured', 'bracket-studio', 'battle-royale', 'ai-assistant', 'match-data', 'live-stream', 'integrity', 'match-monitor', 'operations', 'support', 'settings'];

async function scan(page: Page, route: string) {
  await page.evaluate(hash => { window.location.hash = hash; }, route);
  await page.waitForTimeout(600);
  await expect(page.locator('.tab-loading')).toHaveCount(0, { timeout: 20_000 });
  // Sections fade in on arrival (polish.css, about 0.5 s). Contrast is judged on the settled page, not mid-fade.
  await page.waitForFunction(() => document.getAnimations().every(a => !(a as CSSAnimation).animationName?.startsWith('ah-rise') || a.playState !== 'running'), null, { timeout: 5_000 });
  // Embedded YouTube and Facebook players are third-party markup ArenaHub cannot change.
  const result = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe').analyze();
  return result.violations.map(v => ({ route, id: v.id, impact: v.impact || 'unknown', help: v.help, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
}

for (const [who, email, scope, routes] of [['student', STUDENT, 'arena', ARENA], ['organizer', ORGANIZER, 'admin', ADMIN]] as const) {
  test(`axe: every ${scope} route as ${who} has no serious or critical issue`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page, email);
    const accounts = await demoDb().collection('users').where('email', '==', email).limit(1).get();
    expect(accounts.empty).toBe(false);
    const notification = accounts.docs[0].ref.collection('notifications').doc('qa-a11y-unread');
    await notification.set({ kind: 'schedule', title: 'QA accessibility notice', body: 'Unread badge verification.', tab: 'schedule', entityId: '', readAt: null, createdAt: FieldValue.serverTimestamp() });
    await expect(page.locator('.notification-count')).toBeVisible();
    const found = [];
    for (const tab of routes) found.push(...await scan(page, `#/${scope}/${tab}`));
    await notification.delete();
    const blocking = found.filter(v => v.impact === 'serious' || v.impact === 'critical');
    const other = found.filter(v => !blocking.includes(v));
    if (other.length) console.log(`[${testInfo.project.name}] ${scope}: ${other.length} moderate/minor`, JSON.stringify(other.map(v => `${v.route} ${v.id}`)));
    if (blocking.length) console.log('AXE_BLOCKING ' + JSON.stringify(blocking));
    expect(blocking, JSON.stringify(blocking, null, 1)).toEqual([]);
  });
}

test('axe: the signed-out entry page has no serious or critical issue', async ({ page }) => {
  await page.goto('/');
  const result = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
  if (blocking.length) console.log('AXE_BLOCKING ' + JSON.stringify(blocking.map(v => ({ ...v, route: 'entry', impact: 'serious+' }))));
  expect(blocking, JSON.stringify(blocking, null, 1)).toEqual([]);
});
