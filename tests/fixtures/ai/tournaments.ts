// Fixture database for the Arena AI eval. Built the way the server sees it: in-app brackets that carry
// private roster fields are converted with the real public-document functions (toTournamentDoc,
// toRosterDoc) and read back with fromDocs. PRIVATE_VALUES must never appear in any reply or tool output.
import type { BracketDraft, Match, Player, Team } from '../../../src/lib/types.ts';
import { fromDocs, toRosterDoc, toTournamentDoc } from '../../../src/lib/data/tournamentDocs.ts';
import type { PublishedData } from '../../../server/data.ts';

export const PRIVATE_VALUES = ['Juan Dela Cruz', '2023-01234', 'Maria Santos', '2023-05678', 'Pedro Reyes', '2023-09999', 'BSCS-3A'];

const player = (ign: string, role: string, name = '', studentId = ''): Player => ({ id: `p-${ign}`, ign, role, name: name || `${ign} Private`, studentId: studentId || undefined, collegeId: 'c', isVerified: true, department: 'BSCS-3A' });
const team = (id: string, name: string, collegeCode: string, gameId: string, players: Player[] = []): Team => ({ id, name, collegeCode, collegeId: `col-${collegeCode}`, gameId, seed: 1, winRate: 0, record: '', players });

const wolves = team('t-wolves', 'Crimson Wolves', 'CCS', 'game-mlbb', [player('Kaizen', 'Jungler', 'Juan Dela Cruz', '2023-01234'), player('Ember', 'Mid lane')]);
const hawks = team('t-hawks', 'Azure Hawks', 'COE', 'game-mlbb', [player('SkyHigh', 'Gold lane', 'Maria Santos', '2023-05678')]);
const lions = team('t-lions', 'Golden Lions', 'CLA', 'game-mlbb', [player('Roar', 'Roamer')]);
const foxes = team('t-foxes', 'Silver Foxes', 'CN', 'game-mlbb', [player('Vixen', 'EXP lane', 'Pedro Reyes', '2023-09999')]);
const owls = team('t-owls', 'Iron Owls', 'CCS', 'game-dota2', [player('Nightwing', 'Carry')]);
const bears = team('t-bears', 'Storm Bears', 'COE', 'game-dota2', [player('Thunder', 'Support')]);

const match = (m: Partial<Match> & Pick<Match, 'id' | 'matchNumber' | 'tournamentId' | 'gameId' | 'roundName' | 'status'>): Match => ({
  round: 1, bracketType: 'upper', matchFormat: 'Bo3', score: { team1Score: 0, team2Score: 0 }, scheduledDate: '', scheduledTime: '', organizerName: '', ...m,
});
const bracket = (b: Pick<BracketDraft, 'id' | 'title' | 'gameId' | 'gameName' | 'format' | 'matchFormat' | 'matches'> & Partial<BracketDraft>): BracketDraft => ({
  teamsCount: 4, seedingRule: 'Win rate', teams: [], parsedParams: { game: b.gameName, format: b.format, seeding: 'Win rate', constraint: 'None', teamsCount: 4, matchFormat: 'Bo3' }, rawPrompt: '', createdAt: '', status: 'published', ...b,
});

export const mlbb = bracket({
  id: 'mlbb-cup', title: 'Campus Cup MLBB', gameId: 'game-mlbb', gameName: 'Mobile Legends: Bang Bang', format: 'Single elimination', matchFormat: 'Bo3',
  matches: [
    match({ id: 'mlbb-m1', matchNumber: 'M1', tournamentId: 'mlbb-cup', gameId: 'game-mlbb', roundName: 'Semifinal', status: 'completed', team1: wolves, team2: hawks, score: { team1Score: 2, team2Score: 1 }, winnerId: 't-wolves', nextMatchId: 'mlbb-m3',
      timelineEvents: [{ time: '12:30', type: 'lord', team: 'CCS', text: 'Crimson Wolves secure the Lord' }], mvp: { playerName: 'Juan Dela Cruz', ign: 'Kaizen', role: 'Jungler', teamCode: 'CCS' } }),
    match({ id: 'mlbb-m2', matchNumber: 'M2', tournamentId: 'mlbb-cup', gameId: 'game-mlbb', roundName: 'Semifinal', status: 'live', team1: lions, team2: foxes, score: { team1Score: 1, team2Score: 0 }, nextMatchId: 'mlbb-m3', streamTitle: 'Semifinal stream' }),
    match({ id: 'mlbb-m3', matchNumber: 'M3', tournamentId: 'mlbb-cup', gameId: 'game-mlbb', round: 2, roundName: 'Final', bracketType: 'final', status: 'upcoming', matchFormat: 'Bo5', team1: wolves, scheduledDate: '2026-11-20', scheduledTime: '3:00 PM' }),
  ],
});

export const dota = bracket({
  id: 'dota-show', title: 'Dota 2 Showdown', gameId: 'game-dota2', gameName: 'Dota 2', format: 'Single elimination', matchFormat: 'Bo3', teamsCount: 2,
  matches: [match({ id: 'dota-m1', matchNumber: 'M1', tournamentId: 'dota-show', gameId: 'game-dota2', roundName: 'Grand Final', bracketType: 'final', status: 'completed', team1: owls, team2: bears, score: { team1Score: 2, team2Score: 0 }, winnerId: 't-owls' })],
});

export const br = bracket({
  id: 'br-clash', title: 'CODM BR Clash', gameId: 'game-codm-br', gameName: 'Call of Duty: Mobile Battle Royale', format: 'Battle Royale points', matchFormat: 'Bo1', teamsCount: 3, matches: [],
  placement: {
    config: { pointsTable: [10, 6, 5, 4, 3, 2, 1, 1], killPoints: 1 },
    teams: [{ id: 'sq-ravens', name: 'Night Ravens', collegeCode: 'CCS' }, { id: 'sq-blaze', name: 'Blaze Squad', collegeCode: 'COE' }, { id: 'sq-echo', name: 'Echo Unit', collegeCode: 'CLA' }],
    games: [
      { id: 'br-G1', label: 'Game 1', status: 'completed', results: [{ teamId: 'sq-ravens', placement: 1, kills: 8 }, { teamId: 'sq-blaze', placement: 2, kills: 5 }, { teamId: 'sq-echo', placement: 3, kills: 2 }] },
      { id: 'br-G2', label: 'Game 2', status: 'completed', results: [{ teamId: 'sq-blaze', placement: 1, kills: 6 }, { teamId: 'sq-ravens', placement: 2, kills: 4 }, { teamId: 'sq-echo', placement: 3, kills: 3 }] },
      { id: 'br-G3', label: 'Game 3', status: 'upcoming', scheduledDate: '2026-11-21', scheduledTime: '10:00 AM', results: [] },
    ],
  },
});

/** What server/data.ts would return for these three published tournaments. */
export function publishedFixture(revision = 'r1'): PublishedData {
  return {
    brackets: [mlbb, dota, br].map(b => fromDocs(toTournamentDoc(b, 1), toRosterDoc(b))),
    revision,
    checkedAt: '2026-11-15T04:00:00.000Z',
  };
}

export const TEAM_NAMES = ['Crimson Wolves', 'Azure Hawks', 'Golden Lions', 'Silver Foxes', 'Iron Owls', 'Storm Bears', 'Night Ravens', 'Blaze Squad', 'Echo Unit'];
