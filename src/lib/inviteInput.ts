const inviteToken = /^[a-f0-9]{48}$/;
/** Read an invitation; never navigate to a URL supplied by a QR code. */
export function parseInviteInput(value: string, siteUrl: string): string {
  const input = value.trim();
  if (inviteToken.test(input)) return input;
  try {
    const site = new URL(siteUrl), url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== site.origin || url.pathname.replace(/\/+$/, '') !== site.pathname.replace(/\/+$/, '') || url.searchParams.getAll('spectatorInvite').length !== 1) throw new Error();
    const token = url.searchParams.get('spectatorInvite') || '';
    if (inviteToken.test(token)) return token;
  } catch { /* Show the same useful error for malformed and unrelated codes. */ }
  throw new Error('Use a current ArenaHub student invitation QR, its link, or its 48-character invitation code. Old event pass codes do not grant admission.');
}
