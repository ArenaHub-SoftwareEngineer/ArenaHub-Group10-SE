// Serverless entry (Vercel). Bundled into api/index.js by scripts/bundle-vercel-api.mjs (npm run deploy:api), because
// Vercel's Node runtime cannot resolve this code's extensionless imports. See docs/DEPLOY.md. The website stays on Firebase Hosting.
// - Always: /api/health, /api/ai, /api/fair-play and /api/presence.
// - With INTEGRITY_STORE=firestore: the match monitor (/api/integrity) on Firestore, and the player join page
//   at "/" so players type only this host's name. It needs FIREBASE_SERVICE_ACCOUNT_JSON.
// Configuration comes from the host's environment variables; nothing is read from .env files here.
import { resolve } from 'node:path';
import { createApp } from './app';

const hosted = process.env.INTEGRITY_STORE === 'firestore';
export default createApp(process.env, { site: null, integrity: hosted, joinSite: hosted ? resolve(process.cwd(), 'public') : null });
