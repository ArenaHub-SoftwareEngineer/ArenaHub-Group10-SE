import type { ErrorRequestHandler, RequestHandler } from 'express';
import { join } from 'node:path';
import { inlineScriptHashes, securityHeaderValues } from './securityPolicy.mjs';

export function securityHeaders(options: { site?: string | null; development?: boolean } = {}): RequestHandler {
  const hashes = options.site ? inlineScriptHashes([join(options.site, 'index.html'), join(options.site, 'join.html')]) : [];
  const headers: Record<string, string> = securityHeaderValues(hashes);
  // Vite adds development-only inline bootstrapping. Production never needs this exemption.
  if (options.development) delete headers['Content-Security-Policy'];
  return (_req, res, next) => { res.set(headers); next(); };
}

export const publicErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) { next(error); return; }
  const status = error?.status === 413 ? 413 : error?.status === 400 ? 400 : 500;
  res.status(status).json({ error: status === 413 ? 'Request body is too large.' : status === 400 ? 'The request could not be read.' : 'The request could not be completed.' });
};
