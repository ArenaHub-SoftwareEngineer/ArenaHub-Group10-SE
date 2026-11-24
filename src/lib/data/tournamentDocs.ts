/**
 * Converts between the in-app BracketDraft model and the Firestore documents that store it.
 *
 * Layout (one published bracket per game, keyed by publicationGameKey):
 *   tournaments/{id}                  public bracket: metadata + match graph, teams without players
 *   tournaments/{id}/public/rosters   public rosters: IGN, role and rank only
 *   tournaments/{id}/private/roster   staff-only registry: full name, student ID, school email, section
 *   publications/{gameKey}            which tournament is current for a game, plus a restorable previous copy
 *
 * Firestore bills per document read, so a viewer pays one read when one tournament changes,
 * and downloads only that tournament instead of every published bracket.
 * Pure functions only: no Firebase imports, so everything here is unit-tested.
 */
import type { BracketDraft, Match, Player, Team } from '../types';
import { publicationGameKey } from '../bracketPublication';
import { safePlayerImage } from '../playerProfiles';
import type { PlacementEvent } from '../formats/placement';
import { teamBadgeColor, teamBadgeImage, type BracketAppearance } from '../bracketAppearance';

export type TournamentStatus = 'published' | 'archived' | 'unpublished';
export const MAX_DOC_BYTES = 900_000;

export interface PublicTeamRef {
  id: string; name: string; collegeId: string; collegeCode: string; gameId: string;
  gameMode?: 'br' | 'mp'; seed: number; isBye?: boolean;
}
export type PublicMatch = Omit<Match, 'team1' | 'team2'> & { team1?: PublicTeamRef; team2?: PublicTeamRef };

export interface TournamentDoc {
  appearance?: BracketAppearance;
  id: string; title: string; gameId: string; gameName: string; gameKey: string;
  format: string; matchFormat: string; teamsCount: number; seedingRule: string; createdAt: string;
  status: TournamentStatus; revision: number; featured: boolean; demo?: boolean;
  matches: PublicMatch[];
  /** Battle Royale placement scoring: squad names and college codes only, no players. */
  placement?: PlacementEvent;
}

export interface PublicPlayer {
  id: string; ign: string; role: string; isVerified: boolean;
  rank?: string; peakRank?: Player['peakRank']; avatarUrl?: string; signatureHero?: string;
  stats?: Player['stats'];
}
export interface PublicRosterTeam { id: string; name: string; collegeId: string; collegeCode: string; gameId: string; gameMode?: 'br' | 'mp'; players: PublicPlayer[] }
export interface RosterDoc { teams: PublicRosterTeam[] }

/** Private roster entry. Lives only in the staff-only document. */
export interface PrivateRosterPlayer {
  fullName: string; studentId: string; schoolEmail: string; section: string;
  ign: string; role: string; substitute: boolean; gameAccountId?: string;
}
export interface PrivateRosterDoc { teams: Record<string, { teamName: string; collegeCode: string; players: PrivateRosterPlayer[] }> }

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function teamRef(team?: Team): PublicTeamRef | undefined {
  if (!team) return undefined;
  return clean({
    id: team.id, name: team.name, collegeId: team.collegeId || '', collegeCode: team.collegeCode || '',
    gameId: team.gameId || '', gameMode: team.gameMode, seed: Number.isFinite(team.seed) ? team.seed : 0,
    ...(team.isBye ? { isBye: true } : {}),
  });
}

/** Public player fields. Real names, student IDs, emails, sections and game-account IDs never leave the private roster. */
export function publicPlayer(player: Player): PublicPlayer {
  return clean({
    id: player.id, ign: player.ign || 'Player', role: player.role || 'Player', isVerified: player.isVerified === true,
    rank: player.rank, avatarUrl: safePlayerImage(player.avatarUrl), signatureHero: player.signatureHero,
    peakRank: player.peakRank ? { tier: player.peakRank.tier, division: player.peakRank.division, value: player.peakRank.value, unit: player.peakRank.unit } : undefined,
    stats: player.stats ? { kda: player.stats.kda, winRate: player.stats.winRate, matchesPlayed: player.stats.matchesPlayed, record: player.stats.record } : undefined,
  });
}

function publicMatch(match: Match): PublicMatch {
  const { team1, team2, mvp, ...rest } = match;
  // An MVP is credited publicly by IGN only.
  const publicMvp = mvp && typeof mvp === 'object' ? { ...mvp, playerName: mvp.ign || '' } : mvp;
  return clean({ ...rest, ...(publicMvp ? { mvp: publicMvp } : {}), team1: teamRef(team1), team2: teamRef(team2) });
}

/** Every distinct non-bye team in the bracket, with the most complete roster seen. */
export function bracketTeams(bracket: BracketDraft): Team[] {
  const teams = new Map<string, Team>();
  for (const team of bracket.rosterTeams || []) if (!team.isBye) teams.set(team.id, team);
  for (const match of bracket.matches) for (const team of [match.team1, match.team2]) {
    if (!team || team.isBye) continue;
    const prior = teams.get(team.id);
    if (!prior || (!prior.players?.length && team.players?.length)) teams.set(team.id, team);
  }
  return [...teams.values()];
}

