// Builds the ArenaHub PC agent into dist-agent/:
//   arenahub-agent.cjs  - runs on any Windows PC with Node 20+ (node arenahub-agent.cjs --server ... --code ...)
//   arenahub-agent.exe  - single file for player PCs without Node (Node single executable application)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.env.ARENAHUB_AGENT_OUT_DIR || 'dist-agent');
mkdirSync(out, { recursive: true });
const cjs = join(out, 'arenahub-agent.cjs');
await build({ entryPoints: ['tools/integrity-agent/agent.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: cjs, legalComments: 'none', logLevel: 'warning' });
console.log(`Built ${cjs}`);
if (process.argv.includes('--no-exe')) process.exit(0);

const blob = join(out, 'sea-prep.blob'), config = join(out, 'sea-config.json'), exe = join(out, 'arenahub-agent.exe');
writeFileSync(config, JSON.stringify({ main: cjs, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
if (existsSync(exe)) unlinkSync(exe);
copyFileSync(process.execPath, exe);
const postject = resolve('node_modules', 'postject', 'dist', 'cli.js');
if (!existsSync(postject)) { console.error('postject is missing. Run npm install, then npm run build:agent again.'); process.exit(1); }
execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit' });
for (const file of [blob, config]) unlinkSync(file);
console.log(`Built ${exe}`);
