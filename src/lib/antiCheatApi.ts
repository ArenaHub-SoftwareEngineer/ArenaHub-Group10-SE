import { auth } from './firebase';
import { apiUrl } from './apiBase';

/** `guest`: a staff test check-in without sign-in. A signed-in player still sends their token; the server decides. */
export async function antiCheatCall<T>(path: string, init: { method?: string; body?: unknown; guest?: boolean } = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user && !init.guest) throw new Error('Sign in to use ArenaHub anti-cheat.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  let response: Response;
  try { response = await fetch(apiUrl(`/api/integrity${path}`), { method: init.method || (init.body ? 'POST' : 'GET'), headers, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error('The anti-cheat service could not be reached. Check the connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The anti-cheat service could not complete this request.');
  return data as T;
}
