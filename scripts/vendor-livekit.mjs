// Copies the LiveKit browser client next to pov.html, the plain page players use to share a PC screen.
// pov.html is not bundled by Vite (it also runs from the hosted join site), so it loads this file from /vendor.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = 'node_modules/livekit-client/';
const { version } = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
const source = readFileSync(root + 'dist/livekit-client.umd.js', 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
mkdirSync('public/vendor', { recursive: true });
writeFileSync('public/vendor/livekit-client.umd.js', `/*! livekit-client ${version} | Apache-2.0 | https://github.com/livekit/client-sdk-js */\n` + source);
console.log(`Copied livekit-client ${version} to public/vendor.`);
