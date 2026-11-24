// What a file IS, independent of its name and extension (agent 3.3).
//
// Renaming cheatengine.exe to chrome_helper.exe, or dota.CT to notes.txt, defeats name lists. This module
// looks at content instead:
//   - Windows programs and libraries (any extension, detected by their MZ/PE header): the internal identity
//     the build tool stamps into the file (OriginalFilename, ProductName, ...), whether the code names
//     dota2.exe, whether it contains the functions used to inject a DLL into another process, and whether
//     it is wrapped in a commercial protector (VMProtect, Themida, Enigma) that cheat sellers use to hide code;
//   - Cheat Engine tables and automation scripts (AutoHotkey, Python input libraries) that target dota2.exe;
//   - ZIP archives: entries are listed and, up to a size limit, decompressed in memory and analysed the same
//     way. Nothing is extracted to disk and nothing is ever executed.
import { inflateRawSync } from 'node:zlib';
import { matchesEntry } from '../../src/lib/integrityRisk';

export interface PeIdentity { originalFilename?: string; internalName?: string; productName?: string; fileDescription?: string; companyName?: string }
export interface FileTraits {
  kind: 'pe' | 'text' | 'zip' | 'other';
  identity?: PeIdentity;
  /** The content names dota2.exe or the Dota 2 install folder. */
  referencesDota: boolean;
  /** OpenProcess + VirtualAllocEx + WriteProcessMemory + a remote-thread/APC function: the classic DLL injector set. */
  injectionApis: boolean;
  /** Commercial protector or packer recognised from PE section names. */
  protector?: string;
  cheatTable: boolean;
  /** A text script with automation commands that targets dota2.exe. */
  automationScript: boolean;
  archive?: { entries: Array<{ name: string; traits?: FileTraits; encrypted?: boolean }>; truncated: boolean };
}

const DOTA_NEEDLES = ['dota2.exe', 'Dota2.exe', 'DOTA2.EXE', 'dota 2 beta', 'Dota 2 Beta'];
const DOTA_BUFFERS = DOTA_NEEDLES.flatMap(text => [Buffer.from(text, 'latin1'), Buffer.from(text, 'utf16le')]);
const INJECTION_REQUIRED = ['OpenProcess', 'VirtualAllocEx', 'WriteProcessMemory'].map(name => Buffer.from(name, 'latin1'));
const INJECTION_THREAD = ['CreateRemoteThread', 'NtCreateThreadEx', 'RtlCreateUserThread', 'QueueUserAPC'].map(name => Buffer.from(name, 'latin1'));
/** Section names that identify protectors/packers. UPX and MPRESS also wrap ordinary small tools. */
const PROTECTOR_SECTIONS: Record<string, string> = { '.vmp0': 'VMProtect', '.vmp1': 'VMProtect', '.vmp2': 'VMProtect', '.themida': 'Themida', '.winlice': 'Themida/WinLicense', '.enigma1': 'Enigma Protector', '.enigma2': 'Enigma Protector', UPX0: 'UPX', UPX1: 'UPX', '.mpress1': 'MPRESS', '.mpress2': 'MPRESS', '.aspack': 'ASPack' };
export const STRONG_PROTECTORS = new Set(['VMProtect', 'Themida', 'Themida/WinLicense', 'Enigma Protector']);
/**
 * A script that automates input for Dota: an AutoHotkey directive or window command naming dota2.exe at the start of a
 * line, or a Python script importing an input library. Requiring line-start structure keeps source code that only
 * quotes such text (for example a detector's own tests) from matching.
 */
