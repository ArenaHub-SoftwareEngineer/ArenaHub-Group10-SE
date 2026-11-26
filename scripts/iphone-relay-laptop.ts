// iPhone relay on the organizer's laptop: no cloud server, no card, no domain.
//
//   iPhone (PRISM, Custom RTMP) -> bore tunnel (free, no account) -> this laptop :1935 (MediaMTX)
//   staff wall (any browser)    <- Cloudflare quick tunnel (https) <- this laptop :8890 (small proxy below)
//
// Every 20 s this tells the ArenaHub API where the laptop is (POST /relay/register, signed with
// IPHONE_RELAY_SECRET), because the Cloudflare address changes on every start. Viewer and API passes are checked
// here with the same secret, so video segments do not wait on the API; "may this player publish?" still goes to the
// API, which knows the check-ins. Android and PC screens do not use this: they go through LiveKit Cloud.
//
//   npm run relay:laptop                                 (bore picks a public port each start)
//   npm run relay:laptop -- --rtmp host:port            (your own TCP tunnel instead; --rtmp bore goes back)
//
// Settings: IPHONE_RELAY_SECRET in .env (made on first run; the hosted API needs the same value),
// RELAY_API (default https://arenahub-live.vercel.app), RELAY_WALL_ORIGINS (who may play, comma separated).
import { config } from 'dotenv';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Resolver } from 'node:dns/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createIphoneRelay, relayRegistrationSignature } from '../server/iphoneRelay.ts';

config({ quiet: true } as never);
const API = (process.env.RELAY_API || 'https://arenahub-live.vercel.app').replace(/\/+$/, '') + '/api/integrity';
const ORIGINS = (process.env.RELAY_WALL_ORIGINS || 'https://arenahub-live.vercel.app,https://arenahub-esports.web.app,https://arenahub-esports.firebaseapp.com,http://localhost:5173,http://localhost:3210')
  .split(',').map(origin => origin.trim()).filter(Boolean);
const PORTS = { rtmp: 1935, api: 9997, webrtc: 8889, hls: 8888, media: 8189, front: 8890, auth: 8891, livekit: 7880 };
const tools = join(process.env.LOCALAPPDATA || resolve('.cache'), 'ArenaHubBuild');
const MEDIAMTX_VERSION = 'v1.21.4';
const settingsFile = resolve('data', 'relay-laptop.json');

const say = (line = '') => console.log(line);
// The website's clock minus this laptop's, learned from the Date header of every check-in answer. Check-ins and
// viewer passes are only good for a couple of minutes, so a laptop clock that is a few minutes off would lock
// everyone out; signing and checking with the website's time avoids that.
let skew = 0;
const serverNow = () => Date.now() + skew;
const fail = (line: string): never => { console.error('\n' + line); stopAll(1); throw new Error(line); };

// ---------- Settings ----------
function secret() {
  let value = (process.env.IPHONE_RELAY_SECRET || '').trim();
  if (value.length >= 24) return value;
  value = randomBytes(32).toString('base64url');
  appendFileSync('.env', `\n# iPhone relay (laptop mode). The hosted API (Vercel) needs the same value.\nIPHONE_RELAY_SECRET=${value}\n`);
  say('Made a new IPHONE_RELAY_SECRET in .env. The hosted API needs the same value (Vercel env), then a redeploy.');
  return value;
}

