import type { BracketDraft, Match } from './types';
import { publicationGameKey } from './bracketPublication';
import { belongsToFairPlayGame, FAIR_PLAY_GAMES } from './fairPlayGames';
import { scheduleDate, timeOrder } from './calendar';
import { isWatchableLiveMatch } from './streamUtils';
import { GAME_ARTWORK } from '../components/common/GameArtworkTiles';

/** One match as a "video" in Match center and in the watch page's Up next list. */
export type WatchCard = {
  match: Match; bracket: BracketDraft; gameId: string; gameLabel: string; image?: string; mode?: string;
  state: 'live' | 'waiting' | 'upcoming' | 'other';
};
export type WatchGame = { id: string; label: string; image?: string; cards: WatchCard[] };

const isBye = (match: Match) => [match.team1, match.team2].some(team => team?.isBye || team?.name === 'BYE');
const stateOf = (match: Match): WatchCard['state'] => isWatchableLiveMatch(match) ? 'live'
  : match.status === 'live' ? 'waiting'
  : (match.status === 'upcoming' || match.status === 'pre-match') && match.team1 && match.team2 ? 'upcoming' : 'other';

/** Groups every published match under its game (CODM modes share one CODM game), in the fixed game order. */
export function watchGames(brackets: BracketDraft[]): WatchGame[] {
  const games = new Map<string, WatchGame>(GAME_ARTWORK.map(game => [game.id, { id: game.id, label: game.name, image: game.image, cards: [] }]));
  for (const bracket of brackets) {
    const key = publicationGameKey(bracket);
    const publishedGame = FAIR_PLAY_GAMES.find(game => `game-${game.id}` === key);
    for (const match of bracket.matches) {
      if (isBye(match)) continue;
      const candidates = bracket.gameId === 'game-custom' ? [] : FAIR_PLAY_GAMES.filter(game => belongsToFairPlayGame(match, game));
      const game = publishedGame ?? (candidates.length === 1 ? candidates[0] : undefined);
      const codm = game?.id.startsWith('codm') || candidates.some(candidate => candidate.id.startsWith('codm'));
      const id = game?.id ?? (codm ? 'codm' : key);
      const group = games.get(id) ?? { id, label: bracket.gameName, cards: [] };
      group.cards.push({ match, bracket, gameId: id, gameLabel: group.label, image: group.image, mode: codm ? game?.mode : undefined, state: stateOf(match) });
      games.set(id, group);
    }
  }
  return [...games.values()];
}

export const upcomingOrder = (a: WatchCard, b: WatchCard) =>
  (scheduleDate(a.match.scheduledDate || '') ?? '9999').localeCompare(scheduleDate(b.match.scheduledDate || '') ?? '9999')
  || timeOrder(a.match.scheduledTime || '') - timeOrder(b.match.scheduledTime || '');

/** What to watch next: other live broadcasts first, then matches waiting for a broadcast, then the next scheduled. */
export function upNext(brackets: BracketDraft[], currentId: string, limit = 12): WatchCard[] {
  const cards = watchGames(brackets).flatMap(game => game.cards).filter(card => card.match.id !== currentId);
  const live = cards.filter(c => c.state === 'live'), waiting = cards.filter(c => c.state === 'waiting');
  const upcoming = cards.filter(c => c.state === 'upcoming').sort(upcomingOrder);
  return [...live, ...waiting, ...upcoming].slice(0, limit);
}
