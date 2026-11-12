/**
 * One-time migration from the single-document stores (arenahub/brackets, arenahub/workspace)
 * to the per-tournament layout in src/lib/data/tournamentDocs.ts.
 *
 * Safe by default:
 *   - runs only against the Firestore emulator unless --project <id> --confirm-production is given
 *   - --dry-run prints what would be written and writes nothing
 *   - idempotent: tournaments that already exist are skipped
 *   - never deletes the source documents, which stay as the rollback copy
 *
 * Usage (emulator):  FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx scripts/migrate-brackets.ts --project demo-arenahub [--dry-run]
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { publicationGameKey } from '../src/lib/bracketPublication';
import { toRosterDoc, toTournamentDoc, assertDocSize } from '../src/lib/data/tournamentDocs';
import type { BracketDraft } from '../src/lib/types';

export interface MigrationReport { tournaments: string[]; skipped: string[]; previous: string[]; catalog: boolean; featuredFlags: string[]; notes: string[] }

export async function migrate(db: Firestore, { dryRun = false } = {}): Promise<MigrationReport> {
  const report: MigrationReport = { tournaments: [], skipped: [], previous: [], catalog: false, featuredFlags: [], notes: [] };
  const brackets = (await db.doc('arenahub/brackets').get()).data() || {};
  const workspace = (await db.doc('arenahub/workspace').get()).data() || {};
  const published: BracketDraft[] = Array.isArray(brackets.publishedBrackets) ? brackets.publishedBrackets : [];
  const previous: BracketDraft[] = Array.isArray(brackets.previousPublishedBrackets) ? brackets.previousPublishedBrackets : [];
  const featuredIds = new Set<string>((Array.isArray(workspace.tournaments) ? workspace.tournaments : []).filter((t: any) => t?.isFeatured).map((t: any) => String(t.id)));
  const batch = db.batch();

  for (const bracket of published) {
    const ref = db.doc(`tournaments/${bracket.id}`);
    if ((await ref.get()).exists) { report.skipped.push(bracket.id); continue; }
    const tournament = toTournamentDoc({ ...bracket, status: 'published' }, 1, { featured: featuredIds.has(bracket.id) });
    const roster = toRosterDoc(bracket);
    assertDocSize(tournament, `Bracket ${bracket.id}`); assertDocSize(roster, `Roster ${bracket.id}`);
    batch.set(ref, { ...tournament, updatedAt: FieldValue.serverTimestamp() });
    batch.set(db.doc(`tournaments/${bracket.id}/public/rosters`), roster);
    const key = publicationGameKey(bracket);
    const prior = previous.find(p => publicationGameKey(p) === key);
    if (prior) {
      batch.set(db.doc(`publications/${key}/previous/tournament`), toTournamentDoc({ ...prior, status: 'published' }, 1));
      batch.set(db.doc(`publications/${key}/previous/rosters`), toRosterDoc(prior));
      report.previous.push(prior.id);
    }
    batch.set(db.doc(`publications/${key}`), { gameKey: key, currentId: bracket.id, hasPrevious: !!prior, revision: 1, updatedAt: FieldValue.serverTimestamp() });
    if (featuredIds.has(bracket.id)) report.featuredFlags.push(bracket.id);
    report.tournaments.push(bracket.id);
  }

  const catalogRef = db.doc('config/catalog');
  if (!(await catalogRef.get()).exists && (Array.isArray(workspace.games) || Array.isArray(workspace.categories))) {
    batch.set(catalogRef, { games: workspace.games || [], categories: workspace.categories || [], updatedAt: FieldValue.serverTimestamp() });
    report.catalog = true;
  }
  const oldItems = [...(workspace.featuredHighlights || []), ...(workspace.featuredPosts || [])];
  if (oldItems.length) report.notes.push(`${oldItems.length} old spotlight item(s) were not migrated: they have no link or author. Re-add real items in Featured.`);
  if (brackets.savedBracketDraft) report.notes.push('A shared cloud draft exists in arenahub/brackets. Drafts are now per organizer; open and save it again from Bracket Studio.');

  if (!dryRun) await batch.commit();
  return report;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  const projectId = arg('--project') || 'demo-arenahub';
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulator && !process.argv.includes('--confirm-production')) {
    console.error('Refusing to run without FIRESTORE_EMULATOR_HOST. To migrate a real project, pass --project <id> --confirm-production after Kerr approves it.');
    process.exit(1);
  }
  if (!getApps().length) initializeApp({ projectId });
  const report = await migrate(getFirestore(), { dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify({ projectId, emulator, dryRun: process.argv.includes('--dry-run'), ...report }, null, 2));
}