// rtmps:// is kept: a TLS-terminating tunnel (Tailscale Funnel --tls-terminated-tcp) routes only TLS connections,
// so PRISM must use RTMPS there. The tunnel removes TLS and MediaMTX still gets plain RTMP on 127.0.0.1:1935.
function rtmpAddress(raw: string) {
  const value = raw.trim(), secure = /^rtmps:\/\//i.test(value);
  const text = value.replace(/^rtmps?:\/\//i, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+:\d{2,5}$/i.test(text)) return '';
  return (secure ? 'rtmps://' : 'rtmp://') + text;
}

type Settings = { rtmp?: string; turn?: string; web?: string };
const savedSettings = (): Settings => { try { return JSON.parse(readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
function saveSetting(next: Settings) {
  mkdirSync(resolve('data'), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ ...savedSettings(), ...next }, null, 2));
}

/**
 * A fixed address for the iPhones (your own TCP tunnel to 127.0.0.1:1935), or '' to use bore, the default:
 * a free tunnel with no account. `--rtmp host:port` (or rtmps://host:port) saves a fixed address; `--rtmp bore`
 * goes back to bore.
 */
function fixedAddress() {
  const flag = process.argv.indexOf('--rtmp');
  if (flag < 0) return savedSettings().rtmp || '';
  const value = (process.argv[flag + 1] || '').trim();
  const rtmp = value === 'bore' ? '' : rtmpAddress(value);
  if (value !== 'bore' && !rtmp) fail('--rtmp needs host:port (for example something.example.net:12345) or the word bore.');
  saveSetting({ rtmp });
  return rtmp;
}

/**
 * Android/PC video through a TLS-terminating TCP tunnel instead of bore: `--turn host:port` (Tailscale Funnel
 * --tls-terminated-tcp <port> tcp://127.0.0.1:<port>). LiveKit's own TURN server listens on that port without
 * TLS, and players reach it as turns://host:port. `--turn bore` goes back to bore.
 */
function turnSetting() {
  const flag = process.argv.indexOf('--turn');
  if (flag < 0) return savedSettings().turn || '';
  const value = (process.argv[flag + 1] || '').trim().replace(/^turns?:\/\//i, '');
  const turn = value === 'bore' ? '' : /^[a-z0-9.-]+\.[a-z]{2,}:\d{2,5}$/i.test(value) ? value : '';
  if (value !== 'bore' && !turn) fail('--turn needs host:port (for example laptop.tailnet.ts.net:8443) or the word bore.');
  saveSetting({ turn });
  return turn;
}

/** This laptop's own network address (Wi-Fi or Ethernet), for LiveKit's local video candidates. */
function lanAddress() {
  const found: Array<{ name: string; address: string }> = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal || item.mac === '00:00:00:00:00:00' || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(item.address)) continue;
      if (/vethernet|virtual|vmware|vbox|hyper-v|loopback|tailscale|wsl/i.test(name)) continue;
      found.push({ name, address: item.address });
    }
  }
  return (found.find(item => /wi-?fi|wlan|wireless/i.test(item.name)) || found.find(item => /ethernet/i.test(item.name)) || found[0])?.address || '';
}

// ---------- Programs ----------
async function download(url: string, file: string) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const part = file + '.part';
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(part));
  renameSync(part, file);
}

async function mediamtx() {
  const exe = join(tools, 'mediamtx', 'mediamtx.exe');
  if (existsSync(exe)) return exe;
  say(`Downloading MediaMTX ${MEDIAMTX_VERSION} (the relay program, about 20 MB). This happens once.`);
  mkdirSync(join(tools, 'mediamtx'), { recursive: true });
  const zip = join(tools, 'mediamtx', 'mediamtx.zip');
  await download(`https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_windows_amd64.zip`, zip);
  const unzip = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${join(tools, 'mediamtx')}'`], { stdio: 'inherit' });
  rmSync(zip, { force: true });
  if (unzip.status !== 0 || !existsSync(exe)) throw new Error('Could not unpack MediaMTX.');
  return exe;
}

const BORE_VERSION = 'v0.6.0';
async function boreExe() {
  const exe = join(tools, 'bore', 'bore.exe');
  if (existsSync(exe)) return exe;
  say(`Downloading bore ${BORE_VERSION} (a free, open-source tunnel program, about 2 MB). This happens once.`);
  mkdirSync(join(tools, 'bore'), { recursive: true });
  const zip = join(tools, 'bore', 'bore.zip');
  await download(`https://github.com/ekzhang/bore/releases/download/${BORE_VERSION}/bore-${BORE_VERSION}-x86_64-pc-windows-msvc.zip`, zip);
  const unzip = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${join(tools, 'bore')}'`], { stdio: 'inherit' });
  rmSync(zip, { force: true });
  if (unzip.status !== 0 || !existsSync(exe)) throw new Error('Could not unpack bore.');
  return exe;
}

