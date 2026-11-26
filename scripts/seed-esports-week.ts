/**
 * Publishes a full one-week intercollege tournament for testing: every college in institution.config.json
 * enters MLBB, Dota 2, CODM Multiplayer and CODM Battle Royale under the same team name, with full rosters
 * (public: IGN and role; staff-only: name, student ID, section, no school email) and a Monday-to-Friday schedule.
 * Nothing is started: every match is upcoming with no scores.
 *
 * It also deletes the old seeded demo tournaments (demo: true) and replaces the current publication per game.
 * A real (non-demo) tournament that is currently published is archived, never deleted.
 *
 * Usage:
 *   Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx scripts/seed-esports-week.ts
 *   Real site:  GOOGLE_APPLICATION_CREDENTIALS=<key> npx tsx scripts/seed-esports-week.ts --project <id> --confirm-production
 *   Add --dry-run to print the plan without writing. Add --monday YYYY-MM-DD to pick the week (default: next Monday).
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { createBracketFromTeams } from '../src/lib/bracketUtils';
import { createPlacementEvent, POINT_PRESETS } from '../src/lib/formats/placement';
import { toRosterDoc, toTournamentDoc, type PrivateRosterDoc } from '../src/lib/data/tournamentDocs';
import { publicationGameKey } from '../src/lib/bracketPublication';
import { INSTITUTION_COLLEGES } from '../src/lib/colleges';
import type { BracketDraft, Match, MatchFormat, Player, Team } from '../src/lib/types';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };
const dryRun = process.argv.includes('--dry-run');
const productionProject = process.argv.includes('--confirm-production') ? arg('--project') : '';
if (productionProject) {
  if (process.env.FIRESTORE_EMULATOR_HOST) { console.error('Unset FIRESTORE_EMULATOR_HOST to seed a real project.'); process.exit(1); }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS for the project.'); process.exit(1); }
  process.env.GCLOUD_PROJECT = productionProject;
} else if (!process.env.FIRESTORE_EMULATOR_HOST && !dryRun) {
  console.error('Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8085, or pass --project <id> --confirm-production.');
  process.exit(1);
}

// ---------- Deterministic random names, so reruns give the same people ----------
let state = 20261130;
const rand = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
const FIRST = ['Juan', 'Miguel', 'Carlo', 'Paolo', 'Rafael', 'Joshua', 'Kenneth', 'Mark', 'Christian', 'Jerome', 'Adrian', 'Gabriel', 'Nathan', 'Vincent', 'Bryan',
  'Angelo', 'Ramon', 'Daniel', 'Francis', 'Kyle', 'Jasper', 'Lloyd', 'Arvin', 'Renz', 'Aldrin', 'Ivan', 'Jericho', 'Patrick', 'Ronnie', 'Sean',
  'Maria', 'Angela', 'Patricia', 'Kristine', 'Camille', 'Andrea', 'Bea', 'Nicole', 'Joanna', 'Hazel', 'Shaira', 'Princess', 'Trisha', 'Alyssa', 'Jasmine',
  'Faisal', 'Amir', 'Nur', 'Jamil', 'Rashid', 'Aisha', 'Fatima', 'Hassan', 'Omar', 'Yusuf'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Navarro', 'Villanueva', 'Ramos', 'Aquino', 'Castillo', 'Flores',
  'Dela Cruz', 'Gonzales', 'Lim', 'Tan', 'Uy', 'Chua', 'Salazar', 'Rivera', 'Pascual', 'Manalo', 'Francisco', 'Domingo', 'Morales', 'Fernandez', 'Alvarez',
  'Hadjirul', 'Abubakar', 'Jalani', 'Sali', 'Tingkahan', 'Muarip', 'Alfaro', 'Enriquez', 'Climaco', 'Lobregat', 'Saavedra', 'Atilano', 'Fabian', 'Camins'];
const HANDLE_A = ['Shadow', 'Neon', 'Frost', 'Blaze', 'Viper', 'Echo', 'Nova', 'Ghost', 'Rogue', 'Storm', 'Zen', 'Raven', 'Kaiju', 'Volt', 'Ember', 'Onyx',
  'Lunar', 'Tide', 'Jade', 'Rift', 'Pyro', 'Hex', 'Sable', 'Drift', 'Apex', 'Kilo', 'Nimbus', 'Comet', 'Mako', 'Ronin'];
const HANDLE_B = ['Fang', 'Byte', 'Strike', 'Hawk', 'Wolf', 'Edge', 'Spark', 'Reaper', 'Lynx', 'Blade', 'Pulse', 'Crow', 'Viper', 'Knight', 'Fox', 'Bolt'];
const MASCOT: Record<string, string> = {
  CCS: 'Codebreakers', COE: 'Ironclads', CN: 'Lifeguards', CCJE: 'Wardens', CL: 'Verdicts', CA: 'Blueprints', CLA: 'Muses', CED: 'Mentors',
  CSM: 'Catalysts', CAIS: 'Crescents', CHE: 'Hearthfire', CFES: 'Timberwolves', CSSPE: 'Sprinters', CSWCD: 'Guardians',
};
const PROGRAM: Record<string, string> = {
  CCS: 'BSCS', COE: 'BSCE', CN: 'BSN', CCJE: 'BSCrim', CL: 'JD', CA: 'BSArch', CLA: 'ABComm', CED: 'BSEd', CSM: 'BSMath', CAIS: 'BAIS', CHE: 'BSHE',
  CFES: 'BSF', CSSPE: 'BPEd', CSWCD: 'BSSW',
};
const usedHandles = new Set<string>();
const handle = () => { for (;;) { const h = `${pick(HANDLE_A)}${pick(HANDLE_B)}${rand() < 0.4 ? Math.floor(rand() * 90 + 10) : ''}`; if (!usedHandles.has(h)) { usedHandles.add(h); return h; } } };
let studentNo = 0;

interface Person { fullName: string; studentId: string; section: string; ign: string; role: string }
function people(code: string, roles: string[]): Person[] {
  return roles.map(role => ({
    fullName: `${pick(FIRST)} ${pick(LAST)}`,
    studentId: `${pick(['2022', '2023', '2024', '2025'])}-${String(10000 + (studentNo += 37) % 89999).padStart(5, '0')}`,
    section: `${PROGRAM[code] || 'BS'} ${1 + Math.floor(rand() * 4)}${pick(['A', 'B', 'C'])}`,
    ign: handle(), role,
  }));
}

// ---------- The week ----------
function nextMonday() {
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) + 'T00:00:00Z');
  const add = ((8 - today.getUTCDay()) % 7) || 7;
  return new Date(today.getTime() + add * 86_400_000);
}
const monday = arg('--monday') ? new Date(arg('--monday') + 'T00:00:00Z') : nextMonday();
if (monday.getUTCDay() !== 1) { console.error('--monday must be a Monday.'); process.exit(1); }
const DAYS = Array.from({ length: 5 }, (_, i) => new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10));
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const COLLEGES = INSTITUTION_COLLEGES;
if (COLLEGES.length < 12 || COLLEGES.length > 16) { console.error(`Expected 12 to 16 colleges in institution.config.json, found ${COLLEGES.length}.`); process.exit(1); }
const teamName = (code: string) => `${code} ${MASCOT[code] || 'Varsity'}`;

interface Built { bracket: BracketDraft; roster: PrivateRosterDoc }

function rosterTeam(tid: string, gameId: string, college: typeof COLLEGES[number], roles: string[], mode?: 'br' | 'mp', id = `${tid}-${college.code.toLowerCase()}`) {
  const members = people(college.code, roles);
  const team: Team = {
    id, name: teamName(college.code), collegeId: college.id, collegeCode: college.code, gameId, ...(mode ? { gameMode: mode } : {}),
    seed: 0, winRate: 0, record: '0W-0L',
    players: members.map((m, p) => ({ id: `${id}-p${p + 1}`, name: m.ign, ign: m.ign, role: m.role, collegeId: college.id, isVerified: true }) as Player),
  };
  return { team, members };
}

/**
 * Spreads the playable matches over Monday to Thursday in dependency order, and keeps the last `finalStages`
 * stages for Friday. A stage is how many matches feed into a match, so a match always comes after its sources.
 */
