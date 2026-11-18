// A Fair play case reduced to what a referee needs to read first, with personal data removed.
//
// Used twice: the server sends this digest (never the raw case) to the Groq model for a written summary,
// and the browser shows it as is when no model is configured. Plan Q5 (answered 16 Nov 2026): case text
// goes to Groq only, never the free Gemini tier, and never with reporter or reviewer account ids.

export interface DigestCase {
  matchId: string;
  reason: string;
  details: string;
  status: string;
  resolution?: string;
  evidenceUrl?: string;
  evidenceFiles?: Array<{ mime?: string; name?: string }>;
  createdAt?: unknown;
}
export interface DigestEvent { action?: string; note?: string; frames?: unknown[]; createdAt?: unknown }

export interface CaseDigest {
  matchLabel: string;
  reason: string;
  status: string;
  submitted: string;
  evidence: string[];
  report: string;
  history: string[];
  decision: string;
  /** The digest as plain text, the model's only input. */
  text: string;
}

/** Removes contact details and identifiers that could name a person outside the public roster. */
export function scrubPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email removed]')
    .replace(/https?:\/\/\S+/gi, '[link]')
    // Philippine mobile numbers and other long digit runs (phone numbers, student IDs such as 2021-01234).
    .replace(/(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, '[number removed]')
    .replace(/\b\d{4}-\d{4,6}\b/g, '[ID removed]')
    .replace(/\b\d{7,}\b/g, '[number removed]')
    .replace(/\s+/g, ' ')
    .trim();
}

const when = (value: unknown): string => {
  const seconds = (value as { seconds?: number } | null)?.seconds;
  const date = typeof seconds === 'number' ? new Date(seconds * 1000)
    : value instanceof Date ? value
    : typeof (value as { toDate?: () => Date } | null)?.toDate === 'function' ? (value as { toDate: () => Date }).toDate()
    : typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'time not recorded';
};

const ACTIONS: Record<string, string> = {
  reviewing: 'Review started', resolved: 'Case resolved', dismissed: 'Concern dismissed', 'video-review': 'Video review saved',
  'appeal-open': 'Review requested by reporter', 'appeal-accepted': 'Review request accepted', 'appeal-rejected': 'Decision kept after review request',
};

export function buildCaseDigest(record: DigestCase, events: DigestEvent[], matchLabel: string): CaseDigest {
  const files = record.evidenceFiles || [];
  const evidence = [
    ...files.map(file => (file.mime || '').startsWith('video/') ? 'Video recording (private)' : (file.mime || '').startsWith('image/') ? 'Screenshot (private)' : 'Attached file (private)'),
    ...(record.evidenceUrl ? [`External link on ${(() => { try { return new URL(record.evidenceUrl).hostname.replace(/^www\./, ''); } catch { return 'an outside site'; } })()}`] : []),
  ];
  const history = events.map(event => {
    const label = ACTIONS[event.action || ''] || (event.action || 'Update').replaceAll('-', ' ');
    const note = event.note ? `: ${scrubPersonal(event.note).slice(0, 400)}` : '';
    const frames = Array.isArray(event.frames) && event.frames.length ? ` (${event.frames.length} saved frame observations)` : '';
    return `${when(event.createdAt)} · ${label}${note}${frames}`;
  });
  const report = scrubPersonal(record.details).slice(0, 2000);
  const decision = record.resolution ? scrubPersonal(record.resolution).slice(0, 800) : 'No decision recorded yet.';
  const digest = {
    matchLabel: matchLabel || 'Match not found in published brackets',
    reason: record.reason,
    status: record.status,
    submitted: when(record.createdAt),
    evidence: evidence.length ? evidence : ['No evidence attached'],
    report,
    history: history.length ? history : ['No staff actions recorded yet.'],
    decision,
  };
  const text = [
    `Match: ${digest.matchLabel}`, `Concern: ${digest.reason}`, `Status: ${digest.status}`, `Submitted: ${digest.submitted}`,
    `Evidence: ${digest.evidence.join('; ')}`, `Report: ${digest.report}`,
    `History:\n${digest.history.map(line => `- ${line}`).join('\n')}`, `Decision: ${digest.decision}`,
  ].join('\n');
  return { ...digest, text };
}
