import test from 'node:test';
import { parseStreamSchedule } from '../src/lib/streamSchedule';
import { replacePublishedBracket } from '../src/lib/bracketPublication';
import type { BracketDraft, Match } from '../src/lib/types';
import assert from 'node:assert/strict';
import { buildEmbedUrl, detectPlatform, streamWatchUrl } from '../src/lib/streamUtils';

test('Facebook video permalinks and saved embeds round-trip without nesting players', () => {
  for (const url of ['https://www.facebook.com/NASA/videos/12345/', 'https://m.facebook.com/watch/?v=12345', 'https://www.facebook.com/video.php?v=12345', 'https://www.facebook.com/reel/12345']) {
    const embed = buildEmbedUrl(url, detectPlatform(url))!;
    assert.ok(embed);
    assert.equal(buildEmbedUrl(embed, 'facebook'), embed);
    assert.equal(streamWatchUrl(embed), url);
  }
});
test('Facebook profiles, share links, malicious nested embeds and unsupported live providers are rejected', () => {
  for (const url of ['https://facebook.com/NASA', 'https://facebook.com/groups/12345', 'https://facebook.com/share/v/abc', 'https://fb.watch/abc/', 'https://facebook.com/watch/?v=abc', 'https://tiktok.com/@test/live', 'https://facebook.com/plugins/video.php?href=https://evil.test/videos/12345', 'https://facebook.com/plugins/video.php?href=https://facebook.com/plugins/video.php']) assert.equal(buildEmbedUrl(url, detectPlatform(url)), null, url);
});
test('YouTube mobile, shared and saved player URLs produce the same playable ID and safe recovery link', () => {
  for (const url of ['https://youtu.be/0P41gTF-Nl4?si=shared', 'https://m.youtube.com/watch?v=0P41gTF-Nl4&t=20', 'https://youtube.com/live/0P41gTF-Nl4', 'https://youtube.com/embed/0P41gTF-Nl4']) {
    const embed = buildEmbedUrl(url, detectPlatform(url))!;
    assert.equal(buildEmbedUrl(embed, 'youtube'), embed);
    assert.equal(new URL(embed).searchParams.get('mute'), '1');
    assert.equal(new URL(embed).searchParams.get('playsinline'), '1');
    assert.equal(streamWatchUrl(embed), 'https://www.youtube.com/watch?v=0P41gTF-Nl4');
  }
  assert.equal(streamWatchUrl('javascript:alert(1)'), null);
});

test('broadcast schedules normalize CSV and typed instructions and reject unsafe updates', () => {
  const matches = [
    { id: 'mlbb-round-1', matchNumber: '#M1', status: 'upcoming' },
    { id: 'mlbb-round-2', matchNumber: '#M2', status: 'live' },
  ] as Match[];
  const expected = [{ id: 'mlbb-round-1', scheduledDate: '2026-12-04', scheduledTime: '19:30' }];
  assert.deepEqual(parseStreamSchedule('match_id,date,time\n"M1","2026-12-04","7:30 PM"', matches), expected);
  assert.deepEqual(parseStreamSchedule('Schedule #M1 on 2026-12-04 at 19:30', matches), expected);
  assert.throws(() => parseStreamSchedule('M3,2026-12-04,19:30', matches), /outside/);
  assert.throws(() => parseStreamSchedule('M2,2026-12-04,19:30', matches), /yet to start/);
  assert.throws(() => parseStreamSchedule('M1,2026-02-30,19:30', matches), /calendar date/);
  assert.throws(() => parseStreamSchedule('M1,2026-12-04,14:30 PM', matches), /valid time/);
  assert.throws(() => parseStreamSchedule('M1,2026-12-04,19:30\nmlbb-round-1,2026-12-05,20:30', matches), /more than once/);
});

test('publication replaces a game atomically and restores its previous bracket and schedule', () => {
  const first = { id: 'first', gameName: 'Mobile Legends', matches: [{ scheduledTime: '15:00' }] } as BracketDraft;
  const next = { id: 'second', gameName: 'Mobile Legends: Bang Bang', gameId: 'game-mlbb', matches: [{ scheduledTime: '19:00' }] } as BracketDraft;
  const dota = { id: 'dota', gameName: 'Dota 2', matches: [] } as unknown as BracketDraft;
  const published = replacePublishedBracket([first, dota], [], next);
  assert.deepEqual(published.published, [dota, next]);
  assert.deepEqual(published.previous, [first]);
  const restored = replacePublishedBracket(published.published, published.previous, published.previous[0]);
  assert.deepEqual(restored.published, [dota, first]);
  assert.deepEqual(restored.previous, [next]);
  assert.throws(() => replacePublishedBracket([first], [], { ...first, gameName: 'Dota 2' }), /another game/);
});