export function toTournamentDoc(bracket: BracketDraft, revision: number, options: { status?: TournamentStatus; featured?: boolean } = {}): TournamentDoc {
  const appearance = publicBracketAppearance(bracket.appearance, bracket.matches);
  return clean({
    id: bracket.id, title: bracket.title, gameId: bracket.gameId || '', gameName: bracket.gameName,
    gameKey: publicationGameKey(bracket), format: bracket.format, matchFormat: bracket.matchFormat,
    teamsCount: bracket.teamsCount, seedingRule: bracket.seedingRule || '', createdAt: bracket.createdAt || '',
    status: options.status ?? 'published', revision, featured: options.featured === true,
    ...(bracket.demo ? { demo: true } : {}),
    ...(appearance && { appearance }),
    matches: bracket.matches.map(publicMatch),
    ...(bracket.placement ? { placement: publicPlacement(bracket.placement) } : {}),
  });
}

function publicBracketAppearance(appearance: BracketAppearance | undefined, matches: Array<Pick<PublicMatch, 'team1' | 'team2'>>): BracketAppearance | undefined {
  if (!appearance) return undefined;
  const ids = new Set(matches.flatMap(match => [match.team1, match.team2]).filter(team => team && !team.isBye).map(team => team!.id));
  const teams = Object.fromEntries(Object.entries(appearance.teams ?? {}).flatMap(([id, badge]) => {
    if (!ids.has(id) || !badge) return [];
    const color = teamBadgeColor(badge.color), image = teamBadgeImage(badge.image);
    const motif = typeof badge.motif === 'string' ? badge.motif.trim().slice(0, 80) : '';
    return color || image || motif ? [[id, { ...(color && { color }), ...(image && { image }), ...(motif && { motif }) }]] : [];
  }));
  const result: BracketAppearance = {
    ...(appearance.theme === 'navy-gold' && { theme: appearance.theme }),
    ...(appearance.wideImage === true && { wideImage: true }),
    ...(appearance.exportFooter === true && { exportFooter: true }),
    ...(Object.keys(teams).length && { teams }),
  };
  return Object.keys(result).length ? result : undefined;
}

/** Only the scoring fields leave the client; anything else on the object is dropped. */
function publicPlacement(event: PlacementEvent): PlacementEvent {
  return {
    config: { pointsTable: event.config.pointsTable.map(Number), killPoints: Number(event.config.killPoints) },
    teams: event.teams.map(t => ({ id: t.id, name: t.name, collegeCode: t.collegeCode || '' })),
    games: event.games.map(g => ({
      id: g.id, label: g.label, status: g.status,
      ...(g.scheduledDate ? { scheduledDate: g.scheduledDate } : {}), ...(g.scheduledTime ? { scheduledTime: g.scheduledTime } : {}),
      results: g.results.map(r => ({ teamId: r.teamId, placement: r.placement, kills: r.kills })),
    })),
  };
}

/** What counts as a content change when deciding whether a tournament needs saving. */
export function contentFingerprint(doc: Pick<TournamentDoc, 'matches' | 'placement' | 'appearance'>): string {
  return fingerprint(doc.placement || doc.appearance ? { matches: doc.matches, placement: doc.placement, appearance: doc.appearance } : doc.matches);
}

export function toRosterDoc(bracket: BracketDraft): RosterDoc {
  return clean({
    teams: bracketTeams(bracket).map(team => ({
      id: team.id, name: team.name, collegeId: team.collegeId || '', collegeCode: team.collegeCode || '',
      gameId: team.gameId || '', gameMode: team.gameMode, players: (team.players || []).map(publicPlayer),
    })),
  });
}

function hydrateTeam(ref: PublicTeamRef | undefined, rosters: Map<string, PublicRosterTeam>): Team | undefined {
  if (!ref) return undefined;
  const roster = rosters.get(ref.id);
  return {
    ...ref, winRate: 0, record: '',
    players: (roster?.players || []).map(p => ({ ...p, name: p.ign, collegeId: ref.collegeId })),
  };
}

/** Older seeded records used a prefix in their display names. Keep their test-data flag for scoring. */
export function normalizeSeededTournament(tournament: TournamentDoc): TournamentDoc {
  if (!tournament.demo) return tournament;
  const displayName = (name: string) => name.replace(/^DEMO\s+/i, '');
  const renameTeam = <T extends { name: string },>(team: T): T => ({ ...team, name: displayName(team.name) });
  const placement = tournament.placement;
  return {
    ...tournament,
    title: displayName(tournament.title),
    matches: (tournament.matches || []).map(match => ({
      ...match,
      ...(match.team1 && { team1: renameTeam(match.team1) }),
      ...(match.team2 && { team2: renameTeam(match.team2) }),
      ...(match.lobby?.teams && { lobby: { ...match.lobby, teams: match.lobby.teams.map(renameTeam) } }),
      ...(match.streamTitle && { streamTitle: displayName(match.streamTitle).replace(/(\s+vs\s+)DEMO\s+/gi, '$1') }),
    })),
    ...(placement && { placement: { ...placement, teams: placement.teams.map(renameTeam) } }),
  };
}

