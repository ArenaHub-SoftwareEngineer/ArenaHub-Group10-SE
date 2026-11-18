import { seriesWinsNeeded, type Match, type MatchFormat, type Team } from './types';
type Source = NonNullable<Match['sources']>[number];
const source = (match: Match, result: 'winner' | 'loser' = 'winner'): Source => ({ matchId: match.id, result });
export function canEditRoundFormat(matches: Match[]): boolean {
  return matches.every(match => match.team1?.isBye || match.team2?.isBye
    || (['upcoming', 'pre-match'].includes(match.status) && !match.winnerId && match.score.team1Score === 0 && match.score.team2Score === 0));
}

/** Keep automatic advances valid when the organizer changes an unstarted round's series length. */
export function changeRoundFormat(matches: Match[], round: number, format: MatchFormat): Match[] {
  if (!canEditRoundFormat(matches.filter(match => match.round === round))) return matches;
  return matches.map(match => match.round !== round ? match : {
    ...match, matchFormat: format,
    ...((match.team1?.isBye || match.team2?.isBye) ? { score: {
      team1Score: match.team1?.isBye ? 0 : seriesWinsNeeded(format),
      team2Score: match.team2?.isBye ? 0 : seriesWinsNeeded(format),
    } } : {}),
  });
}
function bye(id: string): Team { return { id: `bye-${id}`, name: 'BYE', isBye: true, collegeId: 'bye', collegeCode: 'BYE', gameId: 'game-draft', seed: 0, winRate: 0, record: '0W-0L', players: [] }; }

