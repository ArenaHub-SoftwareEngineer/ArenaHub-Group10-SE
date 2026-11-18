import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createFairPlayRouter } from '../server/fairPlay';
import { createPlacementEvent } from '../src/lib/formats/placement';
import { toTournamentDoc } from '../src/lib/data/tournamentDocs';

test('video API verifies staff, active account and published match before calling the model', async t => {
  let calls = 0, banned = false;
  const field = (value: any): any => {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') return { doubleValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, field(v)])) } };
  };
  const lobby = createPlacementEvent({ title: 'Video lobby QA', teams: [{ name: 'Alpha' }, { name: 'Bravo' }], games: 1, config: { pointsTable: [10, 6], killPoints: 1 } });
  const tournaments = [{ status: 'published', matches: [{ id: 'match-1', gameId: 'game-mlbb' }] }, toTournamentDoc(lobby, 1)];
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    const payload = url.includes('accounts:lookup') ? { users: [{ localId: 'organizer', emailVerified: true, email: 'organizer@wmsu.edu.ph' }] }
      : url.includes('/users/') ? { fields: { status: field(banned ? 'banned' : 'active') } }
      : url.includes('/public/rosters') ? { fields: { teams: field([]) } }
      : tournaments.map(tournament => ({ document: { fields: field(tournament).mapValue.fields } }));
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const analyze = async (_game: any, frames: any[]) => { calls++; return { frames: frames.map(f => ({ timestamp: f.timestamp, classification: 'context-needed', observation: 'A visible encounter.', possibleExplanation: 'Spectator vision.', missingContext: 'Player POV.', category: 'visibility' })) }; };
  const app = express(); app.use('/api', createFairPlayRouter({ GEMINI_API_KEY: 'test-only', VITE_FIREBASE_PROJECT_ID: 'demo-arenahub' }, { fetcher, analyze }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const jwt = (claims: any) => `header.${Buffer.from(JSON.stringify({ sub: 'organizer', ...claims })).toString('base64url')}.signature`;
  const body = { game: 'mlbb', matchId: 'match-1', frames: [{ timestamp: 0, image: '/9j/YQ==' }] };
  const post = (value: any, token?: string, origin?: string) => fetch(base + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(value) });
  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, 'local-dev-token')).status, 401);
  assert.equal((await post(body, jwt({ admin: true }), 'https://elsewhere.test')).status, 403);
  assert.equal((await post(body, jwt({ role: 'user' }))).status, 403);
  banned = true; assert.equal((await post(body, jwt({ admin: true }))).status, 403); banned = false;
  assert.equal((await post({ ...body, matchId: 'invented' }, jwt({ admin: true }))).status, 400);
  assert.equal((await post({ ...body, game: 'dota2' }, jwt({ admin: true }))).status, 400);
  assert.equal((await post({ ...body, frames: [{ timestamp: -1, image: '/9j/YQ==' }] }, jwt({ admin: true }))).status, 400);
  assert.equal(calls, 0);
  const response = await post(body, jwt({ admin: true })); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.source, 'model'); assert.equal(payload.frames[0].timestamp, 0); assert.equal(calls, 1);
  const lobbyBody = { ...body, game: 'codm-br', matchId: lobby.placement!.games[0].id };
  assert.equal((await post({ ...lobbyBody, game: 'codm-mp' }, jwt({ admin: true }))).status, 400);
  assert.equal((await post(lobbyBody, jwt({ role: 'user' }))).status, 403);
  assert.equal((await post(lobbyBody, jwt({ admin: true }))).status, 200);
  assert.equal(calls, 2);
});
