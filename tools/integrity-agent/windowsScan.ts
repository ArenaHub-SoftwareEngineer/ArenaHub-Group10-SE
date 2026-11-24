// Read-only Windows observations. Full inventories stay local; only configured matches are reported.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { matchesEntry } from '../../src/lib/integrityRisk';
import { analyzeContent, judgeTraits, needsSignature, type FileTraits, type SignatureState } from './fileIntel';

const run = promisify(execFile);
export interface WindowsProcess { name: string; pid: number; path?: string }
export interface InstalledApplication { name: string; version?: string }
export interface WindowsModule { name: string; path?: string }
export interface ScanPolicy { blockedProcesses: string[]; blockedApplications: string[]; blockedFileHashes: string[]; blockedModules?: string[] }
type Status = 'complete' | 'partial' | 'failed' | 'not-configured' | 'not-running';
export interface ModuleSignature { path: string; status: string; signer: string }
export interface WindowsObservation {
  processes: Array<{ name: string; path?: string; sha256?: string }>;
  installedApplications: InstalledApplication[];
  loadedModules: Array<{ name: string; process: 'dota2.exe'; sha256?: string }>;
  untrustedModules: Array<{ name: string; status: string; signer?: string; sha256?: string }>;
  /** Running programs from user folders whose content is a renamed listed tool, or unsigned cheat-like code. */
  suspiciousPrograms: Array<{ name: string; reason: string; listedAs?: string; severity: 'low' | 'medium' | 'high'; sha256?: string }>;
  gameRunning: boolean;
  checks: { processes: Status; installedApplications: Status; fileHashes: Status; modules: Status; moduleSigners: Status; programContent: Status };
}

/** Folders whose libraries are not signature-checked: Windows, Program Files and the audited game install. */
export function defaultTrustedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.SystemRoot || env.windir, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter((value): value is string => !!value);
}
const under = (path: string, roots: string[]) => {
  const value = path.toLowerCase().replaceAll('/', '\\');
  return roots.some(root => { const base = root.toLowerCase().replaceAll('/', '\\').replace(/\\+$/, ''); return !!base && value.startsWith(base + '\\'); });
};

const PROCESS_SCRIPT = `Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object @{n='name';e={$_.Name}},@{n='pid';e={$_.ProcessId}},@{n='path';e={$_.ExecutablePath}} | ConvertTo-Json -Compress`;
const INSTALLED_SCRIPT = `$ErrorActionPreference='Stop'
$roots=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKCU:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
$items=@(foreach($root in $roots){if(Test-Path -LiteralPath $root){Get-ChildItem -LiteralPath $root | ForEach-Object {Get-ItemProperty -LiteralPath $_.PSPath} | Where-Object {$_.DisplayName} | Select-Object @{n='name';e={$_.DisplayName}},@{n='version';e={$_.DisplayVersion}}}})
ConvertTo-Json -InputObject $items -Compress`;

export function parseInventory<T>(json: string, parse: (row: Record<string, unknown>) => T | null): T[] {
  const value: unknown = JSON.parse(json.trim() || '[]');
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  if (rows.length > 5000) throw new Error('Inventory exceeded its inspection limit.');
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const item = parse(row as Record<string, unknown>);
    return item ? [item] : [];
  });
}

const matches = (name: string, patterns: string[]) => patterns.some(match => matchesEntry(name, { match }));
export function listedApplications(apps: InstalledApplication[], patterns: string[]): InstalledApplication[] {
  const seen = new Set<string>();
  return apps.filter(app => matches(app.name, patterns) && !seen.has(app.name.toLowerCase()) && seen.add(app.name.toLowerCase()));
}

const MAX_BINARY_BYTES = 128 * 1024 * 1024;
/** Hash only a running executable's regular file, with a hard byte limit and no execution. */
export async function executableHash(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BINARY_BYTES) throw new Error('Executable is unavailable or exceeds the inspection limit.');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > MAX_BINARY_BYTES) throw new Error('Executable changed beyond the inspection limit.');
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export interface WindowsScanProvider {
  processes(): Promise<WindowsProcess[]>;
  applications(): Promise<InstalledApplication[]>;
  hash(path: string): Promise<string>;
  modules?(processIds: number[]): Promise<{ modules: WindowsModule[]; failed: number }>;
  /** Authenticode status of local library files. */
  signatures?(paths: string[]): Promise<ModuleSignature[]>;
}

