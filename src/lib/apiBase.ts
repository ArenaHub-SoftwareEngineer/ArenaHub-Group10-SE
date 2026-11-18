/**
 * Where the browser sends API calls. Empty (the default) means the same origin as the site, which is how
 * npm start, npm run demo and the Vite dev server work. Set VITE_API_BASE_URL when the API runs on another
 * host, for example https://arenahub-api.vercel.app, and list the site in that host's CORS_ORIGINS.
 * This is a public address, not a secret. A hosted match monitor needs the persistent Node entry point.
 */
const base = String((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function apiUrl(path: `/api/${string}`): string {
  return `${base}${path}`;
}
