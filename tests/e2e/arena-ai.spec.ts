// Arena AI in a real browser, on the demo-arenahub emulators with the scripted provider
// (vite.config.ts forces it in test mode, so no real model is ever called here).
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { ORGANIZER, QA_PASSWORD, STUDENT, watchErrors } from './helpers';

const contexts: BrowserContext[] = [];
test.afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });

async function open(browser: Browser, email: string, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /sign in to arenahub/i }).first().click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(QA_PASSWORD);
  await page.locator('button.auth-submit').click();
  await expect(page.locator('button.auth-submit')).toHaveCount(0, { timeout: 20_000 });
  return { page, errors };
}
const ours = (errors: string[]) => errors.filter(e => !/Permissions policy violation/.test(e));

test('Arena AI page streams an answer from the server and measures time to first token', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const { page, errors } = await open(browser, STUDENT, testInfo.project.name === 'mobile-375' ? { width: 375, height: 812 } : undefined);
  await page.evaluate(() => { window.location.hash = '#/arena/ai-assistant'; });
  const composer = page.getByLabel('Message Arena AI');
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill('Explain how this works for viewers');
  const reply = page.locator('article.chat-message.from-assistant').last();
  const started = Date.now();
  await page.getByRole('button', { name: 'Send message' }).click();
  // First streamed words, while the answer is still being written.
  await expect(reply.locator('.chat-assistant-text')).toContainText(/Published|No tournament/, { timeout: 20_000 });
  const firstToken = Date.now() - started;
  await expect(reply.locator('.chat-response-actions small')).toHaveText('Arena AI', { timeout: 20_000 });
  const total = Date.now() - started;
  testInfo.annotations.push({ type: 'time to first token', description: `${firstToken} ms (complete answer ${total} ms)` });
  console.log(`[${testInfo.project.name}] Arena AI time to first token: ${firstToken} ms, complete answer: ${total} ms`);
  expect(firstToken).toBeLessThan(total);

  // A live-records question is answered by the engine, labelled as such, with the records it checked.
  await composer.fill('Who plays next?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('article.chat-message.from-assistant').last().locator('.chat-response-actions small')).toHaveText('Live records', { timeout: 20_000 });
  expect(ours(errors)).toEqual([]);
});

test('Arena AI answers about the match the viewer came from and links back to it', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Navigation flow; one width is enough.');
  test.setTimeout(90_000);
  const { page, errors } = await open(browser, STUDENT);
  await page.evaluate(() => { window.location.hash = '#/arena/current-live'; });
  await page.locator('.watch-card.is-live').first().click();
  await expect(page.getByRole('heading', { name: 'Live chat' })).toBeVisible({ timeout: 20_000 });
  const matchHash = await page.evaluate(() => window.location.hash);

  await page.evaluate(() => { window.location.hash = '#/arena/ai-assistant'; });
  const chip = page.locator('.chat-focus');
  await expect(chip).toContainText(/Thinking about: .+ vs .+/, { timeout: 20_000 });
  const matchup = (await chip.locator('strong').textContent())!.trim();

  await page.getByLabel('Message Arena AI').fill("Who's winning?");
  await page.getByRole('button', { name: 'Send message' }).click();
  const reply = page.locator('article.chat-message.from-assistant').last();
  await expect(reply.locator('.chat-response-actions small')).toHaveText('Live records', { timeout: 20_000 });
  await expect(reply.locator('.chat-assistant-text')).toContainText(matchup);

  // The record it checked is a link back to the match.
  await reply.locator('.chat-reference').first().click();
  await expect(page).toHaveURL(new RegExp(matchHash.split('?')[1]?.match(/match=[^&]+/)?.[0] || 'live'));
  await expect(page.getByRole('heading', { name: 'Live chat' })).toBeVisible({ timeout: 20_000 });

  // The viewer can stop asking about that match.
  await page.evaluate(() => { window.location.hash = '#/arena/ai-assistant'; });
  await page.getByRole('button', { name: /Stop asking about/ }).click();
  await expect(chip).toHaveCount(0);
  expect(ours(errors)).toEqual([]);
});

test('viewer A asks @Arena in live chat; viewer B sees the reply with the AI badge', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Two signed-in browsers; the chat panel is the same at both widths.');
  test.setTimeout(120_000);
  const { page: student, errors: studentErrors } = await open(browser, STUDENT);
  await student.evaluate(() => { window.location.hash = '#/arena/current-live'; });
  await student.locator('.watch-card.is-live').first().click();
  await expect(student.getByRole('heading', { name: 'Live chat' })).toBeVisible({ timeout: 20_000 });
  const watchHash = await student.evaluate(() => window.location.hash);

  const { page: staff, errors: staffErrors } = await open(browser, ORGANIZER);
  await staff.evaluate(hash => { window.location.hash = hash; }, watchHash);
  await expect(staff.locator('.watch-chat-staffbar')).toBeVisible({ timeout: 20_000 });
  const before = await staff.locator('.watch-chat-message.is-ai').count();
  // A run that failed midway may have left Arena AI off for this match.
  const toggle = staff.locator('.watch-chat-ai-toggle input');
  if (!(await toggle.isChecked())) await toggle.check();

  await expect(student.getByLabel('Match chat message')).toHaveAttribute('placeholder', /@Arena/, { timeout: 10_000 });
  await student.getByLabel('Match chat message').fill("@Arena what's the score?");
  await student.getByRole('button', { name: 'Send chat message' }).click();

  // The reply is posted by the server, so a different viewer sees it too.
  const reply = staff.locator('.watch-chat-message.is-ai').nth(before);
  await expect(reply).toContainText(/not final|no score is recorded/, { timeout: 30_000 });
  await expect(reply.locator('.watch-chat-badge')).toHaveText('AI');
  await expect(reply.locator('strong')).toHaveText('Arena AI');
  await expect(student.locator('.watch-chat-message.is-ai').nth(before)).toBeVisible();
  // There is no account behind it to mute or remove; staff can pin or delete it.
  await reply.hover();
  await reply.getByRole('button', { name: /Moderate message by Arena AI/ }).click();
  await expect(staff.getByRole('menuitem', { name: 'Delete message' })).toBeVisible();
  await expect(staff.getByRole('menuitem', { name: /minutes/ })).toHaveCount(0);
  await staff.keyboard.press('Escape');

  // Staff can turn Arena AI off for this chat; viewers see the change.
  await toggle.uncheck();
  await expect(student.getByLabel('Match chat message')).toHaveAttribute('placeholder', 'Chat…', { timeout: 10_000 });
  await toggle.check();
  await expect(student.getByLabel('Match chat message')).toHaveAttribute('placeholder', /@Arena/, { timeout: 10_000 });
  expect(ours(studentErrors)).toEqual([]);
  expect(ours(staffErrors)).toEqual([]);
});
