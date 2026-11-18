import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStandings, createPlacementEvent, placementPoints, POINT_PRESETS, recordGame, tiebreakReason, validateConfig,
  type PlacementEvent,
} from '../src/lib/formats/placement';
import { contentFingerprint, fromDocs, toTournamentDoc } from '../src/lib/data/tournamentDocs';
import { publicationGameKey } from '../src/lib/bracketPublication';

const standard = POINT_PRESETS[0].config;
const squads = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, i) => ({ name, collegeCode: ['CCS', 'COE', 'CN', 'CED'][i] }));
const make = (games = 3) => createPlacementEvent({ title: 'QA BR Cup', teams: squads, games, config: standard, now: 1_700_000_000_000 });
const ids = (e: PlacementEvent) => Object.fromEntries(e.teams.map(t => [t.name, t.id]));

test('placement points follow the table, and places past the table score 0', () => {
  assert.equal(placementPoints(standard, 1), 10);
  assert.equal(placementPoints(standard, 8), 1);
  assert.equal(placementPoints(standard, 9), 0);
});

test('an event is a CODM BR publication with no head-to-head matches', () => {
  const draft = make();
  assert.equal(draft.gameId, 'game-codm-br');
  assert.equal(publicationGameKey(draft), 'game-codm-br');
  assert.equal(draft.matches.length, 0);
  assert.equal(draft.placement!.teams.length, 4);
  assert.deepEqual(draft.placement!.games.map(g => g.label), ['Game 1', 'Game 2', 'Game 3']);
  assert.throws(() => createPlacementEvent({ title: 'X', teams: squads, games: 3, config: standard }), /title/);
  assert.throws(() => createPlacementEvent({ title: 'Solo cup', teams: squads.slice(0, 1), games: 3, config: standard }), /2 to 25/);
  assert.throws(() => createPlacementEvent({ title: 'Dupes', teams: [...squads, { name: 'alpha' }], games: 3, config: standard }), /listed twice/);
  assert.throws(() => createPlacementEvent({ title: 'Too long', teams: squads, games: 25, config: standard }), /1 to 24/);
});

