// Shared by the event server and static-hosting build, so both serve the same browser protections.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export function inlineScriptHashes(files) {
  const hashes = new Set();
  for (const file of files) {
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) hashes.add(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  }
  return [...hashes];
}

export function securityHeaderValues(hashes = []) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      `script-src 'self' https://apis.google.com https://accounts.google.com https://www.gstatic.com https://www.google.com https://www.recaptcha.net ${hashes.join(' ')}`.trim(),
      "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    ].join('; '),
  };
}