function schedule(matches: Match[], start: number, slot: number, finalStages: number) {
  const byId = new Map(matches.map(m => [m.id, m]));
  const depth = new Map<string, number>();
  const feeders = new Map<string, string[]>();
  for (const m of matches) {
    for (const s of m.sources || []) if (s) feeders.set(m.id, [...(feeders.get(m.id) || []), s.matchId]);
    if (m.nextMatchId) feeders.set(m.nextMatchId, [...new Set([...(feeders.get(m.nextMatchId) || []), m.id])]);
  }
  const level = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = (feeders.get(id) || []).filter(p => byId.has(p) && playable(byId.get(p)!));
    const d = parents.length ? Math.max(...parents.map(p => level(p, seen))) + 1 : 0;
    depth.set(id, d); return d;
  };
  const isBye = (t?: Team) => !!t?.isBye;
  function playable(m: Match) { return !m.inactive && !m.conditionalReset && !isBye(m.team1) && !isBye(m.team2); }
  const list = matches.filter(playable).sort((a, b) => level(a.id) - level(b.id) || a.round - b.round || (a.bracketType === 'lower' ? 1 : 0) - (b.bracketType === 'lower' ? 1 : 0) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const maxDepth = Math.max(...list.map(m => level(m.id)));
  const friday = list.filter(m => level(m.id) > maxDepth - finalStages);
  const early = list.filter(m => level(m.id) <= maxDepth - finalStages);
  const plan = new Map<string, { date: string; time: string; end: string }>();
  const perDay = Math.ceil(early.length / 4);
  // Depth order means every feeder is on an earlier day or an earlier slot the same day.
  let day = 0, n = 0;
  for (const m of early) {
    if (n >= perDay && day < 3) { day++; n = 0; }
    plan.set(m.id, { date: DAYS[day], time: hhmm(start + n * slot), end: hhmm(start + n * slot + slot - 10) });
    n++;
  }
  // The grand-final reset (played only if the lower-bracket team wins) goes right after the grand final.
  const reset = matches.filter(m => m.conditionalReset);
  [...friday, ...reset].forEach((m, i) => plan.set(m.id, { date: DAYS[4], time: hhmm(start + i * slot), end: hhmm(start + i * slot + slot - 10) }));
  return matches.map(m => plan.has(m.id) ? { ...m, scheduledDate: plan.get(m.id)!.date, scheduledTime: plan.get(m.id)!.time, scheduledEndTime: plan.get(m.id)!.end } : m);
}

