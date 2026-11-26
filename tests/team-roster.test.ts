import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankRows, emptyRow, gameRoles, nextRole, rosterProblem, rosterStatus, rowsFromRosters, safePhoto, splitRoster, startersFor, SUBSTITUTE, type RosterRow } from '../src/lib/teamRoster';
import { safePlayerImage } from '../src/lib/playerProfiles';
import { CAMPUS_DOMAIN } from '../src/lib/institution';

const mlbb = { gameName: 'Mobile Legends: Bang Bang', gameId: 'game-mlbb' };
const br = { gameName: 'CODM Battle Royale', gameId: 'game-codm-br' };
const photo = 'data:image/webp;base64,' + 'A'.repeat(400);
const row = (n: number, patch: Partial<RosterRow> = {}): RosterRow => ({ id: `t-p${n}`, fullName: `Name ${n}`, ign: `ign${n}`, role: 'Jungler', schoolEmail: '', ...patch });

test('roles and team sizes follow the game', () => {
  assert.deepEqual(gameRoles(mlbb), ['Gold Lane', 'EXP Lane', 'Mid Lane', 'Jungler', 'Roamer', SUBSTITUTE]);
  assert.equal(startersFor(mlbb), 5);
  assert.equal(startersFor(br), 4);
  assert.deepEqual(gameRoles({ gameName: 'Chess' }), ['Player', SUBSTITUTE]);
});

test('a blank team gets one row per starting role, and new rows take the next free role', () => {
  const rows = blankRows('t', mlbb);
  assert.deepEqual(rows.map(r => r.role), ['Gold Lane', 'EXP Lane', 'Mid Lane', 'Jungler', 'Roamer']);
  assert.equal(new Set(rows.map(r => r.id)).size, 5);
  assert.equal(nextRole(rows, mlbb), SUBSTITUTE);
  assert.equal(nextRole(rows.slice(1), mlbb), 'Gold Lane');
  assert.equal(emptyRow('t', [row(1), row(2)], 'Roamer').id, 't-p3');
  assert.equal(emptyRow('t', [row(3)], 'Roamer').id, 't-p2');
});

test('rosterProblem asks for what is missing', () => {
  assert.equal(rosterProblem([row(1)], mlbb), '');
  assert.match(rosterProblem([row(1, { fullName: ' ' })], mlbb), /full name of ign1/);
  assert.match(rosterProblem([row(1, { ign: '' })], mlbb), /in-game name of player 1/);
  assert.match(rosterProblem([row(1), row(2, { ign: 'IGN1' })], mlbb), /Two players use the in-game name/);
  assert.match(rosterProblem([row(1, { schoolEmail: 'a@gmail.com' })], mlbb), new RegExp(CAMPUS_DOMAIN.replace('.', '\\.')));
  assert.equal(rosterProblem([row(1, { schoolEmail: `a@${CAMPUS_DOMAIN}` })], mlbb), '');
  assert.match(rosterProblem([1, 2, 3].map(n => row(n, { role: SUBSTITUTE })), mlbb), /at most 2 substitutes/);
  assert.match(rosterProblem(Array.from({ length: 8 }, (_, i) => row(i)), mlbb), /at most 7 players/);
  assert.match(rosterProblem([], mlbb), /at least one/);
});

test('split keeps names and emails out of the public roster', () => {
  const { publicPlayers, privatePlayers } = splitRoster([row(1, { photo, schoolEmail: ` A@${CAMPUS_DOMAIN} `, role: SUBSTITUTE, studentId: '2024-1' })]);
  assert.deepEqual(publicPlayers, [{ id: 't-p1', ign: 'ign1', role: SUBSTITUTE, isVerified: true, avatarUrl: photo }]);
  assert.equal(JSON.stringify(publicPlayers).includes('Name 1'), false);
  assert.deepEqual(privatePlayers[0], { fullName: 'Name 1', schoolEmail: `a@${CAMPUS_DOMAIN}`, studentId: '2024-1', section: '', ign: 'ign1', role: SUBSTITUTE, substitute: true });
});

test('editing joins public and private rosters by IGN and keeps hidden fields', () => {
  const rows = rowsFromRosters(
    [{ id: 'p1', ign: 'Alpha', role: 'Jungler', isVerified: true, avatarUrl: photo }, { id: 'p2', ign: 'Bravo', role: 'Roamer', isVerified: true }],
    [{ fullName: 'Bea B', ign: 'bravo', role: 'Roamer', schoolEmail: 'b@x', studentId: 'S2', section: 'BS 1A', substitute: false },
     { fullName: 'Al A', ign: 'Alpha', role: 'Jungler', schoolEmail: '', studentId: 'S1', section: '', substitute: true }],
  );
  assert.equal(rows[0].fullName, 'Al A');
  assert.equal(rows[0].role, SUBSTITUTE);
  assert.equal(rows[0].photo, photo);
  assert.equal(rows[1].fullName, 'Bea B');
  assert.equal(rows[1].studentId, 'S2');
  assert.equal(rows[1].section, 'BS 1A');
});

test('photos must be small inline images', () => {
  assert.equal(safePhoto(photo), photo);
  assert.equal(safePhoto('data:image/svg+xml;base64,AAAA'), undefined);
  assert.equal(safePhoto('data:image/webp;base64,' + 'A'.repeat(8000)), undefined);
  assert.equal(safePlayerImage(photo), photo);
  assert.equal(safePlayerImage('data:text/html;base64,AAAA'), undefined);
  assert.equal(safePlayerImage('https://example.com/a.png'), 'https://example.com/a.png');
});

test('roster status counts starters', () => {
  assert.equal(rosterStatus(0, mlbb), 'empty');
  assert.equal(rosterStatus(3, mlbb), 'partial');
  assert.equal(rosterStatus(5, mlbb), 'ready');
  assert.equal(rosterStatus(4, br), 'ready');
});