const AHK_DOTA = /^[ \t]*(#IfWinActive|#HotIf|#IfWinExist|WinActivate|WinWaitActive|IfWinActive|ControlSend|SetTitleMatchMode)\b[^\r\n]*dota2\.exe/im;
const PY_INPUT = /^[ \t]*(import|from)[ \t]+(pydirectinput|pyautogui|interception|pynput|keyboard|mouse)\b/m;
const MAX_ARCHIVE_ENTRY = 32 * 1024 * 1024;

const contains = (buffer: Buffer, needles: Buffer[]) => needles.some(needle => buffer.indexOf(needle) >= 0);

export function sniff(head: Buffer): FileTraits['kind'] {
  if (head.length >= 64 && head[0] === 0x4d && head[1] === 0x5a) return 'pe';
  if (head.length >= 4 && head.readUInt32LE(0) === 0x04034b50) return 'zip';
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return 'text';
  const sample = head.subarray(0, 8192);
  if (sample.length && !sample.includes(0)) return 'text';
  return 'other';
}

/** Reads one VS_VERSIONINFO string value: UTF-16LE key, null, padding, then the UTF-16LE value. */
function versionValue(buffer: Buffer, key: string): string | undefined {
  const marker = Buffer.from(`${key}\0`, 'utf16le');
  let at = buffer.indexOf(marker);
  while (at >= 0 && at % 2 !== 0) at = buffer.indexOf(marker, at + 1);
  if (at < 0) return undefined;
  let start = at + marker.length;
  while (start + 1 < buffer.length && buffer.readUInt16LE(start) === 0 && start - at < marker.length + 8) start += 2;
  let end = start;
  while (end + 1 < buffer.length && buffer.readUInt16LE(end) !== 0 && end - start < 400) end += 2;
  const value = buffer.toString('utf16le', start, end).replace(/[^\x20-\x7e\u{a0}-\u{ffff}]/gu, '').trim();
  return value || undefined;
}

function peSections(buffer: Buffer): string[] {
  try {
    const pe = buffer.readUInt32LE(0x3c);
    if (pe + 24 > buffer.length || buffer.readUInt32LE(pe) !== 0x00004550) return [];
    const count = buffer.readUInt16LE(pe + 6), optional = buffer.readUInt16LE(pe + 20);
    const table = pe + 24 + optional;
    const names: string[] = [];
    for (let index = 0; index < Math.min(count, 96); index++) {
      const offset = table + index * 40;
      if (offset + 8 > buffer.length) break;
      names.push(buffer.toString('latin1', offset, offset + 8).replace(/\0+$/, ''));
    }
    return names;
  } catch { return []; }
}

function textOf(buffer: Buffer) {
  return buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString('utf16le', 2) : buffer.toString('utf8');
}

/** Lists a ZIP's central directory and analyses small, unencrypted entries in memory (deflate or stored). */
function readZip(buffer: Buffer, depth: number): FileTraits['archive'] {
  const entries: NonNullable<FileTraits['archive']>['entries'] = [];
  const tail = Math.max(0, buffer.length - 66_000);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < tail || end + 22 > buffer.length) return { entries, truncated: true };
  const total = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  let truncated = false;
  for (let index = 0; index < total; index++) {
    if (entries.length >= 200 || offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) { truncated = true; break; }
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength).slice(0, 200);
    offset += 46 + nameLength + extra + comment;
    if (name.endsWith('/')) continue;
    const encrypted = (flags & 1) === 1;
    let traits: FileTraits | undefined;
    if (!encrypted && size > 0 && size <= MAX_ARCHIVE_ENTRY && local + 30 <= buffer.length && buffer.readUInt32LE(local) === 0x04034b50) {
      const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(dataStart, dataStart + compressed);
      try {
        const content = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_ARCHIVE_ENTRY }) : null;
        if (content) traits = analyzeContent(content, depth + 1);
        else truncated = true;
      } catch { truncated = true; }
    } else if (!encrypted && size > MAX_ARCHIVE_ENTRY) truncated = true;
    entries.push({ name, ...(traits ? { traits } : {}), ...(encrypted ? { encrypted } : {}) });
  }
  return { entries, truncated };
}

/** Analyses a whole file's bytes. Archives are opened one level deep. */
export function analyzeContent(buffer: Buffer, depth = 0): FileTraits {
  const kind = sniff(buffer.subarray(0, 8192));
  const traits: FileTraits = { kind, referencesDota: contains(buffer, DOTA_BUFFERS), injectionApis: false, cheatTable: false, automationScript: false };
  if (kind === 'pe') {
    traits.injectionApis = INJECTION_REQUIRED.every(needle => buffer.indexOf(needle) >= 0) && contains(buffer, INJECTION_THREAD);
    const protector = peSections(buffer).map(name => PROTECTOR_SECTIONS[name]).find(Boolean);
    if (protector) traits.protector = protector;
    const identity: PeIdentity = {
      originalFilename: versionValue(buffer, 'OriginalFilename'), internalName: versionValue(buffer, 'InternalName'),
      productName: versionValue(buffer, 'ProductName'), fileDescription: versionValue(buffer, 'FileDescription'), companyName: versionValue(buffer, 'CompanyName'),
    };
    if (Object.values(identity).some(Boolean)) traits.identity = Object.fromEntries(Object.entries(identity).filter(([, value]) => value)) as PeIdentity;
  } else if (kind === 'text') {
    const text = textOf(buffer);
    // A real table is an XML document whose root element is CheatTable; source code that merely mentions it is not.
    // Dota first: ordinary XML never reaches the regex. Each comment is matched with a tempered token so it cannot
    // run past its own --> (the earlier lazy form backtracked exponentially on comment-heavy XML).
    traits.cheatTable = traits.referencesDota && /^\s*(<\?xml[^>]*>\s*)?(<!--(?:(?!-->)[\s\S])*-->\s*)*<CheatTable\b/i.test(text.slice(0, 65_536).replace(/^\u{feff}/u, ''));
    traits.automationScript = !traits.cheatTable && traits.referencesDota && (AHK_DOTA.test(text) || PY_INPUT.test(text));
  } else if (kind === 'zip' && depth === 0) {
    traits.archive = readZip(buffer, depth);
  }
  return traits;
}

