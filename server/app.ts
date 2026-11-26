// Builds the ArenaHub Express app. server/index.ts runs it on the event laptop (npm start, npm run demo);
// api/index.ts exports it for a serverless host. See docs/DEPLOY.md.
import express from 'express';
import { resolve } from 'node:path';
import { createAiRouter } from './ai';
import { createFairPlayRouter } from './fairPlay';
import { createIntegrityRouter } from './integrity';
import { publicAccessGuard, viaTunnel } from './publicAccess';
import { createPresenceRouter } from './presence';
import { createEmailVerificationRouter } from './emailVerification';
import { corsPolicy } from './cors';
import { adminMode } from './firebaseAdmin';
import { publicErrorHandler, securityHeaders } from './securityHeaders';

export interface AppOptions {
  /** Folder with the built site to serve, or null for an API-only deployment. */
  site?: string | null;
  /**
   * The match monitor. On the laptop it keeps SQLite and recordings on disk. On a serverless host it needs
   * INTEGRITY_STORE=firestore (see server/firestoreIntegrityStore.ts); otherwise leave it off there.
   */
  integrity?: boolean;
  /**
   * Hosted player address: a folder holding join.html and its font and logo. "/" opens the join page, so
   * players type only the host name. Used by api/index.ts on Vercel.
   */
  joinSite?: string | null;
}

/** A monitor that could not start (for example no service account) answers 503 instead of taking the AI routes down with it. */
function integrityOrUnavailable(env: Record<string, string | undefined>): express.RequestHandler {
  try { return createIntegrityRouter(env); }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'The match monitor could not start.';
    console.error(`[integrity] ${reason}`);
    return (_req, res) => { res.status(503).set('Cache-Control', 'no-store').json({ error: 'The anti-cheat server is not set up yet. Ask the organizer.' }); };
  }
}

export function createApp(env: Record<string, string | undefined>, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders({ site: options.site || options.joinSite }));
  // Online mode (npm run online): requests through the public tunnel may only reach the player pages.
  app.use(publicAccessGuard(env));

  const cors = corsPolicy(env);
  // Readiness only: true/false per feature, never key values or versions.
  app.get('/api/health', cors, (_req, res) => {
    const access = adminMode(env);
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      // The assistant always answers from live records; these say whether a model can explain too.
      assistant: Boolean(env.GEMINI_API_KEY || env.GROQ_API_KEY),
      backupModel: Boolean(env.GROQ_API_KEY),
      videoReview: Boolean(env.GEMINI_API_KEY),
      firebaseProject: Boolean(env.VITE_FIREBASE_PROJECT_ID),
      // 'rest' means no service account: sign-in still works, but rate limits are per server instance
      // and Arena AI cannot post in live chat.
      firebaseAccess: access,
    });
  });
  app.use('/api/presence', cors, createPresenceRouter());
  app.use('/api/account', cors, createEmailVerificationRouter(env));
  app.use('/api/ai', cors, createAiRouter(env));
  app.use('/api/fair-play', cors, createFairPlayRouter(env));
  if (options.integrity !== false) app.use('/api/integrity', cors, integrityOrUnavailable(env));
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown API route.' }); });

  if (options.joinSite) {
    const site = resolve(options.joinSite), page = resolve(site, 'join.html');
    app.get(['/', '/join', '/join.html'], (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(page));
    app.get(['/arenahub-logo.svg', '/fonts/:file', '/pov.html', '/pov.js', '/pov.css', '/vendor/livekit-client.umd.js'], express.static(site, { index: false, fallthrough: false, maxAge: '1d', setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.use((_req, res) => { res.redirect(302, '/'); });
  }

  if (options.site) {
    const site = resolve(options.site);
    app.use(express.static(site));
    app.get('*', (req, res) => {
      if (!env.INTEGRITY_HOSTED_URL && viaTunnel(req, env.INTEGRITY_PUBLIC_URL) && req.path !== '/player-check-in') { res.sendStatus(404); return; }
      res.sendFile(resolve(site, 'index.html'));
    });
  }
  app.use(publicErrorHandler);
  return app;
}
