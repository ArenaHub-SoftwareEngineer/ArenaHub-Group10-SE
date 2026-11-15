import { config } from 'dotenv';
import { createApp } from './app';
config({ path: '.env' }); config({ path: '.env.local', override: true });

// SITE_DIR lets the local demo (npm run demo) serve its own build, so dist/ (what gets deployed) never holds it.
const app = createApp(process.env, { site: process.env.SITE_DIR || 'dist' });
// Port 3210, not 3000: other local projects (FloodSight) use 3000 and leave a service worker on localhost:3000
// that keeps serving their cached page, so ArenaHub needs its own origin.
// HOST=0.0.0.0 lets phones and PCs on the event Wi-Fi reach this laptop (LAN mode). The default stays local only.
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3210);
app.listen(port, host, () => console.log(`ArenaHub available at http://localhost:${port}${host === '0.0.0.0' ? ' and on this laptop\'s Wi-Fi address (LAN mode)' : ''}${process.env.INTEGRITY_PUBLIC_URL ? `\nPlayers can join from anywhere at ${process.env.INTEGRITY_PUBLIC_URL} (online mode)` : ''}`));
