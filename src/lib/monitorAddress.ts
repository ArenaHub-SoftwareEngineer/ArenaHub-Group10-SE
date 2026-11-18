/** A pairing destination is an origin, never credentials, a path or injected GSI configuration. */
export function monitorAddress(value: string): string {
  if (value.length > 512 || /[\s\\"'<>]/.test(value)) throw new Error('Use the exact server origin from the referee screen.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the server origin without credentials, paths or query parameters.');
  // WHATWG URL parsing can accept shell metacharacters in a host. This origin is also copied into
  // a Windows command, so constrain its normalized host to DNS/IP characters before using it.
  if (url.hostname.length > 253 || !(/^[a-z0-9.-]+$/i.test(url.hostname) || /^\[[a-f0-9:.]+\]$/i.test(url.hostname))) throw new Error('Use a valid DNS name or IP address for the server.');
  return url.origin;
}