export type SignatureState = 'valid' | 'unsigned' | 'unknown';
export interface ListPatterns { processes: string[]; applications: string[] }
export interface Verdict { reason: string; listedAs?: string; severity: 'low' | 'medium' | 'high' }

const listed = (value: string | undefined, patterns: string[]) => !!value && patterns.some(match => matchesEntry(value, { match }));

/** Does this file need its Authenticode signature checked before it can be judged? */
export const needsSignature = (traits: FileTraits) => traits.kind === 'pe' && (traits.referencesDota || traits.injectionApis || STRONG_PROTECTORS.has(traits.protector || ''));

/**
 * Turns content traits into findings. The same rules apply to files on disk, inside archives and to running
 * programs. A valid signature clears only the behaviour rules (Dota reference, injector functions, protector):
 * a signed copy of a listed tool is still that tool.
 */
export function judgeTraits(name: string, traits: FileTraits, lists: ListPatterns, signature: SignatureState): Verdict[] {
  const verdicts: Verdict[] = [];
  const unsignedNote = signature === 'unknown' ? ' (signature not checked)' : '';
  if (traits.kind === 'pe') {
    if (listed(name, lists.processes)) verdicts.push({ reason: 'Copy of a listed tool', listedAs: name, severity: 'high' });
    else {
      const id = traits.identity || {};
      const internal = [id.originalFilename, id.internalName].find(value => listed(value, lists.processes))
        || [id.productName, id.fileDescription].find(value => listed(value, lists.applications));
      if (internal) verdicts.push({ reason: `Renamed copy of a listed tool (its internal name is "${internal.slice(0, 80)}")`, listedAs: internal.slice(0, 120), severity: 'high' });
    }
    if (signature !== 'valid') {
      const behaviour: string[] = [];
      if (traits.referencesDota) behaviour.push('targets dota2.exe');
      if (traits.injectionApis) behaviour.push('contains DLL-injection functions');
      if (STRONG_PROTECTORS.has(traits.protector || '')) behaviour.push(`is wrapped in ${traits.protector}`);
      // Generic protector and debugger features appear in legitimate software and warrant review.
      if (behaviour.length && (traits.referencesDota || signature !== 'unknown')) verdicts.push({ reason: `Unsigned program that ${behaviour.join(', ')}${unsignedNote}`, severity: traits.referencesDota ? 'high' : 'low' });
    }
  } else if (traits.kind === 'text') {
    if (traits.cheatTable) verdicts.push({ reason: 'Cheat Engine table that targets dota2.exe', severity: 'high' });
    if (traits.automationScript) verdicts.push({ reason: 'Automation script (AutoHotkey or input macro) that targets dota2.exe', severity: 'high' });
  }
  return verdicts;
}

/** Findings for each entry of an archive. Entries cannot be signature-checked without extracting them. */
export function judgeArchive(archiveName: string, traits: FileTraits, lists: ListPatterns): Array<Verdict & { name: string }> {
  const out: Array<Verdict & { name: string }> = [];
  for (const entry of traits.archive?.entries || []) {
    const base = entry.name.split('/').pop() || entry.name;
    const label = `${archiveName} > ${entry.name}`.slice(0, 160);
    if (entry.traits) for (const verdict of judgeTraits(base, entry.traits, lists, 'unknown')) out.push({ ...verdict, name: label });
    else if (listed(base, lists.processes) || /\.(ct|cetrainer)$/i.test(base)) out.push({ reason: entry.encrypted ? 'Password-protected archive entry named like a listed tool or cheat table' : 'Archive entry named like a listed tool or cheat table', ...(listed(base, lists.processes) ? { listedAs: base } : {}), severity: 'high', name: label });
  }
  return out;
}
