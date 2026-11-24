// Runs after `npm run build`. Fails if the deployable site (dist/) contains anything from the local demo:
// the one-click test accounts, their password, or an emulator connection. This is the safety net for
// "get rid of the auto-login accounts when we deploy": they are left out by design, and this proves it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';

const FORBIDDEN = [
  ['ArenaHub-QA-Only', 'the test account password'],
  ['Sign in as Admin', 'the one-click demo sign-in'],
  ['Continue as Admin', 'the local admin shortcut'],
  ['Continue as User', 'the local user shortcut'],
  ['127.0.0.1:9098', 'a connection to the local Auth emulator'],
];
// Server-only secrets: their actual values, read from the environment and the .env files, must not be
// in the site. (Searching for the "AIza" prefix alone is useless: the public Firebase key starts with it.)
// Values are compared in memory and never printed.
const SECRET_NAMES = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'FIREBASE_SERVICE_ACCOUNT_JSON'];
function secretValues() {
  const values = new Map();
  const add = (name, value) => { if (typeof value === 'string' && value.trim().length >= 16) values.set(`${name}:${values.size}`, [name, value.trim()]); };
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (!existsSync(file)) continue;
    const parsed = dotenv.parse(readFileSync(file));
    for (const name of SECRET_NAMES) add(name, parsed[name]);
  }
  for (const name of SECRET_NAMES) add(name, process.env[name]);
  // The service account's private key is the part that matters most.
  for (const [, [name, value]] of [...values]) if (name === 'FIREBASE_SERVICE_ACCOUNT_JSON') { try { add('the service account private key', JSON.parse(value).private_key?.split('\n').find(line => line.length > 40)); } catch {} }
  return [...values.values()];
}
const files = [];
const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : /\.(js|html|css|json|map|txt|svg|webmanifest)$/.test(name) && files.push(path); } };
const root = process.argv[2] || 'dist';
walk(root);
const secrets = secretValues();
const problems = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const [needle, what] of FORBIDDEN) if (text.includes(needle)) problems.push(`${file} contains ${what}`);
  for (const [name, value] of secrets) if (text.includes(value)) problems.push(`${file} contains the value of ${name}`);
}
if (problems.length) {
  console.error('The production build must not be deployed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Production build checked: no demo accounts, emulator links or server keys (${secrets.length} key value${secrets.length === 1 ? '' : 's'} compared) in ${files.length} files.`);
