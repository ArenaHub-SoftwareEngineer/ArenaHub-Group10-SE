// Round-trips the legacy single-document bracket into the per-tournament layout. Emulator only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { migrate } from '../scripts/migrate-brackets';
import { createBracketFromTeams, updateMatchAndAdvance } from '../src/lib/bracketUtils';
import { fromDocs, fingerprint, toTournamentDoc, type RosterDoc, type TournamentDoc } from '../src/lib/data/tournamentDocs';

test('migration copies the published QA bracket, keeps the source, and is idempotent', async () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
  const app = getApps()[0] || initializeApp({ projectId: 'demo-arenahub-migration' }, 'migration');
  const db = getFirestore(app);
  for (const path of ['arenahub/brackets', 'arenahub/workspace', 'config/catalog']) await db.doc(path).delete();

  const base = createBracketFromTeams({ title: 'QA Migration Cup', gameName: 'Dota 2', format: 'Single Elimination', matchFormat: 'Bo3', teams: ['A', 'B', 'C', 'D'].map((name, i) => ({ name: `QA ${name}`, college: 'CCS', seed: i + 1 })) });
  const withPlayers = { ...base, gameId: 'game-dota2', status: 'published' as const, matches: base.matches.map(m => ({ ...m, team1: m.team1 && { ...m.team1, players: [{ id: `${m.team1.id}-p`, name: 'Private Name', ign: `${m.team1.name} IGN`, role: 'Carry', collegeId: '', isVerified: true, studentId: '2024-1' }] }, team2: m.team2 && { ...m.team2, players: [] } })) };
  const first = withPlayers.matches.find(m => m.team1 && m.team2)!;
  const scored = { ...withPlayers, matches: updateMatchAndAdvance(withPlayers.matches, { ...first, score: { team1Score: 2, team2Score: 1 }, status: 'completed', winnerId: first.team1!.id }) };
  const older = { ...scored, id: 'qa-migration-old', title: 'QA Migration Cup (old)' };
  for (const id of [scored.id, older.id]) await db.recursiveDelete(db.doc(`tournaments/${id}`));
  await db.recursiveDelete(db.doc('publications/game-dota2'));
  await db.doc('arenahub/brackets').set(JSON.parse(JSON.stringify({ publishedBrackets: [scored], previousPublishedBrackets: [older], publicationRevision: 4 })));
  await db.doc('arenahub/workspace').set({ games: [{ id: 'game-dota2', name: 'Dota 2' }], categories: ['MOBA'], tournaments: [{ id: scored.id, isFeatured: true }], featuredHighlights: [{ id: 'h1', title: 'Old', meta: '2.1k views' }], featuredPosts: [] });

  const dry = await migrate(db, { dryRun: true });
  assert.deepEqual(dry.tournaments, [scored.id]);
  assert.equal((await db.doc(`tournaments/${scored.id}`).get()).exists, false, 'dry run writes nothing');

  const report = await migrate(db);
  assert.deepEqual(report.tournaments, [scored.id]);
  assert.deepEqual(report.previous, [older.id]);
  assert.deepEqual(report.featuredFlags, [scored.id]);
  assert.equal(report.catalog, true);
  assert.match(report.notes.join(' '), /spotlight item/);

  const tournament = (await db.doc(`tournaments/${scored.id}`).get()).data() as TournamentDoc;
  const roster = (await db.doc(`tournaments/${scored.id}/public/rosters`).get()).data() as RosterDoc;
  assert.equal(tournament.status, 'published');
  assert.equal(tournament.featured, true);
  const rebuilt = fromDocs(tournament, roster);
  assert.equal(fingerprint(toTournamentDoc(rebuilt, 1).matches), fingerprint(toTournamentDoc(scored, 1).matches), 'match graph, scores and advancement survive');
  assert.doesNotMatch(JSON.stringify([tournament, roster]), /Private Name|2024-1|studentId/);
  assert.equal((await db.doc('publications/game-dota2').get()).data()?.currentId, scored.id);
  assert.equal((await db.doc('publications/game-dota2/previous/tournament').get()).data()?.id, older.id);
  assert.ok((await db.doc('arenahub/brackets').get()).exists, 'the source document stays as the rollback copy');

  const again = await migrate(db);
  assert.deepEqual(again.tournaments, []);
  assert.deepEqual(again.skipped, [scored.id]);
});
