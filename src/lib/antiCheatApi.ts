import { auth } from './firebase';
import { apiUrl } from './apiBase';
import { FAIR_PLAY_GAMES, belongsToFairPlayGame } from './fairPlayGames';
import type { Match } from './types';

export async function antiCheatCall<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in as tournament staff to manage anti-cheat scans.');
  let response: Response;
  try { response = await fetch(apiUrl(`/api/integrity${path}`), { method: init.method || (init.body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error('The anti-cheat service could not be reached. Reconnect before starting the match.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The anti-cheat service could not complete this request.');
  return data as T;
}
export const requiresPlayerScan = (match: Pick<Match, 'gameId' | 'gameMode'>) => FAIR_PLAY_GAMES.some(game => belongsToFairPlayGame(match, game));
export async function requireMatchScan(match: Match) {
  if (!requiresPlayerScan(match)) return;
  const result = await antiCheatCall<{ admitted: boolean; validUntil: number }>(`/matches/${encodeURIComponent(match.id)}/admit`, { body: {} });
  if (!result.admitted || result.validUntil <= Date.now()) throw new Error('Player scans expired. Keep each companion running and try again.');
}
