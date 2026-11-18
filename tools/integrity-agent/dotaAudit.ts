// Dota 2 install audit (agent 3.2). Read-only.
//
// Valve ships game/bin/win64/dota.signatures with every Dota 2 build: a list of the game's program
// files (client.dll, engine2.dll, dota2.exe, gameinfo.gi, ...) with their SHA-1. This module checks
// the install against that list, then looks for what the list cannot cover:
//   - program files Valve does not ship next to dota2.exe (proxy-DLL loaders such as a fake version.dll),
//   - content packs (VPK) and search paths Valve does not ship (the -language / gameinfo mod route),
//   - launch options that turn VAC off or load custom content.
// Only findings, relative game paths, the build ID and the list's own SHA-256 leave the PC.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
type Status = 'complete' | 'partial' | 'failed';

export interface DotaAudit {
  found: boolean;
  buildId?: string;
  updatePending?: boolean;
  manifestSha256?: string;
  modifiedFiles: string[];
  missingFiles: string[];
  unlistedBinaries: string[];
  contentOverrides: string[];
  launchFlags: string[];
}
export interface ManifestEntry { file: string; sha1: string }

/** Steam's language codes. Dota 2 mounts game/dota_<language> for these. */
export const VALVE_LANGUAGES = new Set(['arabic', 'brazilian', 'bulgarian', 'czech', 'danish', 'dutch', 'english', 'finnish', 'french', 'german', 'greek', 'hungarian', 'indonesian', 'italian', 'japanese', 'koreana', 'latam', 'norwegian', 'polish', 'portuguese', 'romanian', 'russian', 'schinese', 'spanish', 'swedish', 'tchinese', 'thai', 'turkish', 'ukrainian', 'vietnamese']);
/** Folders directly under game/ that Valve ships and that are checked in other ways. */
const VALVE_GAME_FOLDERS = new Set(['bin', 'core', 'dota', 'dota_addons']);
/** Search path values Valve's own gameinfo.gi files use. */
const VALVE_SEARCH_VALUES = new Set(['dota', 'core', 'dota_core', 'dota_lv', 'dota_addons', 'dota_*language*', 'dota_*language*_addons']);
const VALVE_ROOT_VPK = /^(pak01|shaders_pc)_(dir|\d{3})\.vpk$/i;
const BINARY = /\.(dll|exe|asi|sys|ocx)$/i;
const MAX_FINDINGS = 50;

/**
 * Parses dota.signatures. Lines look like `...\..\..\dota\bin\win64\client.dll~SHA1:<40 hex>;CRC:<8 hex>`,
 * where `...` is game/bin/win64. Entries that would leave the game folder are ignored.
 */
export function parseSignatures(text: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\.\.\.((?:\\[^\\~]+)+)~SHA1:([0-9A-Fa-f]{40});/);
    if (!match) continue;
    const stack = ['bin', 'win64'];
    let valid = true;
    for (const part of match[1].split('\\').filter(Boolean)) {
      if (part === '..') { if (!stack.length) { valid = false; break; } stack.pop(); }
      else if (part === '.' || /[:/]/.test(part)) { valid = false; break; }
      else stack.push(part);
    }
    if (valid && stack.length) entries.push({ file: stack.join('/'), sha1: match[2].toLowerCase() });
  }
  return entries;
}

