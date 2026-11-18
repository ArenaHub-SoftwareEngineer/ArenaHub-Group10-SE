// Staff-only Fair play case summaries (plan Q5, answered 16 Nov 2026: Groq only, never the free Gemini tier).
//
// The model receives the scrubbed digest from src/lib/caseDigest.ts, never the stored case, so reporter and
// reviewer account ids, emails and evidence links do not leave this server. Without a Groq key the staff
// member gets the digest itself, labelled as such. Either way the text is a draft for a human referee.
import { getFirestore } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';
import { buildCaseDigest, type CaseDigest, type DigestCase, type DigestEvent } from '../../src/lib/caseDigest.ts';
import { cleanReply } from './sanitize.ts';
import type { Provider } from './provider.ts';

export interface CaseRecord { record: DigestCase; events: DigestEvent[]; matchLabel: string }
/** The token is the staff caller's, passed on to whatever reads published brackets for the match label. */
export type CaseReader = (caseId: string, token: string) => Promise<CaseRecord | null>;

export interface CaseSummary {
  summary: string;
  /** 'model': written by the Groq model from the digest. 'digest': no model was used. */
  source: 'model' | 'digest';
  digest: CaseDigest;
}

const SYSTEM = [
  'You help a school esports referee read a fair-play case quickly. You receive a case digest.',
  'Write 3 to 5 plain sentences: what was reported, what evidence exists, what staff have done, and what is still open.',
  'Use only facts in the digest. Do not judge guilt, recommend a penalty, or guess at anything not written there.',
  'If the evidence is thin or missing, say so plainly. No markdown, no lists, no emoji, no names of real people.',
].join(' ');

export async function summarizeCase(provider: Provider | undefined, found: CaseRecord, signal: AbortSignal): Promise<CaseSummary> {
  const digest = buildCaseDigest(found.record, found.events, found.matchLabel);
  if (!provider) return { summary: digest.text, source: 'digest', digest };
  let text = '';
  for await (const piece of provider.stream({ system: SYSTEM, history: [], question: `Case digest:\n${digest.text}`, tools: [], signal, maxOutputTokens: 400 })) {
    text += piece;
    if (text.length > 2400) break;
  }
  const summary = cleanReply(text, 1600).trim();
  return summary ? { summary, source: 'model', digest } : { summary: digest.text, source: 'digest', digest };
}

/** Reads one case, its history, and the public match label through the admin SDK. */
export function firestoreCaseReader(app: App, matchLabel: (matchId: string, token: string) => Promise<string>): CaseReader {
  return async (caseId, token) => {
    const db = getFirestore(app);
    const ref = db.collection('integrityCases').doc(caseId);
    const [snapshot, events] = await Promise.all([ref.get(), ref.collection('events').orderBy('createdAt').limit(50).get()]);
    if (!snapshot.exists) return null;
    const data = snapshot.data() as DigestCase;
    return {
      record: data,
      events: events.docs.map(doc => ({ action: doc.get('action'), note: doc.get('note'), frames: doc.get('frames'), createdAt: doc.get('createdAt') })),
      matchLabel: await matchLabel(String(data.matchId || ''), token),
    };
  };
}
