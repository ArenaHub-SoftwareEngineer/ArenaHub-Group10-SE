import express from 'express';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createAiRouter } from './ai';
import { createFairPlayRouter } from './fairPlay';
import { createIntegrityRouter } from './integrity';
import { publicAccessGuard } from './publicAccess';
config({ path: '.env' }); config({ path: '.env.local', override: true });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
// Online mode (npm run online): requests through the public tunnel may only reach the player pages.
app.use(publicAccessGuard(process.env));
app.use('/api/ai', createAiRouter(process.env));
app.use('/api/fair-play', createFairPlayRouter(process.env));
app.use('/api/integrity', createIntegrityRouter(process.env));
// SITE_DIR lets the local demo (npm run demo) serve its own build, so dist/ (what gets deployed) never holds it.
const site = resolve(process.env.SITE_DIR || 'dist');
app.use(express.static(site));
app.get('*', (_req, res) => res.sendFile(resolve(site, 'index.html')));
// Port 3210, not 3000: other local projects (FloodSight) use 3000 and leave a service worker on localhost:3000
// that keeps serving their cached page, so ArenaHub needs its own origin.
// HOST=0.0.0.0 lets phones and PCs on the event Wi-Fi reach this laptop (LAN mode). The default stays local only.
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3210);
app.listen(port, host, () => console.log(`ArenaHub available at http://localhost:${port}${host === '0.0.0.0' ? ' and on this laptop\'s Wi-Fi address (LAN mode)' : ''}${process.env.INTEGRITY_PUBLIC_URL ? `\nPlayers can join from anywhere at ${process.env.INTEGRITY_PUBLIC_URL} (online mode)` : ''}`));
