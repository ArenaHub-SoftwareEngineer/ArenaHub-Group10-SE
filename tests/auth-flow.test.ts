import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { parseInviteInput } from '../src/lib/inviteInput';
import { authErrorMessage } from '../src/lib/authMessages';

test('invitation input accepts current-site links and opaque tokens without navigating away', () => {
  const token = 'a'.repeat(48), site = 'https://arena.example/school/';
  assert.equal(parseInviteInput(token, site), token);
  assert.equal(parseInviteInput(`${site}?spectatorInvite=${token}`, site), token);
  assert.equal(parseInviteInput(`  ${site}?spectatorInvite=${token}  `, site), token);
  for (const input of ['WSI319', 'WMSU-2026-PASS', `https://evil.example/school/?spectatorInvite=${token}`, `https://arena.example/other/?spectatorInvite=${token}`, `https://user:pass@arena.example/school/?spectatorInvite=${token}`, `javascript:alert(1)`, `${site}?spectatorInvite=${token}&spectatorInvite=${token}`, `${site}?spectatorInvite=short`]) assert.throws(() => parseInviteInput(input, site), /current ArenaHub/);
});
test('the real QR decoder recovers an encoded student invitation from image pixels', () => {
  const input = `https://arena.example/?spectatorInvite=${'b'.repeat(48)}`, qr = QRCode.create(input), size = qr.modules.size, scale = 7, margin = 4, width = (size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const qx = Math.floor(x / scale) - margin, qy = Math.floor(y / scale) - margin;
    if (qx >= 0 && qy >= 0 && qx < size && qy < size && qr.modules.get(qy, qx)) { const at = (y * width + x) * 4; pixels[at] = pixels[at + 1] = pixels[at + 2] = 0; }
  }
  assert.equal(jsQR(pixels, width, width)?.data, input);
  assert.equal(jsQR(new Uint8ClampedArray(32 * 32 * 4).fill(255), 32, 32), null);
});
test('Google cancellation and configuration failures have actionable messages', () => {
  assert.match(authErrorMessage({ code: 'auth/popup-closed-by-user' }), /canceled/);
  assert.match(authErrorMessage({ code: 'auth/popup-blocked' }), /Continue in this tab/);
  assert.match(authErrorMessage({ code: 'auth/unauthorized-domain' }), /website address/);
  assert.match(authErrorMessage({ code: 'auth/email-already-in-use' }), /Sign in instead/);
  assert.ok(!authErrorMessage({ code: 'auth/unknown', message: 'sensitive debug output' }).includes('sensitive'));
});

import { CAMPUS_DOMAIN, hasCampusEmail, acceptsGoogleAccount } from '../src/lib/institution';
import { institutionalGoogleProvider } from '../src/lib/googleAuth';

test('Google authentication accepts only verified exact institutional domains', () => {
  assert.equal(CAMPUS_DOMAIN, 'wmsu.edu.ph');
  for (const email of ['student@wmsu.edu.ph', '  Student@WMSU.EDU.PH  ']) {
    assert.equal(hasCampusEmail(email), true);
    assert.equal(acceptsGoogleAccount({ email, emailVerified: true }), true);
  }
  for (const email of ['student@gmail.com', 'student@up.edu.ph', 'student@sub.wmsu.edu.ph', 'student@wmsu.edu.ph.evil.test', 'student@notwmsu.edu.ph', 'student@wmsu.edu.ph@evil.test', '@wmsu.edu.ph', 'bad name@wmsu.edu.ph', null]) {
    assert.equal(acceptsGoogleAccount({ email, emailVerified: true }), false);
  }
  assert.equal(acceptsGoogleAccount({ email: 'student@wmsu.edu.ph', emailVerified: false }), false);
  assert.deepEqual(institutionalGoogleProvider().getCustomParameters(), { prompt: 'select_account', hd: CAMPUS_DOMAIN });
});
