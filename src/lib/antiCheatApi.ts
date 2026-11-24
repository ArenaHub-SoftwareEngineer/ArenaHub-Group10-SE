import { auth } from './firebase';
import { apiUrl } from './apiBase';

export async function antiCheatCall<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to use ArenaHub anti-cheat.');
  let response: Response;
  try { response = await fetch(apiUrl(`/api/integrity${path}`), { method: init.method || (init.body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error('The anti-cheat service could not be reached. Check the connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The anti-cheat service could not complete this request.');
  return data as T;
}