function elimination(opts: { tid: string; gameId: string; gameName: string; title: string; format: string; matchFormat: MatchFormat; finalMatchFormat: MatchFormat; roles: string[]; start: number; slot: number; finalStages: number }): Built {
  const draft = createBracketFromTeams({
    title: opts.title, gameName: opts.gameName, format: opts.format, matchFormat: opts.matchFormat, finalMatchFormat: opts.finalMatchFormat, seedingRule: 'Random draw',
    teams: COLLEGES.map((c, i) => ({ name: teamName(c.code), college: c.code, seed: i + 1 })),
  } as Parameters<typeof createBracketFromTeams>[0]);
  const draftPrefix = draft.matches[0].id.replace(/-M\d+$/, '');
  const roster: PrivateRosterDoc = { teams: {} };
  const teams = new Map<string, Team>();
  for (const college of COLLEGES) {
    const { team, members } = rosterTeam(opts.tid, opts.gameId, college, opts.roles);
    teams.set(team.name, team);
    roster.teams[team.id] = { teamName: team.name, collegeCode: college.code, players: members.map(m => ({ ...m, schoolEmail: '', substitute: false })) };
  }
  const fix = (t?: Team): Team | undefined => {
    if (!t) return t;
    if (t.isBye) return { ...t, id: t.id.split(draftPrefix).join(opts.tid), gameId: opts.gameId };
    const real = teams.get(t.name);
    if (!real) throw new Error(`Unknown team ${t.name}`);
    return { ...real, seed: t.seed };
  };
  const swap = (s?: string) => s ? s.split(draftPrefix).join(opts.tid) : s;
  let matches: Match[] = draft.matches.map(m => ({
    ...m, id: swap(m.id)!, nextMatchId: swap(m.nextMatchId), tournamentId: opts.tid, gameId: opts.gameId,
    ...(m.sources ? { sources: m.sources.map(s => s ? { ...s, matchId: swap(s.matchId)! } : s) } : {}),
    ...((m as { loserNextMatchId?: string }).loserNextMatchId ? { loserNextMatchId: swap((m as { loserNextMatchId?: string }).loserNextMatchId) } : {}),
    team1: fix(m.team1), team2: fix(m.team2), status: 'upcoming', score: { team1Score: 0, team2Score: 0 }, winnerId: undefined,
  }));
  // Any id we did not know about would still carry the draft prefix.
  const leftover = JSON.stringify(matches).includes(draftPrefix);
  if (leftover) throw new Error(`Some ids still carry ${draftPrefix}`);
  matches = schedule(matches, opts.start, opts.slot, opts.finalStages);
  const bracket: BracketDraft = {
    ...draft, id: opts.tid, title: opts.title, gameId: opts.gameId, gameName: opts.gameName, matches, status: 'published',
    rosterTeams: [...teams.values()], teams: [...teams.values()].map((t, i) => ({ id: t.id, name: t.name, college: t.collegeCode, seed: i + 1 })),
    createdAt: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }),
  };
  return { bracket: JSON.parse(JSON.stringify(bracket)), roster };
}

