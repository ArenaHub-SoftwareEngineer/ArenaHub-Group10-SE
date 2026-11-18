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