/** Rebuilds the in-app bracket from its public documents. */
export function fromDocs(stored: TournamentDoc, roster?: RosterDoc | null): BracketDraft {
  const tournament = normalizeSeededTournament(stored);
  const appearance = publicBracketAppearance(tournament.appearance, tournament.matches || []);
  const rosters = new Map((roster?.teams || []).map(team => [team.id, team]));
  const matches: Match[] = (tournament.matches || []).map(match => ({
    ...match, team1: hydrateTeam(match.team1, rosters), team2: hydrateTeam(match.team2, rosters),
  }) as Match);
  const teams = [...new Map(matches.flatMap(m => [m.team1, m.team2]).filter((t): t is Team => !!t && !t.isBye).map(t => [t.id, t])).values()];
  return {
    id: tournament.id, title: tournament.title, gameId: tournament.gameId || undefined, gameName: tournament.gameName,
    format: tournament.format, teamsCount: tournament.teamsCount, matchFormat: tournament.matchFormat,
    seedingRule: tournament.seedingRule, matches,
    teams: teams.map(t => ({ id: t.id, name: t.name, college: t.collegeCode, seed: t.seed })),
    parsedParams: { game: tournament.gameName, format: tournament.format, seeding: tournament.seedingRule, constraint: 'None', teamsCount: tournament.teamsCount, matchFormat: (tournament.matchFormat as any) || 'Bo3' },
    rawPrompt: '', createdAt: tournament.createdAt, status: 'published',
    ...(tournament.demo ? { demo: true } : {}),
    ...(appearance && { appearance }),
    ...(tournament.placement ? { placement: tournament.placement, rosterTeams: tournament.placement.teams.map((t, i) => hydrateTeam({ id: t.id, name: t.name, collegeId: '', collegeCode: t.collegeCode, gameId: 'game-codm-br', gameMode: 'br', seed: i + 1 }, rosters)!), teams: tournament.placement.teams.map((t, i) => ({ id: t.id, name: t.name, college: t.collegeCode, seed: i + 1 })) } : {}),
  };
}

/** Stable JSON with sorted keys, used to detect which tournaments actually changed. */
export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item) ?? '';
}

export function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function assertDocSize(value: unknown, label: string) {
  if (byteSize(value) > MAX_DOC_BYTES) throw new Error(`${label} is too large to save. Split the event into smaller brackets.`);
}

/** Match changes that deserve a public announcement. */
export function announcementChanges(before: PublicMatch[], after: PublicMatch[]) {
  const prior = new Map(before.map(match => [match.id, match]));
  return after.flatMap(match => {
    const old = prior.get(match.id);
    // Byes advance automatically; nobody played, so there is no schedule, result or live start to announce.
    const automatic = match.scheduledTime === 'Automatic Advance' || match.inactive === true || match.team1?.isBye === true || match.team2?.isBye === true;
    if (!old || automatic) return [];
    const scheduleChanged = old.scheduledDate !== match.scheduledDate || old.scheduledTime !== match.scheduledTime || (old.scheduledEndTime || '') !== (match.scheduledEndTime || '');
    const resultChanged = match.status === 'completed' && (old.status !== match.status || fingerprint(old.score) !== fingerprint(match.score));
    const started = match.status === 'live' && old.status !== 'live';
    if (!scheduleChanged && !resultChanged && !started) return [];
    return [{ match, kind: scheduleChanged ? 'schedule' as const : resultChanged ? 'result' as const : 'live' as const }];
  });
}

export function placementAnnouncementChanges(before?: PlacementEvent, after?: PlacementEvent) {
  const prior = new Map(before?.games.map(game => [game.id, game]));
  return (after?.games || []).flatMap(game => {
    const old = prior.get(game.id);
    if (!old) return [];
    const scheduleChanged = old.scheduledDate !== game.scheduledDate || old.scheduledTime !== game.scheduledTime;
    const results = (rows: typeof game.results) => fingerprint([...rows].sort((a, b) => a.teamId.localeCompare(b.teamId)));
    const resultChanged = game.status === 'completed' && (old.status !== game.status || results(old.results) !== results(game.results));
    const started = game.status === 'live' && old.status !== 'live';
    return [
      ...(scheduleChanged ? [{ game, kind: 'schedule' as const }] : []),
      ...(resultChanged ? [{ game, kind: 'result' as const }] : []),
      ...(started ? [{ game, kind: 'live' as const }] : []),
    ];
  });
}
