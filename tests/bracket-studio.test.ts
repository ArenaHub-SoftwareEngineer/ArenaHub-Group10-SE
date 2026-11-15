import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBracketSyncErrorMessage } from '../src/components/admin/bracket-studio/shared';

test('an unpublish failure says the bracket is still published, never "on this device"', () => {
  const denied = getBracketSyncErrorMessage({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }, 'Unpublished');
  assert.match(denied, /^The bracket is still published: Firebase denied the write/);
  assert.doesNotMatch(denied, /on this device/);
  assert.match(getBracketSyncErrorMessage(new Error('A newer version of this bracket was saved. Reload before unpublishing.'), 'Unpublished'), /another organizer changed it first/);
  assert.match(getBracketSyncErrorMessage({ code: 'unavailable' }, 'Unpublished'), /still published: Firebase is currently unreachable/);
});

test('save and publish failures keep their wording', () => {
  assert.match(getBracketSyncErrorMessage({ code: 'unavailable' }, 'Saved'), /^Saved on this device, but Firebase is currently unreachable/);
  assert.match(getBracketSyncErrorMessage('boom', 'Published'), /^Published on this device, but live sync failed/);
});
