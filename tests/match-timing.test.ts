import test from 'node:test';
import * as timing from '../src/lib/matchTiming';
import assert from 'node:assert/strict';
import { clock24, clockLabel, clockOptions, endRangeLabel, estimateMatch, gamesInFormat, overlaps, parseClock, timingGame } from '../src/lib/matchTiming';

test('typed times are read the way people write them', () => {
  const cases: Array<[string, number | null]> = [
    ['8pm', 20 * 60], ['8 PM', 20 * 60], ['8:30 pm', 20 * 60 + 30], ['8.30PM', 20 * 60 + 30], ['830pm', 20 * 60 + 30],
    ['7:05 a.m.', 7 * 60 + 5], ['12am', 0], ['12:15 pm', 12 * 60 + 15], ['8p', 20 * 60],
    ['20:30', 20 * 60 + 30], ['2030', 20 * 60 + 30], ['0830', 8 * 60 + 30], ['8', 8 * 60], ['0:00', 0],
    ['13pm', null], ['0am', null], ['24:00', null], ['8:60', null], ['', null], ['eight', null], ['8:3', null],
  ];
  for (const [input, minutes] of cases) assert.equal(parseClock(input), minutes, input);
});

test('times show as 12-hour labels and store as 24-hour', () => {
  assert.equal(clockLabel(0), '12:00 AM');
  assert.equal(clockLabel(12 * 60), '12:00 PM');
  assert.equal(clockLabel(20 * 60 + 5), '8:05 PM');
  assert.equal(clockLabel(24 * 60 + 30), '12:30 AM next day');
  assert.equal(clock24(20 * 60 + 5), '20:05');
  assert.equal(clockOptions(30).length, 48);
  assert.equal(clockOptions(30)[41], 20 * 60 + 30);
});

test('the game is found from ids, names and the BR mode', () => {
  assert.equal(timingGame('game-dota2'), 'dota2');
  assert.equal(timingGame('game-draft', 'Mobile Legends: Bang Bang'), 'mlbb');
  assert.equal(timingGame('game-codm-br'), 'codm-br');
  assert.equal(timingGame('CODM Battle Royale'), 'codm-br');
  assert.equal(timingGame('game-codm-mp'), 'codm-mp');
  assert.equal(timingGame('game-1', 'br'), 'codm-br');
  assert.equal(timingGame('game-1', 'Valorant'), undefined);
});

test('a best-of-3 ends after 2 games at the earliest and 3 at the latest, with breaks between', () => {
  assert.equal(gamesInFormat('Bo3'), 3);
  assert.equal(gamesInFormat('weird'), 1);
  const bo3 = estimateMatch(20 * 60, 'Bo3', 'mlbb');
  assert.deepEqual([bo3.gamesMin, bo3.gamesMax], [2, 3]);
  assert.equal(bo3.earliestEnd, 20 * 60 + 2 * 20 + 10);
  assert.equal(bo3.latestEnd, 20 * 60 + 3 * 20 + 2 * 10);
  assert.equal(endRangeLabel(bo3), '8:50 to 9:20 PM');
  const bo1 = estimateMatch(20 * 60, 'Bo1', 'dota2');
  assert.equal(endRangeLabel(bo1), '8:45 PM');
  assert.equal(estimateMatch(20 * 60, 'Bo1').gameMinutes, 30, 'an unknown game uses 30 minutes');
  assert.equal(endRangeLabel(estimateMatch(11 * 60 + 30, 'Bo3', 'dota2')), '1:10 to 2:05 PM');
  assert.equal(endRangeLabel(estimateMatch(11 * 60, 'Bo3', 'mlbb')), '11:50 AM to 12:20 PM');
  assert.equal(endRangeLabel(estimateMatch(23 * 60, 'Bo3', 'dota2')), '12:40 to 1:35 AM next day');
});

test('matches overlap only when one starts before the other could end', () => {
  const slot = (start: number, format: string) => { const e = estimateMatch(start, format, 'mlbb'); return { start, end: e.latestEnd }; };
  const first = slot(20 * 60, 'Bo3');
  assert.equal(overlaps(first, slot(21 * 60, 'Bo1')), true);
  assert.equal(overlaps(first, slot(21 * 60 + 20, 'Bo1')), false);
  assert.equal(overlaps(first, slot(19 * 60, 'Bo1')), false);
});

test("a match's slot uses the organizer's end time, or the estimate when none is set", () => {
  const { matchSlot, slotLabel, durationLabel, rangeLabel } = timing;
  const set = matchSlot({ scheduledTime: '20:00', scheduledEndTime: '21:30', matchFormat: 'Bo3' }, 'mlbb')!;
  assert.deepEqual(set, { start: 1200, end: 1290, endSet: true });
  assert.equal(slotLabel(set), '8:00 to 9:30 PM');
  const guessed = matchSlot({ scheduledTime: '20:00', matchFormat: 'Bo3' }, 'mlbb')!;
  assert.equal(slotLabel(guessed), '8:00 PM to about 9:20 PM');
  assert.equal(matchSlot({ scheduledTime: '20:00', scheduledEndTime: '19:00', matchFormat: 'Bo1' }, 'mlbb')!.endSet, false, 'an end before the start is ignored');
  assert.equal(matchSlot({ scheduledTime: 'Automatic Advance' }), null);
  assert.equal(rangeLabel(11 * 60 + 30, 12 * 60 + 40), '11:30 AM to 12:40 PM');
  assert.deepEqual([durationLabel(50), durationLabel(80), durationLabel(120)], ['50 min', '1 h 20 min', '2 h']);
});

test('the time list narrows to what was typed so far', () => {
  const { clockOptions, clockLabel } = timing;
  const shown = (typed: string) => clockOptions(30).filter(m => timing.timeMatchesTyped(m, typed)).map(clockLabel);
  assert.deepEqual(shown('7:3'), ['7:30 AM', '7:30 PM']);
  assert.deepEqual(shown('7:30 pm'), ['7:30 PM']);
  assert.deepEqual(shown('8p'), ['8:00 PM', '8:30 PM']);
  assert.deepEqual(shown('19'), ['7:00 PM', '7:30 PM']);
  assert.deepEqual(shown('8:45 pm'), [], 'a time between list steps hides the list; the typed time is still used');
  assert.equal(shown('').length, 48);
});

test('public schedules show the organizer end time but never an estimate', () => {
  assert.equal(timing.scheduleTimeLabel({ scheduledTime: '19:30', scheduledEndTime: '21:00' }), '7:30 to 9:00 PM');
  assert.equal(timing.scheduleTimeLabel({ scheduledTime: '19:30' }), '7:30 PM');
  assert.equal(timing.scheduleTimeLabel({ scheduledTime: 'Round 2' }), 'Round 2');
});
