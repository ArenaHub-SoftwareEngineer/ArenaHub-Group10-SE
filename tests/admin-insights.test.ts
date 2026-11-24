import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemLog, classify, groupByDay, humanize, mapTotals, matchMap, relativeTime, shortGame, summarizeUsers } from '../src/lib/adminInsights.ts';
import type { BracketDraft, ContentReport, Match, User } from '../src/lib/types.ts';

const NOW = Date.UTC(2026, 10, 20, 6, 0); // 14:00 Manila
const user = (id: string, over: Partial<User> = {}): User => ({ id, name: `User ${id}`, email: `${id}@wmsu.edu.ph`, role: 'user', status: 'active',
  collegeId: '', collegeName: 'College of Computing Studies', avatarInitials: 'U', joinedDate: '', ...over });
const match = (id: string, status: Match['status'], over: Partial<Match> = {}) => ({ id, status, round: 1, roundName: 'Round 1', matchNumber: `#${id}`,
  team1: { id: 'a', name: 'Alpha' }, team2: { id: 'b', name: 'Bravo' }, score: { team1Score: 1, team2Score: 0 }, ...over }) as unknown as Match;

test('classifies audit actions into an area and a colour tone', () => {
  assert.deepEqual(classify('Unpublished bracket "Cup"'), { category: 'brackets', tone: 'danger' });
  assert.deepEqual(classify('Published bracket "Cup" (Dota 2)'), { category: 'brackets', tone: 'success' });
  assert.deepEqual(classify('Match m1 status updated to live'), { category: 'matches', tone: 'live' });
  assert.deepEqual(classify('Score updated for match #M4'), { category: 'matches', tone: 'info' });
  assert.deepEqual(classify('Jane marked as banned'), { category: 'accounts', tone: 'danger' });
  assert.deepEqual(classify('Live stream disconnected from match m1'), { category: 'broadcast', tone: 'warning' });
  assert.deepEqual(classify('Community report r1: remove_and_ban'), { category: 'moderation', tone: 'danger' });
  assert.deepEqual(classify('Something unusual'), { category: 'system', tone: 'neutral' });
});

test('turns match ids and report actions into words', () => {
  const names = new Map([['match-123456', 'Alpha vs Bravo']]);
  assert.equal(humanize('Match match-123456 status updated to pre-match', names), 'Alpha vs Bravo is now pre match');
  assert.equal(humanize('Live stream connected to match match-123456', names), 'Live stream connected to match Alpha vs Bravo');
  assert.equal(humanize('Community report r1: dismiss', names), 'Resolved a chat report: dismissed');
  assert.equal(humanize('Test Student marked as suspended', names), "changed Test Student's status to suspended");
  assert.equal(shortGame('Mobile Legends: Bang Bang'), 'MLBB');
  assert.equal(shortGame('Call of Duty: Mobile Multiplayer'), 'CODM MP');
  assert.equal(humanize('Live stream connected to match unknown-id', names), 'Live stream connected to match unknown-id');
});

test('merges audit events, sign-ups and reports, newest first, with names instead of uids', () => {
  const staff = user('uid-staff-000000000000000001', { name: 'Coach Rivera', role: 'organizer' });
  const report = { id: 'r1', type: 'HARASSMENT', contentType: 'Chat message', contentSnippet: 'x', reportedBy: '', postedBy: 'Troll', timeAgo: '', flagCount: 1, status: 'open', createdAt: NOW - 1000 } as ContentReport;
  const log = buildSystemLog({
    auditLogs: [
      { id: 'a1', actor: staff.id, action: 'Published bracket "Cup" (Dota 2)', timestamp: '', at: NOW - 60_000 },
      { id: 'a2', actor: 'uid-unknown-0000000000000000', action: 'Added new game title: Valorant', timestamp: '', at: NOW - 120_000 },
    ],
    users: [staff, user('new', { name: 'Fresh Player', joinedAt: NOW - 30_000 })],
    reports: [report],
  });
  assert.deepEqual(log.map(entry => entry.id), ['report-r1', 'joined-new', 'a1', 'a2']);
  assert.equal(log[2].actor, 'Coach Rivera');
  assert.equal(log[3].actor, 'Staff member');
  assert.equal(log[0].tone, 'danger');
  assert.equal(log[0].tab, 'reports');
});

test('relative times and day groups use Manila time', () => {
  assert.equal(relativeTime(NOW - 20_000, NOW), 'Just now');
  assert.equal(relativeTime(NOW - 5 * 60_000, NOW), '5 min ago');
  assert.equal(relativeTime(NOW - 3 * 3_600_000, NOW), '3 h ago');
  assert.equal(relativeTime(NOW - 24 * 3_600_000, NOW), 'Yesterday');
  const groups = groupByDay([
    { id: '1', category: 'system', tone: 'neutral', actor: 'a', text: '', at: NOW - 1000 },
    { id: '2', category: 'system', tone: 'neutral', actor: 'a', text: '', at: NOW - 26 * 3_600_000 },
  ], NOW);
  assert.deepEqual(groups.map(group => group.label), ['Today', 'Yesterday']);
});

test('summarizes accounts by status, role and newness', () => {
  const summary = summarizeUsers([
    user('1', { role: 'admin', joinedAt: NOW - 86_400_000 }),
    user('2', { status: 'suspended' }),
    user('3', { status: 'banned', joinedAt: NOW - 30 * 86_400_000 }),
    user('4'),
  ], NOW);
  assert.equal(summary.total, 4);
  assert.deepEqual([summary.active, summary.suspended, summary.banned, summary.staff, summary.newThisWeek], [2, 1, 1, 1, 1]);
  assert.deepEqual(summary.roles[0], { role: 'user', count: 3 });
  assert.equal(summary.newest[0].id, '1');
});

test('the match map has one lane per bracket, skips byes and counts states', () => {
  const bracket = { id: 'b1', title: 'Cup', gameName: 'Dota 2', matches: [
    match('m2', 'live', { round: 2 }),
    match('m1', 'completed'),
    match('m3', 'upcoming', { scheduledDate: '2026-11-21', scheduledTime: '15:00' }),
    match('m4', 'upcoming'),
    match('m5', 'upcoming', { team2: { id: 'bye', name: 'BYE', isBye: true } } as Partial<Match>),
  ] } as unknown as BracketDraft;
  const lanes = matchMap([bracket]);
  assert.equal(lanes.length, 1);
  assert.deepEqual(lanes[0].tiles.map(tile => tile.id), ['m1', 'm3', 'm4', 'm2']);
  assert.deepEqual(mapTotals(lanes), { done: 1, live: 1, alert: 0, scheduled: 1, pending: 1 });
  assert.match(lanes[0].tiles[3].detail, /^Live · 1–0/);
});
