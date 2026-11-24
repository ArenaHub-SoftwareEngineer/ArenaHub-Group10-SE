// Local testing with Firebase emulators.
//
//   npm run demo              players can join online (Cloudflare quick tunnel, like npm run online)
//   npm run demo -- --local   this laptop only
//
// 1. Starts the Firebase emulators (Auth, Firestore and Storage) for the "demo-arenahub" test project.
// 2. Creates the two test accounts and local tournament fixtures.
// 3. Builds the site in test mode into dist-demo/ (never dist/, which is what gets deployed).
// 4. Starts ArenaHub on http://localhost:3210. Use the email sign-in form.
//
// Test accounts (emulator only), password ArenaHub-QA-Only-27!
//   Admin:  organizer@wmsu.edu.ph      Player: student@wmsu.edu.ph
// The emulator recreates the accounts and fixtures each time the script starts.
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const local = process.argv.includes('--local');
const testEnv = parse(readFileSync('.env.test'));
if (testEnv.VITE_FIREBASE_PROJECT_ID !== 'demo-arenahub' || testEnv.VITE_FIREBASE_EMULATORS !== 'true') {
  console.error('.env.test must point at the demo-arenahub emulator project. Refusing to start.'); process.exit(1);
}
const shell = process.platform === 'win32';
const children = [];
const stopAll = code => { for (const child of children.reverse()) try { shell ? spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) : child.kill(); } catch {} process.exit(code); };
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const open = port => new Promise(done => { const socket = createConnection({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.end(); done(true); }); socket.once('error', () => done(false)); });
const waitFor = async (port, seconds) => { for (let i = 0; i < seconds * 2; i++) { if (await open(port)) return true; await new Promise(r => setTimeout(r, 500)); } return false; };
const run = (command, args, env = {}) => { const result = spawnSync(command, args, { stdio: 'inherit', shell, env: { ...process.env, ...env } }); if (result.status !== 0) { console.error(`\n${command} ${args.join(' ')} failed.`); stopAll(1); } };

if (await open(3210)) { console.error('Port 3210 is in use. Stop the other ArenaHub window (Ctrl+C) first.'); process.exit(1); }

const emulatorPorts = [9098, 8085, 9198];
const emulatorsUp = await Promise.all(emulatorPorts.map(open));
if (emulatorsUp.every(Boolean)) console.log('Firebase emulators are already running; using them.');
else if (emulatorsUp.some(Boolean)) { console.error('Firebase Auth, Firestore and Storage must use ports 9098, 8085 and 9198. Stop the partial emulator session and try again.'); process.exit(1); }
else {
  console.log('Starting the Firebase emulators (needs Java; first start can take a minute)...');
  const emulators = spawn('npx', ['firebase', 'emulators:start', '--only', 'auth,firestore,storage', '--project', 'demo-arenahub', '--config', 'firebase.test.json'], { stdio: ['ignore', 'pipe', 'inherit'], shell });
  children.push(emulators);
  emulators.stdout.on('data', chunk => { if (/error/i.test(String(chunk))) process.stdout.write(chunk); });
  emulators.on('exit', code => { console.error(`\nThe Firebase emulators stopped (exit ${code}).`); stopAll(1); });
  if (!(await Promise.all(emulatorPorts.map(port => waitFor(port, 120)))).every(Boolean)) { console.error('The emulators did not start within 2 minutes.'); stopAll(1); }
}

console.log('Creating the local test accounts and tournaments...');
run('node', ['tests/seed-emulators.mjs']);
run('npx', ['tsx', 'scripts/seed-demo.ts'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' });

console.log('Building the local test site into dist-demo/ ...');
run('npx', ['vite', 'build', '--mode', 'test', '--outDir', 'dist-demo', '--emptyOutDir', '--logLevel', 'warn']);

const env = {
  ...process.env, ...testEnv,
  SITE_DIR: 'dist-demo',
  // Match monitor sessions made during the demo stay apart from real event data.
  INTEGRITY_DATA_DIR: 'data/demo',
};
console.log(`\nLocal test site ready at http://localhost:3210. Use the email sign-in form with a seeded test account.`);
const server = local
  ? spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { stdio: 'inherit', env })
  : spawn(process.execPath, ['scripts/online.mjs'], { stdio: 'inherit', env });
children.push(server);
server.on('exit', code => stopAll(code ?? 1));
