// Online mode: puts the ArenaHub laptop on the internet so players on their own Wi-Fi or mobile data
// can join a match. Free, no account and no domain: it uses a Cloudflare "quick tunnel", which gives a
// new https://<random words>.trycloudflare.com address each time this starts.
//
//   npm run build     (once, after changing the site)
//   npm run online
//
// Only the player pages (join page, device API, downloads, Dota 2 live data) answer on the online
// address; see server/publicAccess.ts. Staff keep using http://localhost:3210 on this laptop.
// Set HOST=0.0.0.0 as well to keep the Wi-Fi addresses working at the same time.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const port = Number(process.env.PORT || 3210);
const tools = join(process.env.LOCALAPPDATA || resolve('.cache'), 'ArenaHubBuild');
const RELEASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

const siteDir = process.env.SITE_DIR || 'dist';
if (!existsSync(resolve(siteDir, 'index.html'))) { console.error(`Build the site first: npm run build (no ${siteDir}/index.html)`); process.exit(1); }

async function cloudflared() {
  if (process.platform !== 'win32') return 'cloudflared'; // install it from Cloudflare's site on macOS or Linux
  const exe = join(tools, 'cloudflared.exe');
  if (existsSync(exe) && statSync(exe).size > 1_000_000) return exe;
  console.log('Downloading cloudflared (Cloudflare\'s free tunnel program, about 60 MB) from GitHub. This happens once.');
  mkdirSync(tools, { recursive: true });
  const response = await fetch(RELEASE, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}). Check the internet connection.`);
  const part = `${exe}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
  renameSync(part, exe);
  return exe;
}

const children = [];
const stopAll = code => { for (const child of children) try { child.kill(); } catch {} process.exit(code); };
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const exe = await cloudflared().catch(error => { console.error(error.message); process.exit(1); });
console.log('Opening the online tunnel...');
const tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(tunnel);

const publicUrl = await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error('Cloudflare did not give an address within 60 seconds. Check the internet connection and try again.')), 60_000);
  const read = chunk => { const found = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (found) { clearTimeout(timer); done(found[0]); } };
  tunnel.stdout.on('data', read); tunnel.stderr.on('data', read);
  tunnel.on('exit', code => { clearTimeout(timer); fail(new Error(`cloudflared stopped (exit ${code}).`)); });
}).catch(error => { console.error(error.message); stopAll(1); });

tunnel.on('exit', code => { console.error(`\nThe online tunnel stopped (exit ${code}). Players can no longer reach this laptop. Run npm run online again and make new QR codes.`); stopAll(1); });

const server = spawn(process.execPath, [resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port), HOST: process.env.HOST || '127.0.0.1', INTEGRITY_PUBLIC_URL: publicUrl },
});
children.push(server);
server.on('exit', code => stopAll(code ?? 1));

console.log(`\nOnline address for players: ${publicUrl}`);
console.log(`Staff page on this laptop:  http://localhost:${port}  (Admin > Match monitor)`);
console.log('QR codes made now use the online address. It changes every time this starts, so make new QR codes after a restart.');
console.log('Keep this window open during matches. Press Ctrl+C to stop.\n');