export const windowsProvider: WindowsScanProvider = {
  async signatures(paths) {
    if (!paths.length) return [];
    if (paths.length > 40) throw new Error('Too many libraries for one signature check.');
    // Paths come from the local module inventory. They reach PowerShell as base64 JSON, never as script text.
    const encoded = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64');
    const script = `$ErrorActionPreference='Stop'
$paths=ConvertFrom-Json -InputObject ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))
$rows=@(foreach($p in $paths){ try { $s=Get-AuthenticodeSignature -LiteralPath $p -ErrorAction Stop; $n=''; if($s.SignerCertificate){ $n=$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) }; [pscustomobject]@{path=[string]$p;status=[string]$s.Status;signer=[string]$n} } catch { [pscustomobject]@{path=[string]$p;status='Unreadable';signer=''} } })
ConvertTo-Json -InputObject $rows -Compress -Depth 3`;
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ' + script], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    return parseInventory<ModuleSignature>(stdout, row => typeof row.path === 'string' && typeof row.status === 'string'
      ? { path: row.path, status: row.status.slice(0, 40), signer: typeof row.signer === 'string' ? row.signer.slice(0, 120) : '' } : null);
  },
  async modules(processIds) {
    if (!processIds.length || processIds.length > 8 || processIds.some(id => !Number.isSafeInteger(id) || id <= 4)) throw new Error('Invalid game process selection.');
    // Numeric process IDs come from the local process inventory. No player-supplied shell text is used.
    const script = `$ErrorActionPreference='Stop'
$moduleRows=[System.Collections.Generic.List[object]]::new()
$failed=0
foreach($scanProcessId in @(${processIds.join(',')})) {
  try {
    $target=Get-Process -Id $scanProcessId -ErrorAction Stop
    foreach($module in $target.Modules) {
      if($moduleRows.Count -ge 5000) { $failed++; break }
      $moduleRows.Add([pscustomobject]@{name=$module.ModuleName;path=$module.FileName})
    }
  } catch { $failed++ }
}
[pscustomobject]@{modules=$moduleRows.ToArray();failed=$failed} | ConvertTo-Json -Compress -Depth 4`;
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ' + script], { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    const result = JSON.parse(stdout);
    if (!Number.isInteger(result.failed) || result.failed < 0 || !Array.isArray(result.modules)) throw new Error('Game module inspection returned invalid coverage.');
    const modules = parseInventory<WindowsModule>(JSON.stringify(result.modules), row => typeof row.name === 'string' && row.name
      ? { name: row.name, ...(typeof row.path === 'string' && row.path ? { path: row.path } : {}) } : null);
    // A running game with no visible modules has not been inspected successfully.
    return { modules, failed: result.failed || (modules.length ? 0 : processIds.length) };
  },
  async processes() {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ' + PROCESS_SCRIPT], { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    return parseInventory(stdout, row => typeof row.name === 'string' && Number.isInteger(row.pid)
      ? { name: row.name, pid: row.pid as number, ...(typeof row.path === 'string' && row.path ? { path: row.path } : {}) } : null);
  },
  async applications() {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ' + INSTALLED_SCRIPT], { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    return parseInventory(stdout, row => typeof row.name === 'string' && row.name.trim()
      ? { name: row.name.trim().slice(0, 200), ...(typeof row.version === 'string' ? { version: row.version.slice(0, 200) } : {}) } : null);
  },
  hash: executableHash,
};

