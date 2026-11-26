// Vercel build step (vercel.json). ArenaHub lives at one address: Vercel serves the built website (dist/,
// made locally by `npm run deploy` before upload) as static files, and only /api/* reaches the function in
// api/index.js. The join page (join.html), the PC screen page (pov.*) and the LiveKit client are part of
// dist/ because Vite copies public/ into it.
import { cpSync, existsSync, mkdirSync } from 'node:fs';

for (const file of ['dist/index.html', 'dist/join.html', 'dist/arenahub-logo.svg', 'dist/pov.html', 'dist/pov.js', 'dist/pov.css', 'dist/vendor/livekit-client.umd.js']) {
  if (!existsSync(file)) throw new Error(`${file} is missing. Run npm run deploy (it builds the website first).`);
}
mkdirSync('dist-vercel', { recursive: true });
cpSync('dist', 'dist-vercel', { recursive: true });
console.log('dist-vercel/ ready: the website as static files; /api/* goes to api/index.js.');
