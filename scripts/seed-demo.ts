/**
 * Loads clearly labelled DEMO tournaments into the Firestore emulator for demonstrations
 * (for example the defense, which must run without internet).
 * Every team name starts with "DEMO", every tournament carries demo: true, and the UI shows a DEMO label.
 *
 * Emulator only. Usage:
 *   firebase emulators:start --only auth,firestore --project demo-arenahub --config firebase.test.json
 *   node tests/seed-emulators.mjs        (QA accounts)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx scripts/seed-demo.ts
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createBracketFromTeams, updateMatchAndAdvance } from '../src/lib/bracketUtils';
import { toRosterDoc, toTournamentDoc } from '../src/lib/data/tournamentDocs';
import { DEFAULT_CATEGORIES, DEFAULT_GAMES } from '../src/lib/catalogDefaults';
import { INSTITUTION_COLLEGES } from '../src/lib/colleges';
import type { BracketDraft, Match, MatchFormat } from '../src/lib/types';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('seed-demo writes only to the Firestore emulator. Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8085.');
  process.exit(1);
}

const ROLES: Record<string, string[]> = {
  'game-mlbb': ['Gold Lane', 'EXP Lane', 'Mid Lane', 'Jungler', 'Roamer'],
  'game-dota2': ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'],
  'game-codm-mp': ['Slayer', 'Objective', 'Anchor', 'Flex', 'Support'],
};

function demoBracket(gameId: string, gameName: string, format: string, matchFormat: MatchFormat, size: number, day: string): BracketDraft {
  const colleges = INSTITUTION_COLLEGES.slice(0, size);
  const draft = createBracketFromTeams({
    title: `DEMO ${gameName} Cup`, gameName, format, matchFormat, finalMatchFormat: matchFormat,
    teams: colleges.map((c, i) => ({ name: `DEMO ${c.code} ${['Alpha', 'Titans', 'Pulse', 'Vanguard', 'Storm', 'Echo', 'Nova', 'Atlas'][i]}`, college: c.code, seed: i + 1 })),
  });
  const roles = ROLES[gameId] || ROLES['game-mlbb'];
  let matches: Match[] = draft.matches.map((m, i) => ({
    ...m, gameId, scheduledDate: day, scheduledTime: `${String(13 + (i % 6)).padStart(2, '0')}:00`,
    team1: m.team1 && !m.team1.isBye ? { ...m.team1, gameId, collegeCode: m.team1.collegeCode || colleges.find(c => m.team1!.name.includes(c.code))?.code || '', players: roles.map((role, p) => ({ id: `${m.team1!.id}-p${p}`, name: '', ign: `${m.team1!.name.split(' ')[1]}${role.split(' ')[0]}${p + 1}`, role, collegeId: '', isVerified: true })) } : m.team1,
    team2: m.team2 && !m.team2.isBye ? { ...m.team2, gameId, collegeCode: m.team2.collegeCode || colleges.find(c => m.team2!.name.includes(c.code))?.code || '', players: roles.map((role, p) => ({ id: `${m.team2!.id}-p${p}`, name: '', ign: `${m.team2!.name.split(' ')[1]}${role.split(' ')[0]}${p + 1}`, role, collegeId: '', isVerified: true })) } : m.team2,
  }));
  // Play out the first playable match and mark the next one live, so every page has something to show.
  const playable = () => matches.filter(m => m.status !== 'completed' && m.team1 && m.team2 && !m.team1.isBye && !m.team2.isBye && !m.inactive);
  const first = playable()[0];
  if (first) {
    const wins = Number(matchFormat.slice(2)) > 1 ? Math.ceil(Number(matchFormat.slice(2)) / 2) : 1;
    matches = updateMatchAndAdvance(matches, { ...first, score: { team1Score: wins, team2Score: wins - 1 }, status: 'completed', winnerId: first.team1!.id });
  }
  const live = playable()[0];
  if (live) matches = matches.map(m => m.id === live.id ? { ...m, status: 'live', score: { team1Score: 1, team2Score: 0 }, streamTitle: `${m.team1!.name} vs ${m.team2!.name}`,
    // The MLBB demo match carries a public sample broadcast so the watch page can be shown; the others stay
    // live without a broadcast, which is how Match center shows 'Starting soon'.
    ...(gameId === 'game-mlbb' ? { streamUrl: 'https://www.youtube.com/live/m4zQpYzzM0g' } : {}) } : m);
  return { ...draft, gameId, gameName, matches, status: 'published', demo: true };
}

if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-arenahub' });
const db = getFirestore();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const brackets = [
  demoBracket('game-mlbb', 'Mobile Legends: Bang Bang', 'Double Elimination', 'Bo3', 6, today),
  demoBracket('game-dota2', 'Dota 2', 'Single Elimination', 'Bo3', 5, today),
  demoBracket('game-codm-mp', 'CODM Multiplayer', 'Round Robin', 'Bo1', 4, today),
];
const batch = db.batch();
for (const bracket of brackets) {
  const tournament = toTournamentDoc(bracket, 1, { featured: bracket.gameId === 'game-mlbb' });
  batch.set(db.doc(`tournaments/${bracket.id}`), { ...tournament, updatedAt: FieldValue.serverTimestamp() });
  batch.set(db.doc(`tournaments/${bracket.id}/public/rosters`), toRosterDoc(bracket));
  // Replace any earlier demo for the same game so reruns do not pile up.
  const pub = await db.doc(`publications/${tournament.gameKey}`).get();
  const oldId = pub.data()?.currentId;
  if (oldId && oldId !== bracket.id) {
    const old = await db.doc(`tournaments/${oldId}`).get();
    if (old.exists) batch.update(old.ref, { status: 'archived', revision: Number(old.data()?.revision || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
  }
  batch.set(db.doc(`publications/${tournament.gameKey}`), { gameKey: tournament.gameKey, currentId: bracket.id, hasPrevious: false, revision: Number(pub.data()?.revision || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
}
batch.set(db.doc('config/catalog'), { games: DEFAULT_GAMES, categories: DEFAULT_CATEGORIES, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
await batch.commit();
console.log(`Loaded ${brackets.length} DEMO tournaments: ${brackets.map(b => b.title).join(', ')}`);