async function cloudflared() {
  const exe = join(tools, 'cloudflared.exe');
  if (existsSync(exe) && statSync(exe).size > 1_000_000) return exe;
  say('Downloading cloudflared (Cloudflare\'s free tunnel program, about 60 MB). This happens once.');
  mkdirSync(tools, { recursive: true });
  await download('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', exe);
  return exe;
}

function mediamtxConfig() {
  const origins = ORIGINS.map(origin => JSON.stringify(origin)).join(', ');
  return `# Written by scripts/iphone-relay-laptop.ts on every start. Edit that script, not this file.
logLevel: warn
logDestinations: [stdout]
authMethod: http
authHTTPAddress: http://127.0.0.1:${PORTS.auth}/auth
authHTTPExclude: []
api: true
apiAddress: 127.0.0.1:${PORTS.api}
apiTrustedProxies: [127.0.0.1]
metrics: false
pprof: false
playback: false
rtsp: false
srt: false
moq: false
rtmp: true
rtmpAddress: 127.0.0.1:${PORTS.rtmp}
# Walls on this laptop or its Wi-Fi play over WebRTC (about 1 s behind).
webrtc: true
webrtcAddress: 127.0.0.1:${PORTS.webrtc}
webrtcTrustedProxies: [127.0.0.1]
webrtcAllowOrigins: [${origins}]
webrtcLocalUDPAddress: :${PORTS.media}
webrtcLocalTCPAddress: ""
webrtcIPsFromInterfaces: true
# Walls anywhere else play over HLS through the Cloudflare tunnel (a few seconds behind).
hls: true
hlsAddress: 127.0.0.1:${PORTS.hls}
hlsTrustedProxies: [127.0.0.1]
hlsAllowOrigins: [${origins}]
hlsAlwaysRemux: true
hlsVariant: lowLatency
hlsSegmentCount: 7
hlsSegmentDuration: 1s
hlsPartDuration: 200ms
pathDefaults:
  overridePublisher: true
paths:
  all_others:
`;
}

// ---------- Local checks (MediaMTX asks here before every publish, view and API call) ----------
function authServer(relaySecret: string) {
  // Only the signing functions are used; the addresses are placeholders.
  const signer = createIphoneRelay({ rtmp: 'rtmp://local:1', web: 'https://local', secret: relaySecret });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 8192) req.destroy(); });
    req.on('end', async () => {
      let allowed = false;
      try {
        const ask = JSON.parse(body || '{}') as { action?: string; path?: string; user?: string; password?: string; protocol?: string };
        const user = String(ask.user || ''), pass = String(ask.password || ''), path = String(ask.path || '');
        if (ask.action === 'read') allowed = signer.canRead(user, pass, path, serverNow());
        else if (ask.action === 'api') allowed = signer.canUseApi(user, pass);
        else if (ask.action === 'publish' && signer.publisherOf(path)) {
          // Only the API knows whether this player's check-in is still open.
          const answer = await fetch(API + '/relay/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(8000) });
          allowed = answer.ok;
          say(`${new Date().toLocaleTimeString()}  iPhone ${allowed ? 'started sharing' : 'refused (no open check-in for this player)'}: player ${(path.split('/')[1] || '').slice(0, 8)}`);
        }
      } catch (error) {
        say(`${new Date().toLocaleTimeString()}  check failed: ${(error as Error).message}`);
      }
      res.writeHead(allowed ? 200 : 401).end();
    });
  });
  server.listen(PORTS.auth, '127.0.0.1');
  return server;
}

