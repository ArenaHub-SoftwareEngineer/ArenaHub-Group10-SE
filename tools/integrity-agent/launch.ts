// One-click start for the PC agent. Everything here only works out WHERE to scan from (server address,
// scan code, practice or official); it never decides consent. The official scan always shows the
// server and asks the player, because any website can open an arenahub:// link.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { monitorAddress } from '../../src/lib/monitorAddress';

export interface Launch { mode: 'practice' | 'scan'; server?: string; code?: string }
const CODE = /^[A-Z2-9]{8}$/;
const safeServer = (value: string | null | undefined) => { try { return value ? monitorAddress(value) : undefined; } catch { return undefined; } };

/** arenahub://practice?s=<server> or arenahub://scan?s=<server>&c=<code>, from the ArenaHub website. */
export function parseLaunchLink(link: string): Launch | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== 'arenahub:') return null;
  // Browsers may add a trailing slash: arenahub://practice/?s=...
  const mode = url.hostname.toLowerCase();
  if (mode !== 'practice' && mode !== 'scan') return null;
  const server = safeServer(url.searchParams.get('s'));
  const code = (url.searchParams.get('c') || '').toUpperCase();
  return { mode, ...(server ? { server } : {}), ...(mode === 'scan' && CODE.test(code) ? { code } : {}) };
}

/** The join page serves the agent as arenahub-scan-<CODE>.exe, so double-clicking the download knows the code. */
export function codeFromFileName(path: string): string {
  // Browsers add " (1)" to repeated downloads; the code is still in the name.
  const match = /arenahub-scan-([A-Z2-9]{8})/i.exec(basename(path));
  return match ? match[1].toUpperCase() : '';
}

/**
 * Windows records where a download came from in the file's Zone.Identifier stream (HostUrl=...).
 * The agent is downloaded from the tournament server itself, so that origin is the server address.
 */
export function serverFromZoneIdentifier(text: string): string | undefined {
  for (const key of ['HostUrl', 'ReferrerUrl']) {
    const value = new RegExp(`^${key}=(.+)$`, 'm').exec(text)?.[1]?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      // Only a download of the agent itself identifies a tournament server.
      if (key === 'HostUrl' && !url.pathname.startsWith('/api/integrity/downloads/')) continue;
      const origin = safeServer(url.origin);
      if (origin) return origin;
    } catch { /* Not a URL. */ }
  }
  return undefined;
}
export function downloadedFrom(exePath: string): string | undefined {
  try { return serverFromZoneIdentifier(readFileSync(`${exePath}:Zone.Identifier`, 'utf8')); } catch { return undefined; }
}

/** The last server that worked, so a player never types it twice. Stored per Windows user. */
const settingsFile = (appData = process.env.APPDATA || '') => join(appData, 'ArenaHub', 'agent.json');
export function rememberedServer(appData?: string): string | undefined {
  try { return safeServer(JSON.parse(readFileSync(settingsFile(appData), 'utf8')).server); } catch { return undefined; }
}
export function rememberServer(server: string, appData?: string) {
  const file = settingsFile(appData);
  if (!process.env.APPDATA && !appData) return;
  try { if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ server })); } catch { /* Convenience only. */ }
}

/**
 * The Dota 2 `game` folder from a running dota2.exe path (`<install>\game\bin\win64\dota2.exe`).
 * Computer shops often keep games on a separate drive or install them with shop software, so Steam's
 * library list may not include Dota 2. The running game shows where it really is.
 */
export function dotaGameDirFromExe(exePath: string | undefined): string | undefined {
  const match = exePath ? /^(.*[\\/]game)[\\/]bin[\\/]win64[\\/]dota2\.exe$/i.exec(exePath) : null;
  return match ? match[1] : undefined;
}

/** The packaged agent, not `node agent.cjs` during development. */
export const isPackaged = (execPath = process.execPath) => !/^node(\.exe)?$/i.test(basename(execPath));

/**
 * reg.exe arguments that let the ArenaHub website start this agent with one click (per user, no admin).
 * Re-run on every start, so a moved or re-downloaded agent stays the one the website opens.
 */
export function protocolRegistration(exePath: string): string[][] {
  const key = String.raw`HKCU\Software\Classes\arenahub`;
  return [
    ['add', key, '/ve', '/d', 'URL:ArenaHub Anti-cheat', '/f'],
    ['add', key, '/v', 'URL Protocol', '/d', '', '/f'],
    ['add', String.raw`${key}\shell\open\command`, '/ve', '/d', `"${exePath}" --link "%1"`, '/f'],
  ];
}