/** Rebuild both winner and loser paths in topological order after every correction. */
export function resolveTournamentGraph(matches: Match[], replacement?: Match): Match[] {
  const output: Match[] = [], resolved = new Map<string, Match>();
  for (const original of matches) {
    let match = replacement?.id === original.id ? { ...replacement } : { ...original };
    if (match.sources) {
      const participants = match.sources.map((input, slot) => {
        if (!input) return slot === 0 ? match.team1 : match.team2;
        const feeder = resolved.get(input.matchId);
        if (!feeder || feeder.status !== 'completed') return undefined;
        if (feeder.team1?.isBye && feeder.team2?.isBye) return bye(`${match.id}-${slot}`);
        if (!feeder.winnerId) return undefined;
        const winner = feeder.winnerId === feeder.team1?.id ? feeder.team1 : feeder.team2;
        const loser = feeder.winnerId === feeder.team1?.id ? feeder.team2 : feeder.team1;
        return input.result === 'winner' ? winner : loser || bye(`${match.id}-${slot}`);
      });
      const final = match.conditionalReset ? resolved.get(match.sources[0]?.matchId || '') : undefined;
      const inactive = !!match.conditionalReset && (!final || final.status !== 'completed' || final.winnerId !== final.team2?.id);
      if (participants[0]?.id !== match.team1?.id || participants[1]?.id !== match.team2?.id || inactive !== !!match.inactive) {
        match = { ...match, team1: participants[0], team2: participants[1], score: { team1Score: 0, team2Score: 0 }, status: 'upcoming', winnerId: undefined, playerStats: undefined, statGames: undefined, mvp: undefined, timelineEvents: undefined };
      }
      match.inactive = inactive;
      if (inactive) { match.team1 = undefined; match.team2 = undefined; }
    }
    if (!match.inactive && match.team1 && match.team2 && (match.team1.isBye || match.team2.isBye)) {
      const winner = match.team1.isBye ? match.team2 : match.team1;
      match = { ...match, status: 'completed', winnerId: winner.isBye ? undefined : winner.id, score: { team1Score: match.team1.isBye ? 0 : seriesWinsNeeded(match.matchFormat), team2Score: match.team2.isBye ? 0 : seriesWinsNeeded(match.matchFormat) }, scheduledTime: 'Automatic Advance' };
    }
    output.push(match); resolved.set(match.id, match);
  }
  return output;
}
export function doubleElimination(upper: Match[], finalFormat: MatchFormat): Match[] {
  const rounds = Math.max(...upper.map(m => m.round));
  const winners = upper.map(m => ({ ...m, bracketType: 'upper' as const, roundName: m.round === rounds ? 'Upper final' : `Upper round ${m.round}`, matchFormat: m.round === rounds ? upper[0].matchFormat : m.matchFormat }));
  for (const match of winners.filter(m => m.round > 1)) {
    const feeders = winners.filter(m => m.nextMatchId === match.id);
    match.sources = feeders.map(m => source(m));
  }
  const lower: Match[] = [];
  let previous: Match[] = [], lowerRound = 0;
  const base = winners[0], upperFinal = winners.at(-1)!;
  const make = (inputs: Source[], label: string, bracketType: Match['bracketType'] = 'lower', format: MatchFormat = base.matchFormat): Match => ({
    id: `${base.tournamentId}-${bracketType === 'lower' ? 'L' : 'F'}${lower.length + (bracketType === 'final' ? 1 : 0) + 1}-${label.replaceAll(' ', '-')}`,
    matchNumber: `#${bracketType === 'lower' ? 'L' : 'F'}${lower.length + 1}`, tournamentId: base.tournamentId, gameId: base.gameId,
    round: rounds + lowerRound, roundName: label, bracketType, matchFormat: format, score: { team1Score: 0, team2Score: 0 }, status: 'upcoming', scheduledDate: 'Day 1', scheduledTime: label, organizerName: base.organizerName, sources: inputs,
  });
  if (rounds > 1) {
    lowerRound++;
    const first = winners.filter(m => m.round === 1);
    for (let i = 0; i < first.length; i += 2) { const match = make([source(first[i], 'loser'), source(first[i + 1], 'loser')], 'Lower round 1'); lower.push(match); previous.push(match); }
    for (let upperRound = 2; upperRound <= rounds; upperRound++) {
      lowerRound++; const incoming = winners.filter(m => m.round === upperRound), injected: Match[] = [];
      incoming.forEach((match, i) => { const next = make([source(previous[i]), source(incoming[incoming.length - 1 - i], 'loser')], `Lower round ${lowerRound}`); lower.push(next); injected.push(next); });
      previous = injected;
      if (upperRound < rounds) {
        lowerRound++; const consolidated: Match[] = [];
        for (let i = 0; i < previous.length; i += 2) { const match = make([source(previous[i]), source(previous[i + 1])], `Lower round ${lowerRound}`); lower.push(match); consolidated.push(match); }
        previous = consolidated;
      }
    }
  }
  lowerRound++;
  const grandFinal = make([source(upperFinal), source(previous[0] || upperFinal, previous[0] ? 'winner' : 'loser')], 'Grand final', 'final', finalFormat);
  lowerRound++;
  const reset = { ...make([source(grandFinal), source(grandFinal, 'loser')], 'Reset final if needed', 'final', finalFormat), conditionalReset: true, inactive: true };
  const all = [...winners, ...lower, grandFinal, reset];
  for (const match of all) match.nextMatchId = all.find(target => target.sources?.some(input => input?.matchId === match.id && input.result === 'winner'))?.id;
  return resolveTournamentGraph(all.map(match => ({ ...match, tournamentFormat: 'double-elimination' })));
}
export function roundRobin(teams: Team[], base: Match, format: MatchFormat): Match[] {
  if (teams.length > 32) throw new Error('Round robin supports up to 32 teams per bracket.');
  const rotation: Array<Team | null> = [...teams, ...(teams.length % 2 ? [null] : [])], matches: Match[] = [];
  for (let round = 1; round < rotation.length; round++) {
    for (let i = 0; i < rotation.length / 2; i++) {
      const a = rotation[i], b = rotation[rotation.length - 1 - i];
      if (!a || !b) continue;
      matches.push({ id: `${base.tournamentId}-RR${matches.length + 1}`, matchNumber: `#RR${matches.length + 1}`, tournamentId: base.tournamentId, gameId: base.gameId, round, roundName: `Round ${round}`, bracketType: 'upper', team1: round % 2 ? a : b, team2: round % 2 ? b : a, matchFormat: format, score: { team1Score: 0, team2Score: 0 }, status: 'upcoming', scheduledDate: 'Day 1', scheduledTime: `Round ${round}`, organizerName: base.organizerName });
    }
    rotation.splice(1, 0, rotation.pop()!);
  }
  return matches.map(match => ({ ...match, tournamentFormat: 'round-robin' }));
}