// ---------- One public address for the wall: the Cloudflare tunnel points here ----------
/** LiveKit's signalling (/rtc, a WebSocket, plus /rtc/validate) and room API (/twirp) go to the laptop's LiveKit. */
const isLivekitPath = (url: string) => /^\/(rtc|twirp)(\/|\?|$)/.test(url);
function frontServer() {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const port = isLivekitPath(url) ? PORTS.livekit : url.startsWith('/v3/') ? PORTS.api : /^\/[^?]+\/whep(\/|\?|$)/.test(url) ? PORTS.webrtc : PORTS.hls;
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: url, headers }, answer => {
      res.writeHead(answer.statusCode || 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502).end('relay not ready'); else res.destroy(); });
    req.pipe(upstream);
  });
  // LiveKit signalling is a WebSocket (/rtc): pass the upgrade straight through to the laptop's LiveKit.
  server.on('upgrade', (req, socket, head) => {
    if (!isLivekitPath(req.url || '')) return socket.destroy();
    const upstream = connect(PORTS.livekit, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        lines.push(`${name}: ${name.toLowerCase() === 'host' ? `127.0.0.1:${PORTS.livekit}` : req.rawHeaders[i + 1]}`);
      }
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  server.listen(PORTS.front, '127.0.0.1');
  return server;
}

// ---------- Run ----------
const children: ChildProcess[] = [];
const servers: http.Server[] = [];
function stopAll(code: number) {
  for (const child of children) try { child.kill(); } catch { /* already gone */ }
  for (const server of servers) server.close();
  process.exit(code);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const relaySecret = secret();
const fixedRtmp = fixedAddress();
const [mtxExe, cfExe, boreBin] = await Promise.all([mediamtx(), cloudflared(), boreExe()]).catch(error => fail((error as Error).message));
let rtmp = fixedRtmp;

servers.push(authServer(relaySecret), frontServer());
const configFile = join(tools, 'mediamtx', 'arenahub-laptop.yml');
writeFileSync(configFile, mediamtxConfig());
const mtx = spawn(mtxExe, [configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(mtx);
let mtxLog = '';
const keepLog = (chunk: Buffer) => { mtxLog = (mtxLog + chunk).slice(-4000); };
mtx.stdout!.on('data', keepLog); mtx.stderr!.on('data', keepLog);
mtx.on('exit', code => fail(`The relay program (MediaMTX) stopped (exit ${code}).\n${mtxLog}`));

// A fixed HTTPS address for the wall (for example Tailscale Funnel: `tailscale funnel --bg 443 http://127.0.0.1:8890`)
// instead of a Cloudflare quick tunnel, which gets a new name every start and is refused (429) after many starts.
// `--web https://host` saves it; `--web cloudflare` goes back to the quick tunnel.
function webSetting() {
  const flag = process.argv.indexOf('--web');
  if (flag < 0) return savedSettings().web || '';
  const value = (process.argv[flag + 1] || '').trim().replace(/\/+$/, '');
  const fixed = value === 'cloudflare' ? '' : /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? value : '';
  if (value !== 'cloudflare' && !fixed) fail('--web needs an https address with no path (for example https://laptop.tailnet.ts.net) or the word cloudflare.');
  saveSetting({ web: fixed });
  return fixed;
}
const fixedWeb = webSetting();
let web: string;
if (fixedWeb) {
  web = fixedWeb;
  say(`The wall plays from ${web} (fixed address).`);
} else {
  say('Opening the Cloudflare tunnel for the wall...');
  const tunnel = spawn(cfExe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORTS.front}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(tunnel);
  web = await new Promise<string>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Cloudflare did not give an address within 60 seconds. Check the internet and try again.')), 60_000);
    const read = (chunk: Buffer) => { const found = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (found) { clearTimeout(timer); done(found[0]); } };
    tunnel.stdout!.on('data', read); tunnel.stderr!.on('data', read);
    tunnel.on('exit', code => { clearTimeout(timer); reject(new Error(`cloudflared stopped (exit ${code}). If Cloudflare refuses new tunnels (429), use a fixed address: --web https://host`)); });
  }).catch(error => fail((error as Error).message));
  tunnel.on('exit', code => fail(`The Cloudflare tunnel stopped (exit ${code}). Run npm run relay:laptop again; the website picks up the new address by itself.`));
}

// iPhones reach this laptop's RTMP port through bore (free, no account) unless a fixed address was given.
// bore gives a new port each start; if it drops, it restarts and the website learns the new address within seconds.
const BORE_SERVER = process.env.RELAY_BORE_SERVER || 'bore.pub';
// Some home routers' DNS does not know bore.pub ("No such host is known"). Look it up through public DNS and connect
// by IP; the iPhones then get an IP address too, so their own DNS cannot get in the way either.
// The address must not flip between the name and the IP after a network blip: players' PRISM keeps one Stream URL
// (their setup counts as done for that address), so the last IP that worked is kept in data/relay-bore-host.json.
const boreHostFile = resolve('data', 'relay-bore-host.json');
async function boreHost() {
  if (/^[\d.]+$/.test(BORE_SERVER)) return BORE_SERVER;
  let last = '';
  try { const saved = JSON.parse(readFileSync(boreHostFile, 'utf8')); if (saved.name === BORE_SERVER && /^[\d.]+$/.test(saved.ip)) last = saved.ip; } catch { /* first run */ }
  const resolver = new Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  try {
    const ip = (await resolver.resolve4(BORE_SERVER))[0];
    if (ip) {
      if (ip !== last) { mkdirSync(resolve('data'), { recursive: true }); writeFileSync(boreHostFile, JSON.stringify({ name: BORE_SERVER, ip }, null, 2)); }
      return ip;
    }
  } catch { /* lookup failed: keep the last address that worked */ }
  return last || BORE_SERVER;
}
// The same bore ports every time, saved here. Without it every drop gave a new port, and PRISM kept sending to the
// old one, so the player's screen silently vanished. With a fixed port PRISM's saved Stream URL stays right.
// Note: PRISM does NOT reconnect by itself after a drop; the player taps Go Live again (same codes).
// `livekitPort` is the public port of this laptop's LiveKit video (Android and PC screens). LiveKit listens on the
// same port number locally, because it tells phones that address to send video to.
const borePortFile = resolve('data', 'relay-bore-port.json');
type BorePorts = { port?: number; livekitPort?: number };
const validPort = (value: unknown) => { const port = Number(value); return port >= 1024 && port < 65536 ? port : 0; };
function savedBorePorts(): BorePorts {
  try { const saved = JSON.parse(readFileSync(borePortFile, 'utf8')); return { port: validPort(saved.port), livekitPort: validPort(saved.livekitPort) }; } catch { return {}; }
}
function saveBorePort(key: keyof BorePorts, port: number) {
  mkdirSync(resolve('data'), { recursive: true });
  writeFileSync(borePortFile, JSON.stringify({ ...savedBorePorts(), [key]: port }, null, 2));
}
const randomPort = () => 20000 + Math.floor(Math.random() * 40000);
// Every drop goes into data/relay-events.log (website time), so a failed test can be matched to a tunnel drop.
function logEvent(text: string) {
  try { appendFileSync(resolve('data', 'relay-events.log'), `${new Date(serverNow()).toISOString()}  ${text}\n`); } catch { /* best effort */ }
}

/** One bore tunnel that keeps the same public port, reopens itself after a drop and can be restarted on demand. */
function boreTunnel(label: string, key: keyof BorePorts, localPort: (port: number) => number, onBack: (address: string) => void) {
  let port = savedBorePorts()[key] || randomPort(), child: ChildProcess | null = null, reopening = false;
  const open = (host: string): Promise<string> => new Promise((done, reject) => {
    const proc = spawn(boreBin, ['local', String(localPort(port)), '--local-host', '127.0.0.1', '--to', host, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(proc);
    child = proc;
    let found = '', log = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`bore did not give an address within 30 seconds.\n${log}`)); }, 30_000);
    const read = (chunk: Buffer) => {
      // eslint-disable-next-line no-control-regex
      const text = String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
      log = (log + text).slice(-2000);
      const match = /listening at ([\w.-]+:\d+)/.exec(text);
      if (match && !found) { found = match[1]; clearTimeout(timer); done(found); }
    };
    proc.stdout!.on('data', read); proc.stderr!.on('data', read);
    proc.on('exit', code => {
      clearTimeout(timer);
      if (child === proc) child = null;
      if (!found) return reject(new Error(`bore stopped (exit ${code}).\n${log}`));
      say(`${new Date().toLocaleTimeString()}  The ${label} tunnel dropped. Reopening it on the same address.`);
      logEvent(`${label} tunnel dropped (exit ${code}), reopening port ${port}`);
      void reopen();
    });
  });
  async function start(samePortOnly = false): Promise<string> {
    const host = await boreHost();
    say(`Opening the ${label} tunnel (${BORE_SERVER}${host !== BORE_SERVER ? ' at ' + host : ''}, port ${port})...`);
    // The port can still be held for a moment after a drop, or be taken by someone else: try it a few times first.
    for (let attempt = 1; ; attempt++) {
      try {
        const address = await open(host);
        saveBorePort(key, port);
        return address;
      } catch (error) {
        const text = (error as Error).message;
        if (attempt >= 8) throw error;
        if (!samePortOnly && attempt >= 4 && /port already in use|already in use|address in use/i.test(text)) {
          port = randomPort();
          say(`${new Date().toLocaleTimeString()}  That port is taken. Trying port ${port}.`);
        }
        await sleep(Math.min(15_000, 2000 * attempt));
      }
    }
  }
  async function reopen() {
    if (reopening) return;
    reopening = true;
    try {
      // A running LiveKit is bound to its port number, so its tunnel may only come back on the same port.
      const next = await start(key === 'livekitPort');
      say(`${new Date().toLocaleTimeString()}  ${label} tunnel back on ${next}.`);
      onBack(next);
    } catch (error) {
      say(`${new Date().toLocaleTimeString()}  ${(error as Error).message.split('\n')[0]} Trying again in 20 s.`);
      setTimeout(() => { reopening = false; void reopen(); }, 20_000);
      return;
    }
    reopening = false;
  }
  return {
    start,
    get port() { return port; },
    get busy() { return reopening || !child; },
    restart() { child?.kill(); },
  };
}

