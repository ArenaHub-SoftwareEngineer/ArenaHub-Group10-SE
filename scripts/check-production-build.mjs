// Runs after `npm run build`. Fails if the deployable site (dist/) contains anything from the local demo:
// the one-click test accounts, their password, or an emulator connection. This is the safety net for
// "get rid of the auto-login accounts when we deploy": they are left out by design, and this proves it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = [
  ['ArenaHub-QA-Only', 'the test account password'],
  ['Sign in as Admin', 'the one-click demo sign-in'],
  ['127.0.0.1:9098', 'a connection to the local Auth emulator'],
];
const files = [];
const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : /\.(js|html|css|json|map)$/.test(name) && files.push(path); } };
const root = process.argv[2] || 'dist';
walk(root);
const problems = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const [needle, what] of FORBIDDEN) if (text.includes(needle)) problems.push(`${file} contains ${what}`);
}
if (problems.length) {
  console.error('The production build contains local demo code and must not be deployed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Production build checked: no demo accounts or emulator links in ${files.length} files.`);