function battleRoyale(tid: string, title: string, gamesPerDay: number, start: number, gap: number): Built {
  const event = createPlacementEvent({
    title, games: gamesPerDay * 5, config: POINT_PRESETS[0].config,
    teams: COLLEGES.map(c => ({ name: teamName(c.code), collegeCode: c.code })),
  });
  const swap = (s: string) => s.split(event.id).join(tid);
  const placement = event.placement!;
  const roster: PrivateRosterDoc = { teams: {} };
  const rosterTeams: Team[] = placement.teams.map((t, i) => {
    const college = COLLEGES.find(c => c.code === t.collegeCode)!;
    const { team, members } = rosterTeam(tid, 'game-codm-br', college, ['Squad Leader', 'Fragger', 'Support', 'Scout'], 'br', swap(t.id));
    roster.teams[team.id] = { teamName: team.name, collegeCode: college.code, players: members.map(m => ({ ...m, schoolEmail: '', substitute: false })) };
    return { ...team, seed: i + 1 };
  });
  const games = placement.games.map((g, i) => ({
    ...g, id: swap(g.id), status: 'upcoming' as const, results: [],
    scheduledDate: DAYS[Math.floor(i / gamesPerDay)], scheduledTime: hhmm(start + (i % gamesPerDay) * gap),
  }));
  const bracket: BracketDraft = {
    ...event, id: tid, status: 'published', rosterTeams,
    teams: rosterTeams.map((t, i) => ({ id: t.id, name: t.name, college: t.collegeCode, seed: i + 1 })),
    placement: { ...placement, teams: placement.teams.map(t => ({ ...t, id: swap(t.id) })), games },
    createdAt: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }),
  };
  return { bracket: JSON.parse(JSON.stringify(bracket)), roster };
}

