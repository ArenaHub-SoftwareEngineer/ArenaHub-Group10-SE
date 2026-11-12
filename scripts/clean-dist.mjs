// Deletes dist/ file by file.
// Node 24's recursive fs.rmSync silently does nothing on Windows when the path contains
// non-ASCII characters (this project folder contains an em dash), which also breaks Vite's
// emptyOutDir. Single-file unlink and non-recursive rmdir work, so this walks the tree.
import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const target = resolve(process.argv[2] || 'dist');
function remove(path) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) remove(join(path, entry));
    rmdirSync(path);
  } else unlinkSync(path);
}
if (existsSync(target)) remove(target);
if (existsSync(target)) { console.error(`Could not remove ${target}`); process.exit(1); }
