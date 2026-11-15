import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditLine, DEFAULT_MUTE_MINUTES, formatCountdown, isReservedChatName, isStaffRole, MUTE_PRESETS, muteSecondsLeft,
  slowModeLabel, slowModeSecondsLeft, SLOW_MODE_OPTIONS,
} from '../src/lib/chatModeration';
import { readFileSync } from 'node:fs';

test('mute presets match the proposal: 5, 10, 20, 60 minutes, default 20', () => {
  assert.deepEqual([...MUTE_PRESETS], [5, 10, 20, 60]);
  assert.equal(DEFAULT_MUTE_MINUTES, 20);
});

test('mute countdown', () => {
  assert.equal(muteSecondsLeft(undefined, 1000), 0);
  assert.equal(muteSecondsLeft(61_000, 1_000), 60);
  assert.equal(muteSecondsLeft(1_500, 1_000), 1);
  assert.equal(muteSecondsLeft(1_000, 5_000), 0);
});

test('slow mode countdown keeps a 2 second floor and exempts staff', () => {
  assert.equal(slowModeSecondsLeft(undefined, 30, 0), 0);
  const sent = 100_000;
  assert.equal(slowModeSecondsLeft(sent, 0, sent + 1_000), 1);
  assert.equal(slowModeSecondsLeft(sent, 0, sent + 2_000), 0);
  assert.equal(slowModeSecondsLeft(sent, 30, sent + 10_000), 20);
  assert.equal(slowModeSecondsLeft(sent, 30, sent + 10_000, true), 0);
});

test('countdown and labels', () => {
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(formatCountdown(1199), '19:59');
  assert.equal(formatCountdown(3900), '1:05:00');
  assert.equal(slowModeLabel(0), 'Off');
  assert.equal(slowModeLabel(30), '30 seconds');
  assert.equal(slowModeLabel(60), '1 minute');
  assert.equal(slowModeLabel(120), '2 minutes');
});

test('reserved assistant name', () => {
  for (const name of ['Arena AI', 'arena ai', 'ArenaAI', '[Arena-AI]', ' arena_ai ']) assert.ok(isReservedChatName(name), name);
  for (const name of ['Arena Aiden', 'Maria Arena', 'Anonymous', 'AI Arena']) assert.ok(!isReservedChatName(name), name);
});

test('staff roles match the rules', () => {
  for (const role of ['admin', 'organizer', 'school-admin', 'moderator']) assert.ok(isStaffRole(role));
  for (const role of ['user', 'player', 'spectator', undefined]) assert.ok(!isStaffRole(role));
});

test('audit lines carry ids and durations, never free text', () => {
  assert.equal(auditLine('m1', { kind: 'mute', minutes: 20 }, 'u1'), 'Chat mute 20 min in match m1 (target u1)');
  assert.equal(auditLine('m1', { kind: 'kick' }, 'u1'), 'Chat kick 6 h in match m1 (target u1)');
  assert.equal(auditLine('m1', { kind: 'slow-mode', seconds: 30 }), 'Chat slow-mode 30 s in match m1');
});

test('client options stay in step with firestore.rules', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.ok(rules.includes(`slowModeSec in [${SLOW_MODE_OPTIONS.join(', ')}]`), 'slow-mode values differ between client and rules');
  assert.ok(rules.includes("duration.value(24, 'h')"), 'the rules cap mutes at 24 hours');
});
