// Builds the ArenaHub Express app. server/index.ts runs it on the event laptop (npm start, npm run demo);
// api/index.ts exports it for a serverless host. See docs/DEPLOY.md.
import express from 'express';
import { resolve } from 'node:path';
import { createAiRouter } from './ai';
import { createFairPlayRouter } from './fairPlay';
import { createIntegrityRouter } from './integrity';
import { publicAccessGuard } from './publicAccess';
import { corsPolicy } from './cors';
import { adminMode } from './firebaseAdmin';

export interface AppOptions {
  /** Folder with the built site to serve, or null for an API-only deployment. */
  site?: string | null;
  /** The match monitor keeps recordings on local disk, so it runs only on the event laptop. */
  integrity?: boolean;
}

export function createApp(env: Record<string, string | undefined>, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
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
  app.use('/api/ai', cors, createAiRouter(env));
  app.use('/api/fair-play', cors, createFairPlayRouter(env));
  if (options.integrity !== false) app.use('/api/integrity', createIntegrityRouter(env));
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown API route.' }); });

  if (options.site) {
    const site = resolve(options.site);
    app.use(express.static(site));
    app.get('*', (_req, res) => res.sendFile(resolve(site, 'index.html')));
  }
  return app;
}
