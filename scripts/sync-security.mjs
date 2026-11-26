import { readFileSync, writeFileSync } from 'node:fs';
import { inlineScriptHashes, securityHeaderValues } from '../server/securityPolicy.mjs';

const config = JSON.parse(readFileSync('firebase.json', 'utf8'));
const values = securityHeaderValues(inlineScriptHashes(['index.html', 'public/join.html']));
const rules = config.hosting.headers ||= [];
const global = rules.find(rule => rule.source === '**');
if (!global) throw new Error('The static hosting global header rule is missing.');
const retained = global.headers.filter(header => !Object.hasOwn(values, header.key));
global.headers = [...retained, ...Object.entries(values).map(([key, value]) => ({ key, value }))];
writeFileSync('firebase.json', JSON.stringify(config, null, 2) + '\n');
console.log('Updated static security headers and the exact join-page script fingerprint.');

// The same headers for the Vercel host, which serves the website and the API at one address.
// The function sets its own headers on /api/*, so this rule covers every other path.
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const site = (vercel.headers ||= []).find(rule => rule.source === '/((?!api/).*)');
if (!site) throw new Error('The Vercel site header rule is missing.');
site.headers = Object.entries(values).map(([key, value]) => ({ key, value }));
writeFileSync('vercel.json', JSON.stringify(vercel, null, 2) + '\n');
console.log('Updated the Vercel site headers to match.');
