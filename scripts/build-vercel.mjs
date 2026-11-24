// Vercel build step (vercel.json). The function in api/index.ts serves everything, including the join page,
// so the static output holds only robots.txt. Keeping it empty means no source or website file can be
// published from this project by accident. The website itself stays on Firebase Hosting.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

// The PC screen-sharing page (pov.html) loads the LiveKit client from public/vendor.
await import('./vendor-livekit.mjs');

for (const file of ['public/join.html', 'public/arenahub-logo.svg', 'public/pov.html', 'public/pov.js', 'public/pov.css', 'public/vendor/livekit-client.umd.js']) if (!existsSync(file)) throw new Error(`${file} is missing; the join page needs it.`);
mkdirSync('dist-vercel', { recursive: true });
writeFileSync('dist-vercel/robots.txt', 'User-agent: *\nDisallow: /\n');
console.log('dist-vercel/ ready (robots.txt only). Every request is handled by api/index.ts.');