/** Fingerprints are cached by path, size and modification time; no hash scans run unless configured. */
export function createWindowsScanner(provider: WindowsScanProvider = windowsProvider, options: { trustedRoots?: () => string[] } = {}) {
  const cache = new Map<string, { key: string; hash: string; at: number }>();
  const signatureCache = new Map<string, { key: string; signature: ModuleSignature }>();
  const contentCache = new Map<string, { key: string; traits: FileTraits; sha256: string }>();
  const fileKey = async (path: string) => { const info = await stat(path); return `${info.size}:${info.mtimeMs}`; };
  let installedCache: { at: number; apps: InstalledApplication[] } | undefined;
  const hash = async (path: string) => {
    const info = await stat(path);
    const key = `${info.size}:${info.mtimeMs}`;
    const cached = cache.get(path);
    if (cached?.key === key && Date.now() - cached.at < 60_000) return cached.hash;
    const value = await provider.hash(path);
    if (cache.size > 512) cache.clear();
    cache.set(path, { key, hash: value, at: Date.now() });
    return value;
  };
  return async (policy: ScanPolicy): Promise<WindowsObservation> => {
    const inspectModules = !!policy.blockedModules?.length || !!policy.blockedFileHashes.length;
    const checkSigners = !!provider.signatures;
    const observation: WindowsObservation = { processes: [], installedApplications: [], loadedModules: [], untrustedModules: [], suspiciousPrograms: [], gameRunning: false, checks: { programContent: 'complete', processes: 'complete', installedApplications: 'complete', fileHashes: policy.blockedFileHashes.length ? 'complete' : 'not-configured', modules: inspectModules ? 'not-running' : 'not-configured', moduleSigners: checkSigners ? 'not-running' : 'not-configured' } };
    const applications = async () => {
      if (installedCache && Date.now() - installedCache.at < 60_000) return installedCache.apps;
      const apps = await provider.applications();
      installedCache = { at: Date.now(), apps }; return apps;
    };
    const results = await Promise.allSettled([provider.processes(), applications()]);
    const processes = results[0].status === 'fulfilled' ? results[0].value : [];
    if (results[0].status === 'rejected') observation.checks.processes = 'failed';
    if (results[1].status === 'rejected') observation.checks.installedApplications = 'failed';
    else {
      const listed = listedApplications(results[1].value, policy.blockedApplications);
      if (listed.length > 100) observation.checks.installedApplications = 'partial';
      observation.installedApplications = listed.slice(0, 100);
    }
    observation.gameRunning = processes.some(process => process.name.toLowerCase() === 'dota2.exe');
    if (results[0].status === 'fulfilled') await checkProgramContent(processes, policy, observation);
    else observation.checks.programContent = 'failed';
    const paths = new Map<string, string | null>();
    const hashDeadline = Date.now() + 8_000;
    for (const process of processes) {
      let sha256: string | undefined;
      if (policy.blockedFileHashes.length && process.pid > 4) {
        if (!process.path || Date.now() > hashDeadline) observation.checks.fileHashes = 'partial';
        else {
          if (!paths.has(process.path)) {
            try { paths.set(process.path, await hash(process.path)); }
            catch { paths.set(process.path, null); observation.checks.fileHashes = 'partial'; }
          }
          sha256 = paths.get(process.path) || undefined;
        }
      }
      if (!matches(process.name, policy.blockedProcesses) && !(sha256 && policy.blockedFileHashes.includes(sha256))) continue;
      if (observation.processes.length >= 50) { observation.checks.processes = 'partial'; break; }
      observation.processes.push({ name: process.name.slice(0, 200), ...(process.path ? { path: process.path.slice(0, 400) } : {}), ...(sha256 ? { sha256 } : {}) });
    }
    if ((inspectModules || checkSigners) && observation.gameRunning) {
      let inspected: { modules: WindowsModule[]; failed: number };
      try {
        if (!provider.modules) throw new Error('Game module inspection is unavailable.');
        inspected = await provider.modules(processes.filter(process => process.name.toLowerCase() === 'dota2.exe').map(process => process.pid));
      } catch {
        if (inspectModules) observation.checks.modules = 'failed';
        if (checkSigners) observation.checks.moduleSigners = 'failed';
        return observation;
      }
      if (checkSigners) await checkModuleSigners(inspected, observation);
      if (inspectModules) try {
        observation.checks.modules = inspected.failed ? 'partial' : 'complete';
        const moduleDeadline = Date.now() + 8_000;
        const seen = new Set<string>();
        for (const module of inspected.modules) {
          const key = (module.path || module.name).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          let sha256: string | undefined;
          if (policy.blockedFileHashes.length) {
            if (!module.path || Date.now() > moduleDeadline) observation.checks.modules = 'partial';
            else {
              try { sha256 = await hash(module.path); }
              catch { observation.checks.modules = 'partial'; }
            }
          }
          if (!matches(module.name, policy.blockedModules || []) && !(sha256 && policy.blockedFileHashes.includes(sha256))) continue;
          if (observation.loadedModules.length >= 50) { observation.checks.modules = 'partial'; break; }
          observation.loadedModules.push({ name: module.name.slice(0, 200), process: 'dota2.exe', ...(sha256 ? { sha256 } : {}) });
        }
      } catch { observation.checks.modules = 'failed'; }
    }
    return observation;
  };

  /**
   * Renamed tools and unknown cheats: running programs outside Windows, Program Files and the game folder are
   * judged by content (internal identity, Dota references, injector functions, protectors), not by name.
   */
  async function checkProgramContent(processes: WindowsProcess[], policy: ScanPolicy, observation: WindowsObservation) {
    const roots = [...defaultTrustedRoots(), ...(options.trustedRoots?.() || [])];
    const lists = { processes: policy.blockedProcesses, applications: policy.blockedApplications };
    const deadline = Date.now() + 10_000;
    const pending: Array<{ path: string; name: string; traits: FileTraits; sha256: string; key: string }> = [];
    const seen = new Set<string>();
    for (const process of processes) {
      if (!process.path || process.pid <= 4 || under(process.path, roots) || seen.has(process.path.toLowerCase())) continue;
      seen.add(process.path.toLowerCase());
      if (Date.now() > deadline) { observation.checks.programContent = 'partial'; break; }
      let entry;
      try {
        const key = await fileKey(process.path);
        entry = contentCache.get(process.path.toLowerCase());
        if (entry?.key !== key) {
          const info = await stat(process.path);
          if (info.size > 64 * 1024 * 1024) continue;
          const content = await readFile(process.path);
          entry = { key, traits: analyzeContent(content), sha256: createHash('sha256').update(content).digest('hex') };
          if (contentCache.size > 512) contentCache.clear();
          contentCache.set(process.path.toLowerCase(), entry);
        }
      } catch { observation.checks.programContent = 'partial'; continue; }
      // A listed process name is already reported as blocked-process; this adds what the name hides.
      for (const verdict of judgeTraits(process.name, entry.traits, lists, 'valid')) if (!verdict.reason.startsWith('Copy of')) pushProgram(observation, { name: process.name, ...verdict, sha256: entry.sha256 });
      if (needsSignature(entry.traits)) pending.push({ path: process.path, name: process.name, traits: entry.traits, sha256: entry.sha256, key: entry.key });
    }
    if (!pending.length) return;
    let signed: ModuleSignature[] = [];
    try {
      const unknown = pending.filter(item => signatureCache.get(item.path.toLowerCase())?.key !== item.key);
      for (let index = 0; index < unknown.length; index += 40) {
        if (!provider.signatures) break;
        const batch = unknown.slice(index, index + 40);
        const rows = await provider.signatures(batch.map(item => item.path));
        for (const item of batch) signatureCache.set(item.path.toLowerCase(), { key: item.key, signature: rows.find(row => row.path.toLowerCase() === item.path.toLowerCase()) || { path: item.path, status: 'Unreadable', signer: '' } });
      }
      signed = pending.map(item => signatureCache.get(item.path.toLowerCase())?.signature).filter((row): row is ModuleSignature => !!row);
    } catch { observation.checks.programContent = 'partial'; }
    for (const item of pending) {
      const row = signed.find(entry => entry.path.toLowerCase() === item.path.toLowerCase());
      const state: SignatureState = !row || row.status === 'Unreadable' ? 'unknown' : row.status === 'Valid' ? 'valid' : 'unsigned';
      for (const verdict of judgeTraits(item.name, { ...item.traits, identity: undefined }, { processes: [], applications: [] }, state)) pushProgram(observation, { name: item.name, ...verdict, sha256: item.sha256 });
    }
  }
  function pushProgram(observation: WindowsObservation, finding: WindowsObservation['suspiciousPrograms'][number]) {
    if (observation.suspiciousPrograms.length >= 50) { observation.checks.programContent = 'partial'; return; }
    observation.suspiciousPrograms.push({ ...finding, name: finding.name.slice(0, 200), reason: finding.reason.slice(0, 200) });
  }

  /** Libraries loaded from user-writable folders must carry a valid Authenticode signature. */
  async function checkModuleSigners(inspected: { modules: WindowsModule[]; failed: number }, observation: WindowsObservation) {
    const roots = [...defaultTrustedRoots(), ...(options.trustedRoots?.() || [])];
    const candidates = [...new Map(inspected.modules.filter(module => module.path && !under(module.path, roots)).map(module => [module.path!.toLowerCase(), module.path!])).values()];
    let status: Status = inspected.failed || inspected.modules.some(module => !module.path) ? 'partial' : 'complete';
    const results: ModuleSignature[] = [];
    const unknown: Array<{ path: string; key: string }> = [];
    for (const path of candidates.slice(0, 200)) {
      try {
        const key = await fileKey(path);
        const hit = signatureCache.get(path.toLowerCase());
        if (hit?.key === key) results.push(hit.signature); else unknown.push({ path, key });
      } catch { results.push({ path, status: 'Unreadable', signer: '' }); }
    }
    if (candidates.length > 200) status = 'partial';
    try {
      for (let index = 0; index < unknown.length; index += 40) {
        const batch = unknown.slice(index, index + 40);
        const signed = await provider.signatures!(batch.map(item => item.path));
        for (const item of batch) {
          const signature = signed.find(row => row.path.toLowerCase() === item.path.toLowerCase()) || { path: item.path, status: 'Unreadable', signer: '' };
          if (signatureCache.size > 1024) signatureCache.clear();
          signatureCache.set(item.path.toLowerCase(), { key: item.key, signature });
          results.push(signature);
        }
      }
    } catch { observation.checks.moduleSigners = 'failed'; return; }
    for (const signature of results) {
      if (signature.status === 'Valid') continue;
      if (signature.status === 'Unreadable') status = 'partial';
      if (observation.untrustedModules.length >= 50) { status = 'partial'; break; }
      let sha256: string | undefined;
      try { sha256 = await hash(signature.path); } catch { /* The name and status are still reported. */ }
      const name = signature.path.split(/[\\/]/).pop() || 'unknown';
      observation.untrustedModules.push({ name: name.slice(0, 200), status: signature.status, ...(signature.signer ? { signer: signature.signer } : {}), ...(sha256 ? { sha256 } : {}) });
    }
    observation.checks.moduleSigners = status;
  }
}