const week = DAYS[0].replace(/-/g, '');
const built: Built[] = [
  elimination({ tid: `esw-${week}-mlbb`, gameId: 'game-mlbb', gameName: 'Mobile Legends: Bang Bang', title: 'Intercollege Esports Week: MLBB',
    format: 'Double Elimination', matchFormat: 'Bo3', finalMatchFormat: 'Bo5', roles: ['Gold Lane', 'EXP Lane', 'Mid Lane', 'Jungler', 'Roamer'], start: 8 * 60, slot: 80, finalStages: 3 }),
  elimination({ tid: `esw-${week}-dota2`, gameId: 'game-dota2', gameName: 'Dota 2', title: 'Intercollege Esports Week: Dota 2',
    format: 'Single Elimination', matchFormat: 'Bo1', finalMatchFormat: 'Bo3', roles: ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'], start: 13 * 60, slot: 75, finalStages: 2 }),
  elimination({ tid: `esw-${week}-codm-mp`, gameId: 'game-codm-mp', gameName: 'CODM Multiplayer', title: 'Intercollege Esports Week: CODM Multiplayer',
    format: 'Single Elimination', matchFormat: 'Bo3', finalMatchFormat: 'Bo5', roles: ['Slayer', 'Objective', 'Anchor', 'Flex', 'Support'], start: 9 * 60, slot: 60, finalStages: 2 }),
  battleRoyale(`esw-${week}-codm-br`, 'Intercollege Esports Week: CODM Battle Royale', 2, 16 * 60, 45),
];

for (const { bracket } of built) {
  const rows = bracket.placement ? bracket.placement.games.map(g => ({ id: g.id, label: g.label, date: g.scheduledDate, time: g.scheduledTime, who: `${bracket.placement!.teams.length} squads` }))
    : bracket.matches.filter(m => m.scheduledDate).map(m => ({ id: m.id, label: `${m.matchNumber} ${m.roundName}${m.bracketType === 'lower' ? ' (LB)' : ''}`, date: m.scheduledDate, time: m.scheduledTime, who: `${m.team1?.name || 'TBD'} vs ${m.team2?.name || 'TBD'}` }));
  console.log(`\n${bracket.title} (${bracket.format}, ${bracket.matchFormat}): ${rows.length} scheduled, ${bracket.matches.length} matches in the tree`);
  for (const r of rows) console.log(`  ${r.date} ${r.time}  ${r.label.padEnd(28)} ${r.who}`);
}
if (dryRun) process.exit(0);

// ---------- Write ----------
if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-arenahub' });
const db = getFirestore();
async function deleteTournament(ref: DocumentReference) {
  for (const sub of await ref.listCollections()) for (const d of await sub.listDocuments()) await d.delete();
  await ref.delete();
}

const demos = await db.collection('tournaments').where('demo', '==', true).get();
for (const doc of demos.docs) { await deleteTournament(doc.ref); console.log(`Deleted demo tournament ${doc.id} (${doc.data().title})`); }
// Earlier runs of this script are replaced too, so reruns do not pile up.
const earlier = await db.collection('tournaments').where('__name__', '>=', 'esw-').where('__name__', '<', 'esw.').get();
for (const doc of earlier.docs) if (!built.some(b => b.bracket.id === doc.id)) { await deleteTournament(doc.ref); console.log(`Deleted earlier test week ${doc.id}`); }

for (const { bracket, roster } of built) {
  const key = publicationGameKey(bracket);
  const pubRef = db.doc(`publications/${key}`);
  const pub = await pubRef.get();
  const currentId = pub.data()?.currentId as string | undefined;
  const batch = db.batch();
  if (currentId && currentId !== bracket.id) {
    const current = await db.doc(`tournaments/${currentId}`).get();
    if (current.exists) { batch.update(current.ref, { status: 'archived', revision: Number(current.data()?.revision || 0) + 1, updatedAt: FieldValue.serverTimestamp() }); console.log(`Archived real tournament ${currentId}`); }
  }
  // The restorable previous copy would bring the demo back, so it goes.
  for (const d of await pubRef.collection('previous').listDocuments()) batch.delete(d);
  const existing = await db.doc(`tournaments/${bracket.id}`).get();
  const tournament = toTournamentDoc(bracket, Number(existing.data()?.revision || 0) + 1, { featured: key === 'game-mlbb' });
  batch.set(db.doc(`tournaments/${bracket.id}`), { ...tournament, updatedAt: FieldValue.serverTimestamp() });
  batch.set(db.doc(`tournaments/${bracket.id}/public/rosters`), toRosterDoc(bracket));
  batch.set(db.doc(`tournaments/${bracket.id}/private/roster`), roster);
  batch.set(pubRef, { gameKey: key, currentId: bracket.id, hasPrevious: false, revision: Number(pub.data()?.revision || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  console.log(`Published ${bracket.title} as ${bracket.id}`);
}
console.log(`\nDone: ${COLLEGES.length} colleges, week of ${DAYS[0]} to ${DAYS[4]}.`);
