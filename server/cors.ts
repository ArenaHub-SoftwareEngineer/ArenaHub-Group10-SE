// Origin policy for the browser-facing API (/api/ai, /api/fair-play, /api/health).
// Same-host requests are always allowed. When the API runs on a different host from the website
// (for example the site on Firebase Hosting and the API on Vercel), list the site's origins in
// CORS_ORIGINS, comma-separated: CORS_ORIGINS=https://arenahub-platform.web.app,https://arenahub-platform.firebaseapp.com
// The API authenticates with Bearer ID tokens, never cookies, so allowed cross-origin calls carry no CSRF risk.
import type express from 'express';

/** Normalized allowlist. Only https origins are accepted, plus http://localhost for development. */
export function allowedOrigins(env: Record<string, string | undefined>): Set<string> {
  const origins = new Set<string>();
  for (const raw of (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    try {
      const url = new URL(raw);
      const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
      if ((url.protocol === 'https:' || local) && url.pathname === '/' && !url.search && !url.username) origins.add(url.origin);
    } catch { /* ignored: an invalid entry never widens access */ }
  }
  return origins;
}

/** True when the request has no Origin (server-to-server, curl), comes from the same host, or from the allowlist. */
export function originAllowed(req: express.Request, env: Record<string, string | undefined>, list = allowedOrigins(env)): boolean {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.host === req.get('host') || list.has(url.origin);
  } catch { return false; }
}

/** Adds CORS headers for allowlisted origins and answers preflight requests. */
export function corsPolicy(env: Record<string, string | undefined>): express.RequestHandler {
  const list = allowedOrigins(env);
  return (req, res, next) => {
    const origin = req.get('origin');
    res.vary('Origin');
    if (origin && list.has(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
    }
    if (req.method === 'OPTIONS') { res.status(originAllowed(req, env, list) ? 204 : 403).end(); return; }
    next();
  };
}