const rtmpTunnel = boreTunnel('iPhone (RTMP)', 'port', () => PORTS.rtmp, next => {
  const address = 'rtmp://' + next;
  if (address !== rtmp) say(`${new Date().toLocaleTimeString()}  iPhones now send to ${address}. Players must copy the new Stream URL into PRISM.`);
  rtmp = address;
  void checkIn();
});
if (!rtmp) rtmp = 'rtmp://' + await rtmpTunnel.start().catch(error => fail((error as Error).message + '\nYou can also give your own TCP tunnel address: npm run relay:laptop -- --rtmp host:port'));

// ---------- Android and PC screens: this laptop's own LiveKit (no monthly minute limit) ----------
// Players and the wall reach LiveKit's signalling through the Cloudflare tunnel, and send/receive video over TCP
// through a second bore tunnel. The website signs tokens with LIVEKIT_API_KEY/SECRET, so this LiveKit uses the
// same pair. --no-livekit leaves Android and PC screens on LiveKit Cloud.
const livekitKey = (process.env.LIVEKIT_API_KEY || '').trim(), livekitSecret = (process.env.LIVEKIT_API_SECRET || '').trim();
const livekitWanted = !process.argv.includes('--no-livekit') && !!livekitKey && livekitSecret.length >= 32;
if (!process.argv.includes('--no-livekit') && !livekitWanted) say('LiveKit on this laptop is off: LIVEKIT_API_KEY / LIVEKIT_API_SECRET (32+ characters) are missing in .env.');
let livekitOn = false;
// With --turn (Tailscale Funnel), video goes through LiveKit's own TURN server behind the TLS tunnel; no bore.
const turn = livekitWanted ? turnSetting() : '';
const videoTunnel = livekitWanted && !turn ? boreTunnel('Android/PC video', 'livekitPort', port => port, () => void checkIn()) : null;
const videoLabel = () => turn ? `turns://${turn} (Tailscale Funnel)` : `video port ${videoTunnel!.port} through bore`;
if (livekitWanted) {
  try {
    const exe = join(tools, 'livekit', 'livekit-server.exe');
    if (!existsSync(exe)) throw new Error(`LiveKit server not found at ${exe}.`);
    const config = join(tools, 'livekit', 'arenahub-laptop.yaml');
    let rtcConfig: string;
    if (turn) {
      const [turnHost, turnPort] = [turn.slice(0, turn.lastIndexOf(':')), turn.slice(turn.lastIndexOf(':') + 1)];
      const lan = lanAddress();
      rtcConfig = `rtc:
  # Phones on this laptop's Wi-Fi connect straight to these local ports; everyone else goes through TURN below.
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
${lan ? `  node_ip: ${lan}\n` : ''}turn:
  # The Funnel tunnel (tls-terminated-tcp ${turnPort} -> 127.0.0.1:${turnPort}) handles TLS with a real certificate,
  # so TURN listens on that port without TLS (external_tls) and players reach it as turns://${turnHost}:${turnPort}.
  enabled: true
  domain: ${turnHost}
  tls_port: ${turnPort}
  external_tls: true
  relay_range_start: 50300
  relay_range_end: 50500`;
    } else {
      const videoAddress = await videoTunnel!.start();
      rtcConfig = `rtc:
  # Phones and walls send video over TCP to the bore address (bore carries TCP only).
  tcp_port: ${videoTunnel!.port}
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
  node_ip: ${videoAddress.split(':')[0]}`;
    }
    writeFileSync(config, `# Written by scripts/iphone-relay-laptop.ts on every start. Edit that script, not this file.
port: ${PORTS.livekit}
${rtcConfig}
keys:
  ${livekitKey}: ${livekitSecret}
room:
  empty_timeout: 900
logging:
  level: warn
`);
    const lk = spawn(exe, ['--config', config], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(lk);
    let lkLog = '';
    const keep = (chunk: Buffer) => { lkLog = (lkLog + chunk).slice(-4000); };
    lk.stdout!.on('data', keep); lk.stderr!.on('data', keep);
    lk.on('exit', code => {
      livekitOn = false;
      say(`${new Date().toLocaleTimeString()}  LiveKit on this laptop stopped (exit ${code}). Restart npm run relay:laptop.\n${lkLog.slice(-800)}`);
      logEvent(`livekit stopped (exit ${code})`);
      void checkIn();
    });
    for (let i = 0; i < 40 && !livekitOn; i++) {
      try { livekitOn = (await fetch(`http://127.0.0.1:${PORTS.livekit}/`, { signal: AbortSignal.timeout(1000) })).ok; } catch { await sleep(500); }
    }
    if (!livekitOn) throw new Error(`LiveKit did not start.\n${lkLog.slice(-800)}`);
  } catch (error) {
    say(`LiveKit on this laptop could not start: ${(error as Error).message.split('\n')[0]} Android/PC screens stay on LiveKit Cloud.`);
  }
}

// bore.pub can lose the link without bore.exe noticing for about two minutes; meanwhile every PRISM Go Live fails
// with "RTMP connection failed (1_1/150)" and Android/PC video stalls. Knock on the public RTMP address every 15 s
// with a real RTMP handshake, and restart both bore tunnels after two misses in a row (they share one bore server),
// so the addresses are usable again within about 30 s.
function rtmpAnswers(address: string): Promise<boolean> {
  const { hostname, port } = new URL(address.replace(/^rtmp:/, 'http:'));
  return new Promise(done => {
    let got = 0;
    const socket = connect(Number(port) || 1935, hostname, () => { const c = Buffer.alloc(1537); c[0] = 3; socket.write(c); });
    const finish = (ok: boolean) => { clearTimeout(timer); socket.destroy(); done(ok); };
    const timer = setTimeout(() => finish(false), 10_000);
    socket.on('data', chunk => { got += chunk.length; if (got >= 1537) finish(true); });
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(got >= 1537));
  });
}
// Every iPhone stream that is reaching MediaMTX right now. MediaMTX drops a publisher about 10 s after its data
// stops, so a stream listed here proves the tunnel is carrying video.
const localStreams = createIphoneRelay({ rtmp: 'rtmp://local:1', web: 'https://local', api: `http://127.0.0.1:${PORTS.api}`, secret: relaySecret });
async function streamsArriving() {
  try { return (await localStreams.live()).length; } catch { return 0; }
}
if (!fixedRtmp) {
  let misses = 0;
  setInterval(async () => {
    if (rtmpTunnel.busy) return;
    if (await rtmpAnswers(rtmp)) { misses = 0; return; }
    // bore.pub sometimes fails to open NEW connections while the existing ones keep flowing. Restarting then
    // would cut every iPhone that is live in a match (PRISM does not reconnect by itself), so leave it alone
    // while video is still arriving; a really dead tunnel stops the streams within ~10 s and is restarted then.
    const live = await streamsArriving();
    if (live) {
      if (misses === 0) logEvent(`public RTMP address did not answer a new connection, but ${live} iPhone stream(s) still arriving; not restarting`);
      misses = 1;
      return;
    }
    if (++misses < 2) return;
    misses = 0;
    say(`${new Date().toLocaleTimeString()}  The public tunnel address stopped answering. Restarting the bore tunnels.`);
    logEvent('public RTMP address stopped answering, restarting bore tunnels');
    rtmpTunnel.restart();
    videoTunnel?.restart();
  }, 15_000);
}

