// Runs every emulator-backed suite inside one disposable demo-arenahub emulator session.
// Usage: npm run test:emulators   (requires Java 21+ and firebase-tools)
// Set ARENAHUB_EMULATORS=auth,storage to reuse a Firestore emulator that is already running on 8085.
import { spawnSync } from 'node:child_process';

const suites = [
  ['rules', 'node --test --test-concurrency=1 tests/firestore.rules.test.mjs tests/operations.rules.test.mjs tests/data.rules.test.mjs tests/chat.rules.test.mjs'],
  ['storage', 'node --test tests/evidence.storage.test.mjs'],
  ['auth', 'node --test tests/auth.test.mjs'],
  ['auth-flow', 'node --test tests/auth-flow.integration.test.mjs'],
  ['stream', 'node --test tests/stream.integration.test.mjs'],
  ['operations', 'node --test tests/operations.integration.test.mjs'],
  ['chat kick', 'node --test tests/chat-kick.integration.test.mjs'],
  ['migration', 'npx tsx --test tests/migration.integration.test.ts'],
  ['roles', 'npx tsx --test tests/set-role.integration.test.ts'],
];

if (process.argv.includes('--inside')) {
  const { existsSync } = await import('node:fs');
  let failed = 0;
  for (const [name, command] of suites) {
    const files = command.split(' ').filter(part => part.startsWith('tests/'));
    const present = files.filter(file => existsSync(file));
    if (!present.length) { console.log(`\n=== ${name}: skipped (no test files yet) ===`); continue; }
    console.log(`\n=== ${name} ===`);
    const runner = command.split(' ').filter(part => !part.startsWith('tests/')).join(' ');
    const run = spawnSync(`${runner} ${present.join(' ')}`, { stdio: 'inherit', shell: true });
    if (run.status !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}

const result = spawnSync('firebase', ['emulators:exec', '--only', process.env.ARENAHUB_EMULATORS || 'auth,firestore,storage', '--project', 'demo-arenahub', '--config', 'firebase.test.json', '"node tests/run-emulator-suites.mjs --inside"'], { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
