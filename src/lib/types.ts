/**
 * ArenaHub Data Types & Contracts
 */

export type UserRole = 'user' | 'admin' | 'spectator' | 'player' | 'moderator' | 'organizer' | 'school-admin';

export type UserStatus = 'active' | 'suspended' | 'banned';

export interface User {
  spectatorInviteApproved?: boolean;
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  collegeId: string;
  collegeName: string;
  avatarInitials: string;
  joinedDate: string;
  suspendedUntil?: string;
}

export interface College {
  id: string;
  code: string;
  name: string;
  dean?: string;
  color: string;
  teamsCount: number;
  stats: {
    wins: number;
    losses: number;
    gameWins: number;
    gameLosses: number;
    status: 'Upper SF' | 'Lower R2' | 'Eliminated' | 'Active';
  };
}

export interface Player {
  id: string;
  name: string;
  ign: string;
  role: string;
  collegeId: string;
  studentId?: string;
  isVerified: boolean;
  avatarUrl?: string;
  /** Career high is stored separately from a current-season rank. */
  peakRank?: { tier: string; division?: string; value?: number; unit: 'stars' | 'RR' | 'LP' | 'MMR' | 'RP' | 'Rank XP' };
  yearLevel?: string;
  department?: string;
  program?: string;
  bio?: string;
  samplePortrait?: number;
  isSampleProfile?: boolean;
  rank?: string;
  signatureHero?: string;
  stats?: {
    kda: string;
    winRate: string;
    matchesPlayed: number;
    record?: string;
    totalKills?: number;
    totalDeaths?: number;
    totalAssists?: number;
    palaroAppearances?: number;
  };
}

export interface Team {
  gameMode?: 'br' | 'mp';
  id: string;
  name: string;
  collegeId: string;
  collegeCode: string;
  gameId: string;
  seed: number;
  winRate: number;
  record: string;
  players: Player[];
  isBye?: boolean;
}

export type TournamentFormat = 'single-elimination' | 'double-elimination' | 'round-robin';
export const MATCH_FORMATS = ['Bo1', 'Bo3', 'Bo5', 'Bo7'] as const;
export type MatchFormat = typeof MATCH_FORMATS[number];

export function seriesGameCount(format: MatchFormat): number {
  return Number(format.slice(2));
}

export function seriesWinsNeeded(format: MatchFormat): number {
  return Math.ceil(seriesGameCount(format) / 2);
}

export interface Tournament {
  id: string;
  title: string;
  subtitle: string;
  gameId: string;
  gameName: string;
  format: TournamentFormat;
  matchFormat: MatchFormat;
  status: 'live' | 'upcoming' | 'completed';
  startDate: string;
  endDate: string;
  collegesCount: number;
  bannerImage: string;
  isFeatured: boolean;
  currentStage: string;
}

export interface MatchScore {
  team1Score: number;
  team2Score: number;
  team1?: number;
  team2?: number;
  gameScores?: Array<{ team1: number; team2: number }>;
}

export interface MatchMVP {
  playerName: string;
  ign: string;
  role: string;
  teamCode: string;
  collegeName?: string;
  kda?: string;
  heroOrAgent?: string;
  statsHighlight?: string;
}

export interface PlayerMatchStats {
  playerId?: string;
  playerName?: string;
  ign?: string;
  role?: string;
  teamCode?: string;
  kills: number;
  deaths: number;
  assists: number;
  cs?: number;
  gold?: string;
  damage?: string;
}

export interface MatchTimelineEvent {
  time: string;
  text: string;
  team?: string;
  type?: 'first-blood' | 'tower' | 'lord' | 'objective' | 'ace' | string;
  title?: string;
}

export interface Match {
  gameMode?: 'br' | 'mp';
  id: string;
  matchNumber: string;
  tournamentId: string;
  gameId: string;
  round: number;
  roundName: string;
  bracketType: 'upper' | 'lower' | 'final';
  team1?: Team;
  team2?: Team;
  score: MatchScore;
  status: 'upcoming' | 'pre-match' | 'live' | 'completed' | 'alert';
  matchFormat: MatchFormat;
  scheduledTime: string;
  scheduledDate: string;
  organizerName: string;
  streamUrl?: string;
  /** Public watch links only. Encoder URLs and stream keys never belong here. */
  broadcastLinks?: Array<{platform:'youtube'|'facebook'|'tiktok';url:string}>;
  streamTitle?: string;
  liveTime?: string; // e.g. "G2 · 08:42"
  winnerId?: string;
  nextMatchId?: string;
  sources?: Array<{ matchId: string; result: 'winner' | 'loser' } | null>;
  conditionalReset?: boolean;
  inactive?: boolean;
  tournamentFormat?: TournamentFormat;
  timelineEvents?: MatchTimelineEvent[];
  mvp?: MatchMVP | string;
  statGames?: Record<string, { playerStats: NonNullable<Match['playerStats']>; notes: string }>;
  playerStats?: Record<string, { kills: number; deaths: number; assists: number; [key: string]: any }>;
}

export interface GameCategory {
  id: string;
  name: string;
}

export interface GameTitle {
  id: string;
  name: string;
  registeredTeams: number;
  visibility: 'Show everywhere' | 'Tournaments only' | 'Hidden';
  bannerImage: string;
  category: string;
}

export interface ChatMessage {
  id: string;
  matchId: string;
  userId: string;
  userName: string;
  userInitials: string;
  userRole: UserRole;
  text: string;
  timestamp: string;
  sentAt?: number;
  isMuted?: boolean;
  isFlagged?: boolean;
}

export interface ContentReport {
  shared?: boolean;
  sourceMessageId?: string;
  id: string;
  type: 'HARASSMENT' | 'SPAM / SCAM' | 'STOLEN CONTENT' | 'MISINFORMATION';
  contentType: 'Chat message' | 'Post' | 'Highlight' | 'Comment';
  contentSnippet: string;
  reportedBy: string;
  postedBy: string;
  timeAgo: string;
  flagCount: number;
  status: 'open' | 'resolved';
}

export interface AuditLogItem {
  id: string;
  actor: string;
  action: string;
  timestamp: string;
}

export interface AIParsedBracketParams {
  game: string;
  format: string;
  seeding: string;
  constraint: string;
  teamsCount: number;
  matchFormat: MatchFormat;
  finalMatchFormat?: MatchFormat;
}

export interface BracketDraft {
  gameId?: string;
  id: string;
  title: string;
  gameName: string;
  format: string;
  teamsCount: number;
  matchFormat: string;
  seedingRule: string;
  matches: Match[];
  teams: ExtractedTeam[];
  parsedParams: AIParsedBracketParams;
  rawPrompt: string;
  createdAt: string;
  status: 'draft' | 'published' | 'saved';
}

export interface ExtractedTeam {
  id?: string;
  name: string;
  college?: string;
  seed?: number;
}

export interface SchoolSettings {
  schoolName: string;
  schoolCode: string;
  domain: string;
  brandAccent: string;
  adminAccent: string;
  palaroYear: number;
}