// A new tunnel name takes a few seconds to exist in DNS. Asking too early gets "not found", which computers then
// remember for minutes, so wait until public DNS knows it and the tunnel answers before telling the website.
async function tunnelReady() {
  const resolver = new Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const host = new URL(web).hostname, until = Date.now() + 90_000;
  while (Date.now() < until) {
    try { await resolver.resolve4(host); break; } catch { await sleep(2000); }
  }
  while (Date.now() < until) {
    try {
      const answer = await fetch(web + '/v3/paths/list', { signal: AbortSignal.timeout(8000) });
      if (answer.status === 401) return true;
    } catch { /* not yet */ }
    await sleep(2000);
  }
  return false;
}
say('Waiting for the tunnel to come online...');
if (!await tunnelReady()) say('The tunnel is slow to come online. Telling the website anyway; iPhones may need a minute.');

let lastOk = 0, warned = '';
function learnClock(answer: Response, sentAt: number) {
  const server = Date.parse(answer.headers.get('date') || '');
  if (!Number.isFinite(server)) return false;
  const next = server + 500 - (sentAt + Date.now()) / 2, changed = Math.abs(next - skew) > 30_000;
  if (changed && Math.abs(next) > 60_000) say(`${new Date().toLocaleTimeString()}  This laptop's clock is ${Math.round(Math.abs(next) / 60_000)} min ${next > 0 ? 'slow' : 'fast'}. Using the website's time instead.`);
  skew = next;
  return changed;
}
async function checkIn(retried = false): Promise<void> {
  const at = serverNow(), sentAt = Date.now(), livekit = web.replace(/^https/, 'wss');
  try {
    const answer = await fetch(API + '/relay/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      // The laptop's LiveKit is reached through the same Cloudflare tunnel (the front proxy sends /rtc and /twirp there).
      body: JSON.stringify(livekitOn ? { rtmp, web, at, livekit, sig: relayRegistrationSignature(relaySecret, { rtmp, web, at, livekit }) }
        : { rtmp, web, at, sig: relayRegistrationSignature(relaySecret, { rtmp, web, at }) }),
    });
    // A refusal caused by a wrong laptop clock: sign again with the website's time.
    if (learnClock(answer, sentAt) && !answer.ok && !retried) return checkIn(true);
    if (answer.ok) {
      if (!lastOk) say(`${new Date().toLocaleTimeString()}  The website knows where this relay is. iPhones can share now.`);
      lastOk = Date.now(); warned = '';
      return;
    }
    const why = answer.status === 401
      ? 'The website refused the check-in: its IPHONE_RELAY_SECRET is missing or differs from this laptop\'s .env, or the laptop clock is wrong.'
      : `The website answered ${answer.status}.`;
    if (why !== warned) say(`${new Date().toLocaleTimeString()}  ${why}`);
    warned = why;
  } catch (error) {
    const why = `Could not reach the website (${(error as Error).message}). Retrying.`;
    if (why !== warned) say(`${new Date().toLocaleTimeString()}  ${why}`);
    warned = why;
  }
}
await checkIn();
setInterval(() => void checkIn(), 20_000);

say('');
say(livekitOn ? 'Live screen relay (iPhone + Android/PC) is running on this laptop.' : 'iPhone relay is running on this laptop.');
say(`  iPhones send to:  ${rtmp}   (players get this on their setup page)`);
say(`  Wall plays from:  ${web}`);
say(`  Website:          ${API.replace('/api/integrity', '')}`);
say('Keep this window open, the laptop plugged in and awake, during matches. Press Ctrl+C to stop.');
say(livekitOn ? `  Android/PC video: LiveKit on this laptop (${videoLabel()})` : '  Android/PC video: LiveKit Cloud (LiveKit on this laptop is off)');
say('');
