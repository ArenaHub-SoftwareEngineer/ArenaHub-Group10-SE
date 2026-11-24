import { expect, test } from '@playwright/test';
import { ORGANIZER, QA_PASSWORD, signIn } from './helpers';

// Needs a LiveKit media server, for example `livekit-server --dev` with
// LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret (see docs/LIVE_SCREENS.md).
test.skip(!process.env.LIVEKIT_URL, 'Live screens need a LiveKit server (LIVEKIT_URL).');

test('players share their screens over WebRTC; staff choose game and match, watch, spotlight and pause', async ({ page, browser, request }, info) => {
  test.setTimeout(150_000);
  const login = await request.post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', { data: { email: ORGANIZER, password: QA_PASSWORD, returnSecureToken: true } });
  const headers = { Authorization: 'Bearer ' + (await login.json()).idToken };
  const label = 'POV test ' + Date.now();
  const room = await (await request.post('/api/integrity/rooms', { headers, data: { testRoom: true, label } })).json();
  const capture = await browser.newContext();
  try {
    // Players publish only a generated test pattern. The real desktop never enters the test.
    await capture.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext('2d')!;
        const stream = canvas.captureStream(15);
        let frame = 0;
        const draw = window.setInterval(() => { ctx.fillStyle = frame % 2 ? '#307c61' : '#2f5f8c'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = 'white'; ctx.font = '32px sans-serif'; ctx.fillText('Game QA ' + frame++, 20, 60); }, 66);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(draw));
        return stream;
      } });
    });
    const players = [];
    for (const [name, device, game] of [['Player Alpha', 'pc', 'dota2'], ['Player Bravo', 'android', 'mlbb']] as const) {
      const join = await capture.newPage();
      await join.goto(new URL('/join.html', info.project.use.baseURL).href);
      await join.getByLabel('Room code').fill(room.code);
      await join.getByRole('button', { name: 'Continue', exact: true }).click();
      await join.locator(`#devices button[data-value="${device}"]`).click();
      await join.locator(`#games button[data-value="${game}"]`).click();
      await join.locator('#name').fill(name);
      await join.getByRole('button', { name: 'Join and start my scan' }).click();
      const opened = capture.waitForEvent('page');
      await join.getByRole('link', { name: 'Open screen sharing' }).click();
      const pov = await opened;
      await expect(pov.locator('#identity')).toContainText(name);
      await pov.getByRole('button', { name: 'Share my screen' }).click();
      await expect(pov.locator('#status')).toHaveText(/^Sharing (your screen|one)/, { timeout: 20_000 });
      await expect(pov.locator('#preview')).toBeVisible();
      players.push(pov);
    }

    await signIn(page, ORGANIZER);
    await page.goto('/#/admin/match-monitor');
    const wall = page.getByRole('region', { name: 'Live player screens' });
    await expect(page.getByRole('tab', { name: 'Live screens' })).toHaveAttribute('aria-selected', 'true');
    // Step 1: game. Step 2: match. A test room is not tied to one game, so it is listed under every game.
    await wall.locator('[data-game="mlbb"]').click();
    await wall.getByRole('button', { name: 'Facilitators' }).first().waitFor();
    const row = wall.getByRole('listitem').filter({ hasText: label });
    await expect(row).toContainText('2 sharing', { timeout: 15_000 });
    await row.getByRole('button', { name: 'Facilitators' }).click();
    await page.getByLabel('Facilitator 1').fill('referee@wmsu.edu.ph');
    await page.getByRole('button', { name: 'Save facilitators' }).click();
    await expect(row).toContainText('referee');
    await wall.screenshot({ path: info.outputPath('choose-match.png') });
    await row.getByRole('button', { name: 'Watch ' + label }).click();

    // Step 3: the wall. Both screens play real WebRTC video, each labelled with the player's name.
    await expect(wall.locator('.lw-tile.is-live')).toHaveCount(2, { timeout: 20_000 });
    for (const name of ['Player Alpha', 'Player Bravo']) {
      const video = wall.getByLabel(name + ' game screen');
      await expect(video).toBeVisible();
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
      await expect(wall.locator(`.lw-tile[data-player="${name}"] .lw-name`)).toContainText(name);
    }
    await expect(wall).toContainText('2 of 2 sharing');
    await wall.screenshot({ path: info.outputPath('wall-grid.png') });

    await wall.getByRole('button', { name: 'Spotlight Player Bravo' }).click();
    await expect(wall.locator('.lw-spotlight > .lw-tile[data-player="Player Bravo"]')).toBeVisible();
    await expect(wall.locator('.lw-strip .lw-tile[data-player="Player Alpha"]')).toBeVisible();
    await wall.screenshot({ path: info.outputPath('wall-spotlight.png') });
    await wall.getByRole('button', { name: 'Grid', exact: true }).click();
    await expect(wall.locator('.lw-grid .lw-tile')).toHaveCount(2);

    await wall.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(wall.getByRole('button', { name: 'Exit full screen', exact: true })).toBeVisible();
    await wall.getByRole('button', { name: 'Exit full screen', exact: true }).click();

    // The referee pause reaches every player's sharing page.
    await wall.getByRole('button', { name: 'Pause match' }).click();
    await page.getByLabel('Reason players see (optional)').fill('Checking a screen');
    await page.getByRole('dialog').getByRole('button', { name: 'Pause match' }).click();
    await expect(wall.locator('.lw-paused')).toContainText('Match paused');
    for (const pov of players) {
      await expect(pov.locator('#paused')).toBeVisible({ timeout: 10_000 });
      await expect(pov.locator('#paused')).toContainText('Checking a screen');
    }
    await players[1].screenshot({ path: info.outputPath('player-paused.png') });
    await wall.getByRole('button', { name: 'Resume match' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Resume match' }).click();
    await expect(wall.locator('.lw-paused')).toHaveCount(0);
    await expect(players[0].locator('#paused')).toBeHidden({ timeout: 10_000 });

    await players[0].getByRole('button', { name: 'Stop sharing' }).click();
    // A player who stops leaves the room. Rostered matches keep a "Not sharing" seat; this test room has no roster.
    await expect(wall.locator('.lw-tile[data-player="Player Alpha"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(wall.locator('.lw-tile.is-live[data-player="Player Bravo"]')).toHaveCount(1);
    await expect(wall).toContainText('1 of 1 sharing');

    // A scheduled match shows every rostered player, with a "Not sharing" seat until they connect.
    await wall.getByRole('button', { name: 'Matches' }).click();
    const scheduled = wall.getByRole('button', { name: /^Watch Match \d+ · .+ vs / }).first();
    await scheduled.click();
    await expect(wall.locator('.lw-tile.is-offline').first()).toBeVisible({ timeout: 15_000 });
    expect(await wall.locator('.lw-tile').count()).toBeGreaterThanOrEqual(4);
    await expect(wall.locator('.lw-tile.is-offline').first()).toContainText('Not sharing');
    await wall.screenshot({ path: info.outputPath('wall-roster.png') });
  } finally {
    await capture.close();
    await request.post('/api/integrity/rooms/' + room.id + '/close', { headers, data: {} });
  }
});
