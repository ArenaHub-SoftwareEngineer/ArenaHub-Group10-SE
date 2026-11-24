// Cheat-file folder check (agent 3.3). Required by tournament rule (2026-11-17); the player must agree. Read-only.
//
// Files are judged by content, not by name or extension (see fileIntel.ts), so renaming a tool, changing
// its extension or zipping it does not hide it. Coverage, in priority order: Desktop, Downloads, Documents,
// Temp and AppData, then the rest of the user profile, then every other fixed drive. Windows, Program Files,
// game libraries and package caches are skipped. Only the first 8 KB of a file is read unless that header
// shows a program, an archive, a cheat table or a script that mentions Dota. Photos, video and office files
// are checked last. Hard limits on entries, bytes and time keep it bounded; reaching one reports "partial",
// never "clean".
//
// Only matching files leave the PC, as a file name, a folder label and the reason.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { matchesEntry } from '../../src/lib/integrityRisk';
import { analyzeContent, judgeArchive, judgeTraits, needsSignature, sniff, type FileTraits, type SignatureState } from './fileIntel';

export type SweepFolder = 'Desktop' | 'Downloads' | 'Documents' | 'Temp' | 'User folders' | 'App data' | 'Other drive';
export interface SweepRoot { folder: SweepFolder; path: string }
export interface SweepFinding { name: string; folder: SweepFolder; reason: string; sha256?: string; listedAs?: string; severity?: 'low' | 'medium' | 'high' }
export interface SweepPolicy { blockedProcesses: string[]; blockedApplications: string[]; blockedFileHashes: string[] }
export interface SweepLimits { maxEntries: number; maxDepth: number; timeMs: number; maxBytes: number; concurrency: number }
export type SignatureCheck = (paths: string[]) => Promise<Array<{ path: string; status: string }>>;
type Status = 'complete' | 'partial' | 'failed';

export const DEFAULT_LIMITS: SweepLimits = { maxEntries: 400_000, maxDepth: 8, timeMs: 150_000, maxBytes: 3 * 1024 ** 3, concurrency: 8 };
/** Folder names never entered: system and program folders, game libraries, package caches. */
const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'windowsapps', 'windows', 'program files', 'program files (x86)', 'programdata', 'msys64', 'steamapps', '.gradle', '.npm', '.cache', '.m2', '.nuget', '__pycache__', 'site-packages', '.vscode-server', 'recovery', 'perflogs']);
/** Large AppData\Local and AppData\Roaming folders that hold browser profiles, Windows data and app stores. */
const SKIP_APPDATA = new Set(['packages', 'microsoft', 'google', 'mozilla', 'npm-cache', 'pip', 'yarn', 'docker', 'jetbrains']);
/** Photos, video, audio, office and disk-image files are checked after everything else. */
const BULK_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tif', '.tiff', '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.psd', '.ai', '.iso', '.img', '.vhd', '.vhdx', '.vmdk', '.ttf', '.otf', '.woff', '.woff2', '.svg', '.ico', '.db', '.sqlite', '.ldb', '.pak', '.assets', '.bundle']);
const FULL_PROGRAM_BYTES = 24 * 1024 * 1024, PART_BYTES = 4 * 1024 * 1024, MAX_TEXT_BYTES = 4 * 1024 * 1024, MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const HEAD_BYTES = 8192;
const WORTH_READING = /<CheatTable|dota2\.exe|dota 2 beta|ahk_exe|#IfWinActive|#HotIf|pydirectinput|pyautogui/i;

/** Likely drop folders first, then the whole profile (already-seen folders are skipped), Temp, other drives. */
export function defaultSweepRoots(home = homedir(), temp = process.env.TEMP || tmpdir()): SweepRoot[] {
  const roots: SweepRoot[] = [];
  const add = (folder: SweepFolder, path: string) => { if (existsSync(path) && !roots.some(root => root.path.toLowerCase() === path.toLowerCase())) roots.push({ folder, path }); };
  for (const base of [home, join(home, 'OneDrive')]) { add('Desktop', join(base, 'Desktop')); add('Documents', join(base, 'Documents')); }
  add('Downloads', join(home, 'Downloads'));
  add('Temp', temp);
  add('App data', join(home, 'AppData', 'Roaming'));
  add('App data', join(home, 'AppData', 'Local'));
  add('User folders', home);
  const system = (process.env.SystemDrive || 'C:').toUpperCase();
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') if (`${letter}:` !== system) add('Other drive', `${letter}:\\`);
  return roots;
}

