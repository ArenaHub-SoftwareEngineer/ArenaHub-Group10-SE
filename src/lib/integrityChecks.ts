import { Match, MatchFormat, Team, seriesWinsNeeded } from './types';
import type { EvidenceFile } from './evidenceStorage';
export const REPORT_REASONS = ['Suspected cheating', 'Unregistered player', 'Account sharing', 'Score dispute', 'Unsportsmanlike conduct'] as const;
export type IntegrityReason = typeof REPORT_REASONS[number];
export type CaseStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';
export interface IntegrityCase {
  id: string; reporterId: string; matchId: string; reason: IntegrityReason; details: string;
  evidenceUrl: string; status: CaseStatus; createdAt: unknown; updatedAt: unknown;
  reviewerId: string; resolution: string;
  evidenceFiles?: EvidenceFile[];
}
export function validateEvidenceUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash.length > 300 || value.length > 1500) throw new Error();
    const hosts = ['youtube.com', 'www.youtube.com', 'youtu.be', 'drive.google.com', 'docs.google.com', 'streamable.com', 'www.streamable.com', 'imgur.com', 'www.imgur.com', 'i.imgur.com', 'clips.twitch.tv', 'www.twitch.tv'];
    if (!hosts.includes(url.hostname.toLowerCase())) throw new Error();
    return url.href;
  } catch { throw new Error('Use an HTTPS evidence link from YouTube, Google Drive, Streamable, Imgur, or Twitch.'); }
}
export function validateReport(input: { matchId: string; reason: string; details: string; evidenceUrl: string; evidenceFiles?: EvidenceFile[] }) {
  if (!input.matchId.trim() || input.matchId.length > 160) throw new Error('Select a match.');
  if (!REPORT_REASONS.includes(input.reason as IntegrityReason)) throw new Error('Select a valid report reason.');
  const details = input.details.trim();
  if (details.length < 30 || details.length > 3000) throw new Error('Describe the incident in 30–3,000 characters, including the replay timestamp.');
  if (!input.evidenceUrl.trim() && !input.evidenceFiles?.length) throw new Error('Upload evidence or include a viewable evidence link.');
  return { matchId: input.matchId.trim(), reason: input.reason as IntegrityReason, details, evidenceUrl: input.evidenceUrl.trim() ? validateEvidenceUrl(input.evidenceUrl) : '', ...(input.evidenceFiles?.length ? { evidenceFiles: input.evidenceFiles } : {}) };
}
export function validateScore(format: MatchFormat, a: number, b: number, completed = false) {
  const target = seriesWinsNeeded(format);
  if (![a, b].every(n => Number.isInteger(n) && n >= 0 && n <= target)) throw new Error(`Scores must be whole numbers from 0 to ${target}.`);
  if (a === target && b === target) throw new Error('Both teams cannot win the same series.');
  if (completed && a !== target && b !== target) throw new Error('A completed series must have a winning score.');
}
export function checkTeamRoster(team: Team, allTeams: Team[], expectedPlayers = 5) {
  const issues: string[] = [];
  if (team.isBye) return [];
  if (team.players.length < expectedPlayers) issues.push(`Fewer than ${expectedPlayers} registered players.`);
  const seen = new Set<string>();
  for (const player of team.players) {
    const id = player.studentId?.trim().toLowerCase();
    if (!player.isVerified) issues.push(`${player.ign || player.name}: verification pending.`);
    if (!id) issues.push(`${player.ign || player.name}: student identifier missing.`);
    else {
      if (seen.has(id)) issues.push(`${player.ign || player.name}: duplicate on this roster.`);
      seen.add(id);
      if (allTeams.some(t => t.id !== team.id && t.gameId === team.gameId && !t.isBye && t.players.some(p => p.studentId?.trim().toLowerCase() === id))) issues.push(`${player.ign || player.name}: registered on another roster in this game.`);
    }
    if (player.collegeId !== team.collegeId) issues.push(`${player.ign || player.name}: college does not match the team.`);
  }
  return [...new Set(issues)];
}
export function matchLabel(match: Match) { return match.lobby ? `${match.roundName} · ${match.lobby.squads}-squad lobby` : `${match.matchNumber} · ${match.team1?.name || 'TBD'} vs ${match.team2?.name || 'TBD'}`; }
