// Online mode: a Cloudflare tunnel gives this laptop a public https address so players on any Wi-Fi or
// mobile data can reach it. Only the player-facing routes are reachable that way. Staff pages, the
// staff API, recordings and the AI and video-review routes stay on the laptop (localhost or LAN).
import type express from 'express';

const PLAYER_PATHS = [
  /^\/pov\.(html|js|css)$/,
  /^\/api\/integrity\/device\/pov\/(info|token)$/,
  /^\/vendor\/livekit-client\.umd\.js$/,
  /^\/api\/integrity\/device\/checkin\/[A-Za-z0-9_-]{12}\/matches$/,
  /^\/join\.html$/,
  /^\/player-check-in$/,
  /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(js|css)$/,
  /^\/arenahub-logo\.svg$/,
  /^\/fonts\/google-sans-flex-latin\.woff2$/,
  /^\/api\/integrity\/device\/[a-z]+(\/[A-Za-z0-9]{1,12})?$/,
  /^\/api\/integrity\/device\/checkin\/[A-Za-z0-9_-]{12}$/,
  /^\/api\/integrity\/downloads\/[a-z0-9.-]+$/,
  /^\/api\/integrity\/practice\/(policy|check)$/,
  /^\/api\/integrity\/dota\/gsi$/,
];

/** True when the request came in through the tunnel rather than from this laptop or the event Wi-Fi. */
export function viaTunnel(req: express.Request, publicUrl: string | undefined) {
  if (req.get('cf-ray') || req.get('cf-connecting-ip')) return true;
  if (!publicUrl) return false;
  try { return new URL(publicUrl).host === req.get('host'); } catch { return false; }
}

export function playerPathAllowed(path: string) {
  return PLAYER_PATHS.some(rule => rule.test(path));
}

export function publicAccessGuard(env: Record<string, string | undefined>): express.RequestHandler {
  return (req, res, next) => {
    // A fully hosted service exposes the authenticated staff UI/API too, including behind Cloudflare.
    // The player-only guard belongs to the separate event-laptop tunnel mode.
    if (env.INTEGRITY_HOSTED_URL) { next(); return; }
    if (!viaTunnel(req, env.INTEGRITY_PUBLIC_URL)) { next(); return; }
    if (req.path === '/') { res.redirect(302, '/join.html'); return; }
    if (playerPathAllowed(req.path)) { next(); return; }
    res.status(404).type('text/plain').set('Cache-Control', 'no-store').send('This address is only for players joining a match. Scan the QR code from the referee.');
  };
}

/** The player's real address for rate limits. Behind the tunnel every request arrives from this laptop. */
export function clientAddress(req: express.Request) {
  // Vercel overwrites x-real-ip with the visitor's address, so on Vercel it can be trusted. Without it,
  // every player would share the proxy's address and one room would hit the rate limit together.
  const vercel = process.env.VERCEL === '1' ? req.get('x-real-ip') : undefined;
  if (vercel && /^[0-9a-fA-F:.]{3,45}$/.test(vercel)) return vercel;
  const loopback = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');
  const forwarded = loopback ? req.get('cf-connecting-ip') : undefined;
  return forwarded && /^[0-9a-fA-F:.]{3,45}$/.test(forwarded) ? forwarded : String(req.ip);
}