async function readRange(path: string, size: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    if (size <= FULL_PROGRAM_BYTES || size <= PART_BYTES * 2) {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      return buffer.subarray(0, bytesRead);
    }
    // Large programs: the headers, sections table and imports sit at the start; the version resource near the end.
    const head = Buffer.alloc(PART_BYTES), tail = Buffer.alloc(PART_BYTES);
    const first = await handle.read(head, 0, PART_BYTES, 0);
    const last = await handle.read(tail, 0, PART_BYTES, size - PART_BYTES);
    return Buffer.concat([head.subarray(0, first.bytesRead), tail.subarray(0, last.bytesRead)]);
  } finally { await handle.close(); }
}

interface Candidate { path: string; name: string; folder: SweepFolder; traits: FileTraits; sha256?: string }

export async function sweepFolders(roots: SweepRoot[], policy: SweepPolicy, options: { limits?: Partial<SweepLimits>; signatures?: SignatureCheck; onProgress?: (state: { phase: string; entries: number; bytes: number; root: string }) => void } = {}): Promise<{ findings: SweepFinding[]; paths: string[]; status: Status; stats: { entries: number; bytes: number; deferred: number; signatureChecks: number } }> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const lists = { processes: policy.blockedProcesses, applications: policy.blockedApplications };
  const findings: SweepFinding[] = [];
  // Where each finding is, same order as findings. Kept on this PC (paths contain the Windows user name), so the
  // agent can drop a finding as soon as the player deletes the file.
  const paths: string[] = [];
  const unsigned: Candidate[] = [];
  const deferred: Array<{ path: string; name: string; folder: SweepFolder }> = [];
  const visited = new Set<string>();
  const deadline = Date.now() + limits.timeMs;
  let entries = 0, bytes = 0, readable = 0, status: Status = 'complete';
  const out = () => Date.now() > deadline;

  const add = (finding: SweepFinding, at: string) => {
    if (findings.length >= 50) { status = 'partial'; return; }
    if (!findings.some(item => item.name === finding.name && item.folder === finding.folder && item.reason === finding.reason)) { findings.push({ ...finding, name: finding.name.slice(0, 160) }); paths.push(at); }
  };

  // A small worker pool: file reads overlap, directory walking stays ordered.
  // Each file gets at most 5 seconds: cloud placeholders (OneDrive Files On-Demand), locked or special files
  // can block a read indefinitely. A file that times out makes the result partial.
  const running = new Set<Promise<void>>();
  const schedule = async (task: () => Promise<void>) => {
    while (running.size >= limits.concurrency) await Promise.race(running);
    const bounded = Promise.race([task(), new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000).unref())]).catch(error => { if ((error as Error).message === 'timeout') status = 'partial'; throw error; });
    const job: Promise<void> = bounded.catch(() => { /* Locked or removed while scanning; other files still count. */ }).finally(() => { running.delete(job); });
    running.add(job);
  };

  const inspect = async (path: string, name: string, folder: SweepFolder) => {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return;
    const handle = await open(path, 'r');
    let head: Buffer;
    try { const buffer = Buffer.alloc(HEAD_BYTES); head = buffer.subarray(0, (await handle.read(buffer, 0, HEAD_BYTES, 0)).bytesRead); }
    finally { await handle.close(); }
    const kind = sniff(head);
    if (kind === 'other') {
      if (/\.cetrainer$/i.test(name) && /dota/i.test(name)) add({ name, folder, reason: 'Cheat Engine trainer named for Dota 2', severity: 'high' }, path);
      return;
    }
    if (kind === 'text' && (info.size > MAX_TEXT_BYTES || !WORTH_READING.test(head.toString(head[0] === 0xff ? 'utf16le' : 'utf8')))) return;
    if (kind === 'zip' && info.size > MAX_ARCHIVE_BYTES) return;
    const want = kind === 'pe' ? Math.min(info.size, info.size <= FULL_PROGRAM_BYTES ? info.size : PART_BYTES * 2) : info.size;
    if (bytes + want > limits.maxBytes) { status = 'partial'; return; }
    bytes += want;
    const content = await readRange(path, info.size);
    const traits = analyzeContent(content);
    const whole = content.length === info.size;
    // Hashed only when needed: to compare with the staff list, or to attach to a finding so staff can add it to that list.
    let digest: string | undefined;
    const fingerprint = () => traits.kind !== 'text' && whole ? (digest ??= createHash('sha256').update(content).digest('hex')) : undefined;
    const listed = policy.blockedFileHashes.length ? fingerprint() : undefined;
    if (listed && policy.blockedFileHashes.includes(listed)) add({ name, folder, reason: 'Matches a staff file fingerprint', sha256: listed, severity: 'high' }, path);
    if (traits.kind === 'zip') {
      for (const verdict of judgeArchive(name, traits, lists)) add({ name: verdict.name, folder, reason: verdict.reason, ...(verdict.listedAs ? { listedAs: verdict.listedAs } : {}), severity: verdict.severity }, path);
      return;
    }
    // Name and internal-identity verdicts do not depend on a signature; behaviour verdicts wait for it.
    for (const verdict of judgeTraits(name, traits, lists, 'valid')) { const sha256 = fingerprint(); add({ name, folder, reason: verdict.reason, ...(verdict.listedAs ? { listedAs: verdict.listedAs } : {}), severity: verdict.severity, ...(sha256 ? { sha256 } : {}) }, path); }
    // The content is released after this function, so a file still waiting for its signature check keeps its fingerprint.
    if (needsSignature(traits)) { const sha256 = fingerprint(); unsigned.push({ path, name, folder, traits, ...(sha256 ? { sha256 } : {}) }); }
  };

  const visit = async (root: SweepRoot, path: string, relative: string[]): Promise<void> => {
    const key = path.toLowerCase().replace(/[\\/]+$/, '');
    if (visited.has(key)) return;
    visited.add(key);
    let children;
    try { children = await readdir(path, { withFileTypes: true }); }
    catch { if (relative.length) status = 'partial'; return; }
    if (!relative.length) readable++;
    const inAppData = root.folder === 'App data' ? relative.length === 0 : relative.length === 2 && relative[0].toLowerCase() === 'appdata';
    for (const child of children) {
      if (++entries > limits.maxEntries || out()) { status = 'partial'; return; }
      if (child.isSymbolicLink()) continue;
      const lower = child.name.toLowerCase();
      const childPath = join(path, child.name);
      if (child.isDirectory()) {
        if (SKIP_DIRS.has(lower) || (inAppData && SKIP_APPDATA.has(lower))) continue;
        if (lists.applications.some(match => matchesEntry(child.name, { match }))) add({ name: child.name, folder: root.folder, reason: 'Folder named like a listed tool', listedAs: child.name, severity: 'high' }, childPath);
        if (relative.length < limits.maxDepth) await visit(root, childPath, [...relative, child.name]);
        continue;
      }
      if (!child.isFile()) continue;
      if (BULK_EXT.has(extname(lower))) { if (deferred.length < 300_000) deferred.push({ path: childPath, name: child.name, folder: root.folder }); else status = 'partial'; continue; }
      await schedule(() => inspect(childPath, child.name, root.folder));
      progress('walk', path);
    }
  };
  let lastReport = 0;
  const progress = (phase: string, root: string) => { if (options.onProgress && Date.now() - lastReport > 10_000) { lastReport = Date.now(); options.onProgress({ phase, entries, bytes, root }); } };
  for (const root of roots) {
    if (out()) { status = 'partial'; break; }
    progress('walk', root.path);
    await visit(root, root.path, []);
  }
  // Renamed programs hidden as photos, videos or documents: checked with whatever time is left.
  for (const item of deferred) {
    if (out()) { status = 'partial'; break; }
    await schedule(() => inspect(item.path, item.name, item.folder));
  }
  await Promise.race([Promise.all(running), new Promise(done => setTimeout(done, 6_000).unref())]);
  if (running.size) status = 'partial';

  // Behaviour rules need the Authenticode result: a valid signature clears them. Unchecked files are not
  // reported (that would accuse signed software); they make the result partial instead.
  const signatureDeadline = Date.now() + 60_000;
  for (let index = 0; index < unsigned.length; index += 40) {
    if (Date.now() > signatureDeadline) { status = 'partial'; break; }
    const batch = unsigned.slice(index, index + 40);
    let results: Array<{ path: string; status: string }> = [];
    let checked = !!options.signatures;
    if (options.signatures) { try { results = await options.signatures(batch.map(item => item.path)); } catch { checked = false; status = 'partial'; } }
    for (const item of batch) {
      const result = results.find(row => row.path.toLowerCase() === item.path.toLowerCase());
      if (!checked || !result || result.status === 'Unreadable') { status = 'partial'; continue; }
      const signature: SignatureState = result.status === 'Valid' ? 'valid' : 'unsigned';
      for (const verdict of judgeTraits(item.name, { ...item.traits, identity: undefined }, { processes: [], applications: [] }, signature)) add({ name: item.name, folder: item.folder, reason: verdict.reason, severity: verdict.severity, ...(item.sha256 ? { sha256: item.sha256 } : {}) }, item.path);
    }
  }
  const stats = { entries, bytes, deferred: deferred.length, signatureChecks: unsigned.length };
  if (!readable) return { findings, paths, status: 'failed', stats };
  return { findings, paths, status, stats };
}
