// Testing only: fills one live match on the Monitor wall with simulated player screens.
//
//   node scripts/demo-screens.mjs [mlbb|dota2|codm] [--sharing 8]
//       Firebase emulators (seeded with scripts/seed-demo.ts) and a LOCAL LiveKit (LIVEKIT_URL=ws://localhost:7880).
//   node scripts/demo-screens.mjs mlbb --project <id> --confirm-production
//       A real project's seeded demo match (GOOGLE_APPLICATION_CREDENTIALS = its key) and LiveKit Cloud (wss://).
//
// LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET come from the environment. Each simulated player is a
// generated animation with the player's name on it, published as a screen share from one headless browser.
// No real screen is captured. Players beyond --sharing join as "not sharing" seats. Ctrl+C stops them.
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { chromium } from 'playwright';

const url = process.env.LIVEKIT_URL || '', apiKey = process.env.LIVEKIT_API_KEY || '', secret = process.env.LIVEKIT_API_SECRET || '';
const projectFlag = process.argv.indexOf('--project');
const project = projectFlag > 0 && process.argv.includes('--confirm-production') ? process.argv[projectFlag + 1] : '';
if (!(project ? /^wss:\/\//.test(url) : /^ws:\/\/(localhost|127\.0\.0\.1)/.test(url)) || !apiKey || !secret) {
  console.error(project ? 'Set LIVEKIT_URL=wss://<project>.livekit.cloud with its key and secret.' : 'Set LIVEKIT_URL=ws://localhost:7880, LIVEKIT_API_KEY and LIVEKIT_API_SECRET for the local LiveKit server.'); process.exit(1);
}
const game = { mlbb: 'game-mlbb', dota2: 'game-dota2', codm: 'game-codm-mp' }[process.argv[2] || 'mlbb'] || 'game-mlbb';
const sharingArg = process.argv.indexOf('--sharing');
if (project) {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the project service-account key.'); process.exit(1); }
  delete process.env.FIRESTORE_EMULATOR_HOST;
} else process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
initializeApp({ projectId: project || 'demo-arenahub' });
const db = getFirestore();

const published = (await db.collection('tournaments').where('status', '==', 'published').where('gameId', '==', game).get()).docs
  .filter(doc => !project || doc.data().demo === true); // never stream fake players into a real tournament
const tournament = published.map(doc => ({ id: doc.id, ...doc.data() })).find(t => (t.matches || []).some(m => m.status === 'live'));
if (!tournament) { console.error(`No live ${game} match in the emulator. Run scripts/seed-demo.ts first.`); process.exit(1); }
const match = tournament.matches.find(m => m.status === 'live');
const rosters = (await db.doc(`tournaments/${tournament.id}/public/rosters`).get()).data()?.teams || [];
const players = [match.team1, match.team2].flatMap(team => (rosters.find(r => r.id === team.id || r.name === team.name)?.players || team.players || [])
  .map(p => ({ name: (p.ign || p.name || '').trim(), team: team.name }))).filter(p => p.name);
const sharing = Math.min(players.length, sharingArg > 0 ? Number(process.argv[sharingArg + 1]) : players.length - 2);
console.log(`${match.team1.name} vs ${match.team2.name} (${match.id}): ${sharing} of ${players.length} players sharing.`);

const room = 'arenahub-m-' + match.id;
const tokens = await Promise.all(players.slice(0, sharing).map(async (player, index) => {
  const at = new AccessToken(apiKey, secret, { identity: `p-demo-${index}`, name: player.name, ttl: '4h', attributes: { team: player.team, platform: index % 3 === 2 ? 'pc' : 'android', game: game.replace('game-', '') } });
  at.addGrant({ room, roomJoin: true, canPublish: true, canPublishSources: [TrackSource.SCREEN_SHARE], canSubscribe: false, canPublishData: false });
  return { ...player, token: await at.toJwt(), hue: player.team === match.team1.name ? 215 : 22 };
}));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', message => { if (message.type() === 'error') console.error('[browser]', message.text()); });
await page.setContent('<!doctype html><title>Simulated players</title><body></body>');
await page.addScriptTag({ content: readFileSync('public/vendor/livekit-client.umd.js', 'utf8') });
await page.evaluate(async ({ url, tokens }) => {
  const { Room, LocalVideoTrack, Track } = window.LivekitClient;
  // A small animated "game": a dark map, moving units and a HUD with the player's name and a match clock.
  const scene = (name, team, hue, seed) => {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
    const ctx = canvas.getContext('2d'), start = performance.now();
    const units = Array.from({ length: 9 }, (_, i) => ({ x: (seed * 97 + i * 131) % 960, y: (seed * 53 + i * 89) % 540, dx: ((i % 3) - 1) * 1.6 + 0.4, dy: ((i % 2) ? 1 : -1) * 1.1 }));
    setInterval(() => {
      const t = (performance.now() - start) / 1000;
      const sky = ctx.createLinearGradient(0, 0, 960, 540);
      sky.addColorStop(0, `hsl(${hue} 35% 16%)`); sky.addColorStop(1, `hsl(${(hue + 40) % 360} 30% 9%)`);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, 540);
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 40;
      ctx.beginPath(); ctx.moveTo(0, 540); ctx.lineTo(960, 0); ctx.stroke();
      for (const u of units) {
        u.x = (u.x + u.dx + 960) % 960; u.y = (u.y + u.dy + 540) % 540;
        ctx.fillStyle = `hsl(${hue} 80% 60%)`; ctx.beginPath(); ctx.arc(u.x, u.y, 10, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#ff5d5d'; ctx.beginPath(); ctx.arc(480 + Math.cos(t) * 160, 270 + Math.sin(t * 1.3) * 110, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, 960, 52); ctx.fillRect(810, 390, 150, 150);
      ctx.fillStyle = '#fff'; ctx.font = '600 26px system-ui, sans-serif'; ctx.fillText(name, 18, 35);
      ctx.font = '22px system-ui, sans-serif'; ctx.fillStyle = '#c9ccd3'; ctx.fillText(team, 18 + ctx.measureText(name).width * 1.2 + 24, 35);
      const clock = `${String(Math.floor(t / 60) + 7).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      ctx.fillStyle = '#fff'; ctx.font = '600 26px ui-monospace, monospace'; ctx.fillText(clock, 860, 35);
      ctx.fillStyle = `hsl(${hue} 70% 55%)`; ctx.fillRect(820 + (t * 20) % 120, 400 + (t * 13) % 120, 8, 8);
    }, 1000 / 15);
    return canvas.captureStream(15).getVideoTracks()[0];
  };
  let seed = 1;
  for (const player of tokens) {
    const room = new Room();
    await room.connect(url, player.token);
    await room.localParticipant.publishTrack(new LocalVideoTrack(scene(player.name, player.team, player.hue, seed++)), { source: Track.Source.ScreenShare, name: 'screen', simulcast: true });
  }
}, { url, tokens });
console.log('Simulated players are sharing. Open Monitor > Live screens > this match. Ctrl+C to stop.');
const stop = async () => { await browser.close().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await new Promise(() => {});