test('result validation rejects impossible games', () => {
  const event = make().placement!, id = ids(event), g = event.games[0].id;
  assert.throws(() => recordGame(event, g, [{ teamId: id.Alpha, placement: 1, kills: 3 }, { teamId: id.Bravo, placement: 1, kills: 0 }], 'completed'), /both finish #1/);
  assert.throws(() => recordGame(event, g, [{ teamId: id.Alpha, placement: 5, kills: 0 }], 'live'), /1 to 4/);
  assert.throws(() => recordGame(event, g, [{ teamId: id.Alpha, placement: 1, kills: -1 }], 'live'), /eliminations/);
  assert.throws(() => recordGame(event, g, [{ teamId: 'stranger', placement: 1, kills: 0 }], 'live'), /not in this event/);
  assert.throws(() => recordGame(event, g, [{ teamId: id.Alpha, placement: 1, kills: 0 }], 'completed'), /at least two/);
  assert.throws(() => recordGame(event, 'nope', [], 'live'), /not part/);
});

test('standings add only final games: placement points plus eliminations', () => {
  let event = make().placement!; const id = ids(event);
  event = recordGame(event, event.games[0].id, [
    { teamId: id.Alpha, placement: 1, kills: 2 }, { teamId: id.Bravo, placement: 2, kills: 8 },
    { teamId: id.Charlie, placement: 3, kills: 1 }, { teamId: id.Delta, placement: 4, kills: 0 },
  ], 'completed');
  // A live game does not count yet.
  event = recordGame(event, event.games[1].id, [{ teamId: id.Delta, placement: 1, kills: 20 }, { teamId: id.Alpha, placement: 2, kills: 0 }], 'live');
  const rows = computeStandings(event);
  assert.deepEqual(rows.map(r => [r.rank, r.name, r.total]), [[1, 'Bravo', 14], [2, 'Alpha', 12], [3, 'Charlie', 6], [4, 'Delta', 4]]);
  assert.equal(rows[1].wins, 1);
  assert.equal(rows[0].placementPoints, 6);
  assert.equal(rows[0].killPoints, 8);
});

test('tiebreakers: placement points, then best placement, then eliminations, then latest game', () => {
  const config = { pointsTable: [10, 6, 5, 4], killPoints: 1 };
  const base = createPlacementEvent({ title: 'Ties', teams: squads, games: 2, config, now: 1 }).placement!; const id = ids(base);
  // Alpha 10+0=10, Bravo 6+4=10: equal total, Alpha has more placement points.
  let e = recordGame(base, base.games[0].id, [{ teamId: id.Alpha, placement: 1, kills: 0 }, { teamId: id.Bravo, placement: 2, kills: 4 }, { teamId: id.Charlie, placement: 3, kills: 0 }, { teamId: id.Delta, placement: 4, kills: 0 }], 'completed');
  let rows = computeStandings(e);
  assert.deepEqual(rows.slice(0, 2).map(r => r.name), ['Alpha', 'Bravo']);
  assert.equal(tiebreakReason(rows[0], rows[1]), 'more placement points');

  // Same totals and placement points over two games; Charlie has the better single placement.
  e = recordGame(base, base.games[0].id, [{ teamId: id.Charlie, placement: 1, kills: 0 }, { teamId: id.Delta, placement: 3, kills: 0 }], 'completed');
  e = recordGame(e, e.games[1].id, [{ teamId: id.Charlie, placement: 4, kills: 0 }, { teamId: id.Delta, placement: 2, kills: 3 }], 'completed');
  // Charlie 10+4 = 14; Delta 5+6+3 = 14, placement 11 vs 14. Charlie ahead on placement points.
  rows = computeStandings(e);
  assert.equal(rows[0].name, 'Charlie');

  // Fully identical rows share a rank.
  e = recordGame(base, base.games[0].id, [{ teamId: id.Alpha, placement: 1, kills: 0 }, { teamId: id.Bravo, placement: 2, kills: 0 }], 'completed');
  e = recordGame(e, e.games[1].id, [{ teamId: id.Bravo, placement: 1, kills: 0 }, { teamId: id.Alpha, placement: 2, kills: 0 }], 'completed');
  rows = computeStandings(e);
  // Same total, placement points, best placement and kills; Bravo won the latest game.
  assert.deepEqual(rows.slice(0, 2).map(r => [r.rank, r.name]), [[1, 'Bravo'], [2, 'Alpha']]);
  assert.equal(tiebreakReason(rows[0], rows[1]), 'a better placement in the latest game');
  // Squads that never played share last place.
  assert.equal(rows[2].rank, rows[3].rank);
});

test('best single placement breaks a tie in placement points', () => {
  // With 8, 5, 3, 2 points, 1st + 4th (8 + 2) ties 2nd + 2nd (5 + 5).
  const flat = createPlacementEvent({ title: 'Best place', teams: squads, games: 2, config: { pointsTable: [8, 5, 3, 2], killPoints: 0 }, now: 2 }).placement!; const id = ids(flat);
  let e = recordGame(flat, flat.games[0].id, [{ teamId: id.Alpha, placement: 1, kills: 0 }, { teamId: id.Bravo, placement: 2, kills: 0 }], 'completed');
  e = recordGame(e, e.games[1].id, [{ teamId: id.Bravo, placement: 2, kills: 0 }, { teamId: id.Alpha, placement: 4, kills: 0 }], 'completed');
  // Alpha 8+2 = 10, Bravo 5+5 = 10. Alpha's best placement is 1st.
  const rows = computeStandings(e);
  assert.deepEqual(rows.slice(0, 2).map(r => r.name), ['Alpha', 'Bravo']);
  assert.equal(tiebreakReason(rows[0], rows[1]), 'a better best placement');
});

test('config validation', () => {
  assert.doesNotThrow(() => validateConfig(standard));
  assert.throws(() => validateConfig({ pointsTable: [], killPoints: 1 }), /1 to 25/);
  assert.throws(() => validateConfig({ pointsTable: [5, 8], killPoints: 1 }), /fewer points/);
  assert.throws(() => validateConfig({ pointsTable: [5, 1.5], killPoints: 1 }), /whole numbers/);
  assert.throws(() => validateConfig({ pointsTable: [5], killPoints: 11 }), /0 to 10/);
});

test('placement survives the tournament document round trip and changes the content fingerprint', () => {
  const draft = make();
  const id = ids(draft.placement!);
  const docA = toTournamentDoc(draft, 1);
  const played = { ...draft, placement: recordGame(draft.placement!, draft.placement!.games[0].id, [{ teamId: id.Alpha, placement: 1, kills: 4 }, { teamId: id.Bravo, placement: 2, kills: 1 }], 'completed') };
  const docB = toTournamentDoc(played, 2);
  assert.notEqual(contentFingerprint(docA), contentFingerprint(docB));
  const back = fromDocs(docB, null);
  assert.deepEqual(back.placement, docB.placement);
  assert.equal(computeStandings(back.placement!)[0].name, 'Alpha');
  assert.deepEqual(back.teams.map(t => t.name), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  // Head-to-head brackets keep their old fingerprint shape.
  assert.equal(contentFingerprint({ matches: [] }), '[]');
});

test('lobby games become schedule entries with squad membership and the winner once final', async () => {
  const { lobbyMatches, scheduleMatches } = await import('../src/lib/formats/placement');
  const { matchLabel } = await import('../src/lib/integrityChecks');
  const draft = make(2);
  const id = ids(draft.placement!);
  draft.placement = recordGame(draft.placement!, draft.placement!.games[0].id, [{ teamId: id.Charlie, placement: 1, kills: 2 }, { teamId: id.Alpha, placement: 2, kills: 0 }], 'completed');
  draft.placement.games[1] = { ...draft.placement.games[1], scheduledDate: '2026-11-20', scheduledTime: '14:00' };
  const [g1, g2] = lobbyMatches(draft);
  assert.equal(g1.lobby?.winner, 'Charlie');
  assert.equal(g1.status, 'completed');
  assert.equal(g2.lobby?.winner, undefined);
  assert.equal(g2.scheduledTime, '14:00');
  assert.equal(g1.team1, undefined);
  assert.deepEqual(g1.lobby?.teams?.map(team => team.id), draft.placement.teams.map(team => team.id));
  assert.equal(matchLabel(g2), 'Game 2 · 4-squad lobby');
  assert.deepEqual(scheduleMatches({ ...draft, placement: undefined }), draft.matches);
});