/** Values of a gameinfo.gi SearchPaths block (for example `dota`, `core`, `dota_*LANGUAGE*`). */
export function searchPathValues(gameinfo: string): string[] {
  const start = gameinfo.search(/SearchPaths\s*\{/i);
  if (start < 0) return [];
  const body = gameinfo.slice(gameinfo.indexOf('{', start) + 1);
  const end = body.indexOf('}');
  return (end < 0 ? body : body.slice(0, end)).split(/\r?\n/)
    .map(line => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map(line => line.split(/\s+/)[1]?.replace(/^"|"$/g, '') || '')
    .filter(Boolean);
}

/** Search path values a gameinfo.gi adds beyond Valve's folders (`own` is the folder the file sits in). */
export function unexpectedSearchPaths(gameinfo: string, own: string): string[] {
  return searchPathValues(gameinfo).filter(value => {
    const lower = value.toLowerCase();
    if (VALVE_SEARCH_VALUES.has(lower) || lower === own.toLowerCase()) return false;
    const language = lower.match(/^dota_([a-z]+)(?:_addons)?$/)?.[1];
    return !(language && VALVE_LANGUAGES.has(language));
  });
}

/** Every `"570" { ... }` block in a Steam VDF file, with braces balanced. */
function appBlocks(vdf: string, appId: string): string[] {
  const blocks: string[] = [];
  const opener = new RegExp(`"${appId}"\\s*\\{`, 'g');
  for (let found = opener.exec(vdf); found && blocks.length < 20; found = opener.exec(vdf)) {
    const start = found.index + found[0].length - 1;
    let depth = 0, inString = false, index = start;
    for (; index < vdf.length; index++) {
      const char = vdf[index];
      if (inString) { if (char === '\\') index++; else if (char === '"') inString = false; continue; }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) break;
    }
    blocks.push(vdf.slice(start, index + 1));
  }
  return blocks;
}

/** Dota 2's launch options from one Steam account's localconfig.vdf. */
export function launchOptionsFromVdf(vdf: string): string[] {
  return appBlocks(vdf, '570').flatMap(block => [...block.matchAll(/"LaunchOptions"\s+"((?:[^"\\]|\\.)*)"/gi)].map(match => match[1].replace(/\\(.)/g, '$1')));
}

/** Restricted flags in a launch-option string or a running dota2.exe command line. */
export function restrictedLaunchFlags(commandLine: string): string[] {
  const tokens = commandLine.match(/"[^"]*"|\S+/g)?.map(token => token.replace(/^"|"$/g, '')) || [];
  const flags: string[] = [];
  tokens.forEach((token, index) => {
    const lower = token.toLowerCase();
    const next = (tokens[index + 1] || '').toLowerCase();
    if (lower === '-insecure') flags.push('-insecure (VAC disabled)');
    else if (/^[+-]?sv_cheats$/.test(lower) && next && next !== '0') flags.push(`+sv_cheats ${next.slice(0, 20)}`);
    else if (lower === '-language' && next && !VALVE_LANGUAGES.has(next)) flags.push(`-language ${next.slice(0, 40)} (not a Valve language; loads game/dota_${next.slice(0, 40)})`);
  });
  return [...new Set(flags)];
}

export interface AuditOptions {
  /** SHA-1 of a file; the agent passes a cached version. */
  sha1?: (path: string) => Promise<string>;
  /** Raw launch-option strings and running command lines to inspect. */
  launchOptions?: string[];
  deadline?: number;
}

export async function fileSha1(path: string): Promise<string> {
  const hash = createHash('sha1');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > 512 * 1024 * 1024) throw new Error('File exceeds the inspection limit.');
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function walk(root: string, depth: number, visit: (relative: string, isFile: boolean) => void, prefix = '') {
  let entries;
  try { entries = await readdir(join(root, prefix), { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (depth > 0) await walk(root, depth - 1, visit, relative); }
    else if (entry.isFile()) visit(relative, true);
  }
}

const push = (list: string[], value: string) => { if (list.length < MAX_FINDINGS && !list.includes(value)) list.push(value.slice(0, 200)); };

/** Audits one install. `gameDir` is `<library>/steamapps/common/dota 2 beta/game`. */
export async function auditDotaInstall(gameDir: string, options: AuditOptions = {}): Promise<{ audit: DotaAudit; status: Status }> {
  const sha1 = options.sha1 || fileSha1;
  const deadline = options.deadline ?? Date.now() + 60_000;
  const audit: DotaAudit = { found: false, modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [] };
  let status: Status = 'complete';
  try { if (!(await stat(join(gameDir, 'bin', 'win64', 'dota2.exe'))).isFile()) throw new Error('missing'); }
  catch { return { audit, status: 'failed' }; }
  audit.found = true;

  // Steam's own install record: build number, and whether an update is still pending (StateFlags 4 = ready).
  try {
    const acf = await readFile(join(gameDir, '..', '..', '..', 'appmanifest_570.acf'), 'utf8');
    const build = acf.match(/"buildid"\s+"(\d{1,12})"/i)?.[1];
    const state = acf.match(/"StateFlags"\s+"(\d+)"/i)?.[1];
    if (build) audit.buildId = build;
    if (state) audit.updatePending = state !== '4';
  } catch { /* Not every library layout keeps the manifest beside the game; the file check does not depend on it. */ }

  // 1. Valve's file list.
  let manifest: ManifestEntry[] = [];
  try {
    const raw = await readFile(join(gameDir, 'bin', 'win64', 'dota.signatures'));
    audit.manifestSha256 = createHash('sha256').update(raw).digest('hex');
    manifest = parseSignatures(raw.toString('utf8'));
    if (!manifest.length) push(audit.modifiedFiles, 'bin/win64/dota.signatures (no file entries)');
  } catch { push(audit.missingFiles, 'bin/win64/dota.signatures'); }
  for (const entry of manifest) {
    if (Date.now() > deadline) { status = 'partial'; break; }
    const path = join(gameDir, ...entry.file.split('/'));
    try {
      if (!(await stat(path)).isFile()) { push(audit.missingFiles, entry.file); continue; }
    } catch { push(audit.missingFiles, entry.file); continue; }
    try { if ((await sha1(path)) !== entry.sha1) push(audit.modifiedFiles, entry.file); }
    catch { status = 'partial'; }
  }

  // 2. Program files in Dota's binary folders that the list does not name.
  const listed = new Set(manifest.map(entry => entry.file.toLowerCase()));
  for (const [folder, depth] of [['bin/win64', 3], ['dota/bin/win64', 2]] as const) {
    await walk(join(gameDir, ...folder.split('/')), depth, relative => {
      const file = `${folder}/${relative}`;
      if (BINARY.test(relative) && manifest.length && !listed.has(file.toLowerCase())) push(audit.unlistedBinaries, file);
    });
  }

  // 3. Content packs and search paths Valve does not ship.
  for (const folder of ['dota', 'core']) {
    try {
      for (const name of await readdir(join(gameDir, folder))) if (/\.vpk$/i.test(name) && !VALVE_ROOT_VPK.test(name)) push(audit.contentOverrides, `${folder}/${name} is not a Valve content pack`);
    } catch { /* A missing core folder is reported by the file list when it matters. */ }
  }
  try {
    const dotaInfo = await readFile(join(gameDir, 'dota', 'gameinfo.gi'), 'utf8');
    for (const value of unexpectedSearchPaths(dotaInfo, 'dota')) push(audit.contentOverrides, `dota/gameinfo.gi adds search path ${value}`);
  } catch { /* Reported as missing by the file list. */ }
  let folders: string[] = [];
  try { folders = (await readdir(gameDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { status = 'partial'; }
  for (const folder of folders) {
    if (VALVE_GAME_FOLDERS.has(folder.toLowerCase())) continue;
    let packs = 0;
    // Valve's low-violence folder ships dashboard background scenes as map packs; language folders ship no packs.
    const valveScene = (relative: string) => folder.toLowerCase() === 'dota_lv' && /^maps\/scenes\//i.test(relative);
    await walk(join(gameDir, folder), 4, relative => { if (/\.vpk$/i.test(relative) && !valveScene(relative)) packs++; });
    if (packs) push(audit.contentOverrides, `${folder} holds ${packs} content pack${packs === 1 ? '' : 's'} (VPK); Valve ships none there`);
    try {
      const info = await readFile(join(gameDir, folder, 'gameinfo.gi'), 'utf8');
      for (const value of unexpectedSearchPaths(info, folder)) push(audit.contentOverrides, `${folder}/gameinfo.gi adds search path ${value}`);
    } catch { /* Most folders have no gameinfo.gi. */ }
  }

  // 4. Launch options.
  for (const text of options.launchOptions || []) for (const flag of restrictedLaunchFlags(text)) if (audit.launchFlags.length < 20 && !audit.launchFlags.includes(flag)) audit.launchFlags.push(flag);
  return { audit, status };
}

/** Merges audits of several Steam libraries. Findings are prefixed with the library number when there are more than one. */
export function mergeAudits(results: Array<{ audit: DotaAudit; status: Status }>): { audit: DotaAudit; status: Status } {
  const found = results.filter(result => result.audit.found);
  if (!found.length) return { audit: { found: false, modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [...new Set(results.flatMap(r => r.audit.launchFlags))].slice(0, 20) }, status: 'failed' };
  if (found.length === 1) return found[0];
  const label = (index: number, list: string[]) => list.map(item => `install ${index + 1}: ${item}`);
  const audit: DotaAudit = { found: true, buildId: found[0].audit.buildId, updatePending: found.some(r => r.audit.updatePending), manifestSha256: found[0].audit.manifestSha256, modifiedFiles: [], missingFiles: [], unlistedBinaries: [], contentOverrides: [], launchFlags: [...new Set(found.flatMap(r => r.audit.launchFlags))].slice(0, 20) };
  found.forEach((result, index) => {
    for (const key of ['modifiedFiles', 'missingFiles', 'unlistedBinaries', 'contentOverrides'] as const) audit[key].push(...label(index, result.audit[key]));
  });
  for (const key of ['modifiedFiles', 'missingFiles', 'unlistedBinaries', 'contentOverrides'] as const) audit[key] = audit[key].slice(0, MAX_FINDINGS);
  return { audit, status: found.some(r => r.status !== 'complete') ? 'partial' : 'complete' };
}

/** Windows sources for launch options: each Steam account's saved options, and running dota2.exe command lines. */
export async function windowsLaunchOptions(steamPath: string): Promise<string[]> {
  const options: string[] = [];
  try {
    for (const account of (await readdir(join(steamPath, 'userdata'))).slice(0, 20)) {
      if (!/^\d{1,12}$/.test(account)) continue;
      try { options.push(...launchOptionsFromVdf(await readFile(join(steamPath, 'userdata', account, 'config', 'localconfig.vdf'), 'utf8'))); } catch { /* Account folder without saved settings. */ }
    }
  } catch { /* Steam folder without userdata. */ }
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-CimInstance Win32_Process -Filter "Name='dota2.exe'" -ErrorAction Stop | ForEach-Object { $_.CommandLine }`], { windowsHide: true, timeout: 20_000, maxBuffer: 256 * 1024, encoding: 'utf8' });
    options.push(...stdout.split(/\r?\n/).filter(Boolean).slice(0, 8));
  } catch { /* Dota 2 not running or CIM unavailable; saved options are still checked. */ }
  return options;
}

/** SHA-1 with a cache keyed by size and modification time, refreshed at least every 10 minutes. */
export function cachedSha1(hash: (path: string) => Promise<string> = fileSha1, maxAgeMs = 10 * 60_000) {
  const cache = new Map<string, { key: string; hash: string; at: number }>();
  return async (path: string) => {
    const info = await stat(path);
    const key = `${info.size}:${info.mtimeMs}`;
    const hit = cache.get(path);
    if (hit && hit.key === key && Date.now() - hit.at < maxAgeMs) return hit.hash;
    const value = await hash(path);
    if (cache.size > 1024) cache.clear();
    cache.set(path, { key, hash: value, at: Date.now() });
    return value;
  };
}
