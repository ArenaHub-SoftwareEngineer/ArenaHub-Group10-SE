// Records answer for player-leaderboard questions ("most kills in MLBB", "top players by KDA"), used when no
// model answers. It reads the same leaderboard as the page and the getPlayerLeaderboard tool, so all three agree.
import type { BracketDraft } from '../../src/lib/types.ts';
import { ordinal, type KnowledgeReference } from '../../src/lib/tournamentKnowledge.ts';
import { buildPlayerLeaderboards, formatKda, KDA_MIN_GAMES, LEADERBOARD_SORTS, rankLeaderboard, type LeaderboardRow, type LeaderboardSort } from '../../src/lib/playerLeaderboard.ts';

/** Organizer-entered names as plain words: characters the chat would read as formatting are dropped. */
const plain = (value: string) => value.replace(/[\\`*#]/g, '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function leaderboardSort(query: string): LeaderboardSort {
  const q = query.toLowerCase();
  if (/\bmvps?\b/.test(q)) return 'mvps';
  if (/\b(kills?|frags?|eliminations?|elims?)\b/.test(q)) return 'kills';
  if (/\bassists?\b/.test(q)) return 'assists';
  if (/\b(wins?|won|panalo)\b/.test(q)) return 'wins';
  return 'kda';
}

function leaderboardGame(query: string): string | undefined {
  if (/\bmlbb\b|mobile legends/i.test(query)) return 'game-mlbb';
  if (/\bdota\s*2?\b/i.test(query)) return 'game-dota2';
  if (/\bcodm\b|call of duty/i.test(query)) return /battle royale|\bbr\b/i.test(query) ? 'game-codm-br' : 'game-codm-mp';
}

const statFor = (sort: LeaderboardSort, r: LeaderboardRow) => sort === 'kills' ? `${r.kills} kills` : sort === 'assists' ? `${r.assists} assists`
  : sort === 'mvps' ? `${r.mvps} MVP award${r.mvps === 1 ? '' : 's'}` : sort === 'wins' ? `${r.wins}-${r.losses} in series` : `KDA ${formatKda(r)}`;

export function leaderboardAnswer(brackets: BracketDraft[], archived: BracketDraft[], query: string): { text: string; references: KnowledgeReference[] } {
  const sort = leaderboardSort(query), game = leaderboardGame(query);
  const boards = buildPlayerLeaderboards([...brackets.map(bracket => ({ bracket, current: true })), ...archived.map(bracket => ({ bracket, current: false }))])
    .filter(board => !game || board.gameKey === game);
  const references = boards.flatMap(board => board.tournaments.filter(t => t.current && t.countedMatches).map(t => ({ label: t.title, bracketId: t.id }))).slice(0, 12);
  const label = LEADERBOARD_SORTS.find(s => s.id === sort)!.label;
  const blocks = boards.map(board => {
    if (!board.tracksPlayers) return `${plain(board.label)}: Battle Royale records squads, not individual players. See Standings for squad points.`;
    const rows = rankLeaderboard(board.rows, sort).filter(r => r.rank !== null).slice(0, 5);
    if (!rows.length) return `${plain(board.label)}: ${board.rows.length ? `no player has ${KDA_MIN_GAMES} games with stats yet, so there is no KDA ranking.` : 'no player stats are recorded yet.'}`;
    // The direct answer first, then the top five.
    return `Top of ${plain(board.label)} by ${label.toLowerCase()}: ${plain(rows[0].ign)} (${plain(rows[0].teamName)}), with ${statFor(sort, rows[0])}.\n\n${rows.map(r => `- ${ordinal(r.rank!)} ${plain(r.ign)} (${plain(r.teamName)}${r.collegeCode ? `, ${plain(r.collegeCode)}` : ''}): ${sort === 'kills' || sort === 'assists' ? '' : `${statFor(sort, r)}; `}${r.kills} kills, ${r.deaths} deaths, ${r.assists} assists over ${r.games} game${r.games === 1 ? '' : 's'}`).join('\n')}`;
  });
  const text = blocks.length
    ? `${blocks.join('\n\n')}\n\nThese count finished series only, with every game added up.`
    : 'No player stats are recorded yet. Players appear after a finished match has stats or an MVP.';
  return { text, references };
}
