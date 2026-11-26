// Facilitators: invited by email, granted on first sign-in, and limited to Anti-cheat for their assigned matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createIntegrityRouter } from '../server/integrity';
import { IntegrityStore } from '../server/integrityStore';
import { AuthError } from '../server/staffAuth';
import type { RoleAdmin } from '../server/facilitators';
import type { PublishedData } from '../server/data';

function fixture(): PublishedData {
  const team = (id: string) => ({ id, name: id.toUpperCase(), collegeCode: id.slice(0, 2).toUpperCase(), players: [{ id: `${id}-p`, ign: `${id} ace`, name: 'Private' }] });
  return { brackets: [{ id: 'tournament', gameId: 'game-mlbb', matches: [
    { id: 'mine', matchNumber: 'QF1', status: 'upcoming', gameId: 'game-mlbb', team1: team('alpha'), team2: team('bravo') },
    { id: 'other', matchNumber: 'QF2', status: 'upcoming', gameId: 'game-mlbb', team1: team('charlie'), team2: team('delta') },
  ] }], revision: '1', checkedAt: '' } as unknown as PublishedData;
}

async function setup(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'arenahub-facilitators-'));
  const store = new IntegrityStore(dir);
  // Accounts and their claim roles, as Firebase would hold them.
  const accounts = new Map<string, { uid: string; role: string }>([
    ['org@wmsu.edu.ph', { uid: 'org', role: 'organizer' }],
    ['mod@wmsu.edu.ph', { uid: 'mod', role: 'moderator' }],
    ['early@wmsu.edu.ph', { uid: 'early', role: '' }],
  ]);
  const roles: RoleAdmin = {
    find: async email => accounts.get(email) || null,
    grant: async uid => { for (const account of accounts.values()) if (account.uid === uid) account.role = 'facilitator'; },
    revoke: async uid => { for (const account of accounts.values()) if (account.uid === uid && account.role === 'facilitator') account.role = ''; },
  };
  const who = (token: string | undefined) => {
    const email = token ? token + '@wmsu.edu.ph' : '';
    const account = accounts.get(email);
    if (!token) throw new AuthError(401, 'Sign in');
    const role = account?.role || '';
    return { uid: account?.uid || token, email, role, staff: ['organizer', 'moderator', 'admin'].includes(role), facilitator: role === 'facilitator' };
  };
  const app = express();
  app.use('/api/integrity', createIntegrityRouter({}, {
    store, roles, published: async () => fixture(), rosterEmails: async () => new Map(),
    verifyCaller: async token => ({ ...who(token), campus: true, admitted: true }),
    verifyStaff: async token => {
      const person = who(token);
      if (!person.staff && !person.facilitator) throw new AuthError(403, 'Staff required');
      return { uid: person.uid, role: person.role, email: person.email, facilitator: person.facilitator };
    },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrity`;
  const call = async (path: string, token: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  return { call, accounts, store };
}

test('an organizer invites by email; the role arrives on first sign-in; removal takes it back', async t => {
  const { call, accounts } = await setup(t);
  assert.equal((await call('/facilitators', 'mod', { email: 'new@wmsu.edu.ph' })).status, 403, 'moderators do not invite');
  assert.equal((await call('/facilitators', 'org', { email: 'someone@gmail.com' })).status, 400, 'school email only');

  // An existing account gets the role at once.
  const early = await call('/facilitators', 'org', { email: 'Early@wmsu.edu.ph', matches: ['m-mine'] });
  assert.equal(early.status, 201);
  assert.equal(early.body.status, 'active');
  assert.equal(accounts.get('early@wmsu.edu.ph')!.role, 'facilitator');

  // A new person waits as invited, then accepts on first sign-in.
  assert.equal((await call('/facilitators', 'org', { email: 'new@wmsu.edu.ph' })).body.status, 'invited');
  accounts.set('new@wmsu.edu.ph', { uid: 'new', role: '' });
  assert.deepEqual((await call('/facilitators/accept', 'new', {})).body, { role: 'facilitator', changed: true });
  assert.equal(accounts.get('new@wmsu.edu.ph')!.role, 'facilitator');
  // Anyone not invited is unchanged, and staff keep their own role.
  accounts.set('stranger@wmsu.edu.ph', { uid: 'stranger', role: '' });
  assert.equal((await call('/facilitators/accept', 'stranger', {})).body.changed, false);
  assert.equal((await call('/facilitators', 'org', { email: 'mod@wmsu.edu.ph', matches: ['m-other'] })).body.status, 'staff');
  assert.equal(accounts.get('mod@wmsu.edu.ph')!.role, 'moderator');

  const list = (await call('/facilitators', 'org')).body.facilitators;
  assert.deepEqual(list.map((p: any) => [p.email, p.status, p.matches]), [['early@wmsu.edu.ph', 'active', ['m-mine']], ['new@wmsu.edu.ph', 'active', []]]);

  assert.equal((await call('/facilitators/new@wmsu.edu.ph/matches', 'org', { matches: ['m-other'] }, 'PUT')).status, 200);
  assert.equal((await call('/facilitators/early@wmsu.edu.ph', 'org', undefined, 'DELETE')).status, 200);
  assert.equal(accounts.get('early@wmsu.edu.ph')!.role, '');
  const after = (await call('/facilitators', 'org')).body.facilitators;
  assert.deepEqual(after.map((p: any) => [p.email, p.matches]), [['new@wmsu.edu.ph', ['m-other']]]);
});

test('a facilitator reaches only their assigned matches and cannot change global settings', async t => {
  const { call } = await setup(t);
  await call('/facilitators', 'org', { email: 'early@wmsu.edu.ph', matches: ['m-mine'] });

  const status = await call('/screenwall/status', 'early');
  assert.equal(status.status, 200);
  assert.equal(status.body.manage, false);
  assert.deepEqual(Object.keys(status.body.staff), ['m-mine']);

  // Check-in: their match yes, someone else's match and scrims no.
  assert.equal((await call('/rooms', 'early', { matchId: 'mine', verifiedCheckIn: true, hours: 2 })).status, 201);
  assert.equal((await call('/rooms', 'early', { matchId: 'other', verifiedCheckIn: true, hours: 2 })).status, 403);
  assert.equal((await call('/rooms', 'early', { label: 'Scrim', hours: 2 })).status, 403);
  const opened = await call('/rooms', 'org', { matchId: 'other', verifiedCheckIn: true, hours: 2 });
  assert.equal(opened.status, 201);
  const rooms = (await call('/rooms?verified=1', 'early')).body;
  assert.deepEqual(rooms.map((room: any) => room.matchId ?? room.match_id ?? room.label).length, 1, 'only their own check-in room is listed');
  assert.equal((await call(`/rooms/${opened.body.id}/close`, 'early', {})).status, 403);
  assert.equal((await call('/matches/other/readiness', 'early')).status, 403);

  // Global settings stay with organizers.
  assert.equal((await call('/config', 'early', {}, 'PUT')).status, 403);
  assert.equal((await call('/facilitators', 'early')).status, 403);
  assert.equal((await call('/screenwall/m-mine/staff', 'early', { emails: [] })).status, 403);
});
