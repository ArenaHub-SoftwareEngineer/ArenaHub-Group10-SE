/**
 * ArenaHub data facade.
 *
 * Components read synchronously from this cache and subscribe for changes. Every shared record
 * comes from Firestore listeners; localStorage holds only per-device preferences.
 * Storage layout and cost notes: src/lib/data/tournamentDocs.ts and docs/READ_BUDGET.md.
 */
import { collection, onSnapshot, orderBy, query, limit, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from './firebase';
import type { Tournament, Match, College, Team, User, ContentReport, AuditLogItem, GameTitle, UserStatus, BracketDraft, TournamentFormat, MatchFormat, MatchMVP, MatchTimelineEvent } from './types';
import { seriesWinsNeeded } from './types';
import { directoryTeams } from './playerProfiles';
import { isRetiredGame, gameCatalog } from './gameRanks';
import { canBroadcastMatch, liveBroadcastFields } from './streamUtils';
import { applyMatchSchedules, canEditMatchSchedule, missingMatchSchedules, type MatchScheduleUpdate } from './streamSchedule';
import { validateScore } from './integrityChecks';
import { scheduleMatches } from './formats/placement';
import { updateMatchAndAdvance } from './bracketUtils';
import { canScoreMatch, scoredMatch } from './liveResults';
import { watchCommunityReports, resolveCommunityReport } from './communityReports';
import { collegeStandings } from './colleges';
import { DEFAULT_CATEGORIES, DEFAULT_GAMES } from './catalogDefaults';
import { bracketTeams, contentFingerprint, toTournamentDoc } from './data/tournamentDocs';
import { assertUniqueTeamNames } from './teamNames';
import {
  publishTournament, restoreTournament, saveTournament, setTournamentFeatured, unpublishTournament,
  watchPreviousVersions, watchPublishedTournaments, type LiveTournament,
} from './data/tournamentStore';
import {
  addFeatured, deleteDraft, mutateCatalog, removeFeatured, saveDraft, setFeatured, watchCatalog, watchDrafts,
  type Catalog, type FeaturedItem,
} from './data/workspaceStore';

type Listener = () => void;
type FeaturedCard = { id: string; title: string; meta: string; link: string; isFeatured: boolean };

/** Keys from the old local-storage workspace. Shared records now live in Firestore. */
const LEGACY_KEYS = ['arenahub_matches', 'arenahub_chat', 'arenahub_tournaments', 'arenahub_categories', 'arenahub_games', 'arenahub_featured_highlights', 'arenahub_featured_posts', 'arenahub_published_brackets', 'arenahub_saved_bracket_draft'];
const LEGACY_DRAFTS_KEY = 'arenahub_saved_bracket_drafts';
const STAFF_ROLES = ['admin', 'organizer', 'school-admin', 'moderator'];

const matchContentFingerprint = (bracket: BracketDraft) => contentFingerprint(toTournamentDoc(bracket, 0));

function tournamentFormat(format: string): TournamentFormat {
  const value = format.toLowerCase();
  return value.includes('double') ? 'double-elimination' : value.includes('round') ? 'round-robin' : value.includes('swiss') ? 'swiss' : 'single-elimination';
}

class FirestoreService {
  private published: BracketDraft[] = [];
  /** Last state confirmed by the server, per tournament id. */
  private cloud = new Map<string, { revision: number; fingerprint: string }>();
  private featuredTournaments = new Set<string>();
  private previous: BracketDraft[] = [];
  private drafts: BracketDraft[] = [];
  private catalog: Catalog | null = null;
  private featured: FeaturedItem[] = [];
  private users: User[] = [];
  private reports: ContentReport[] = [];
  private auditLogs: AuditLogItem[] = [];
  private bracketWritePending = false;
  private pendingSnapshot: LiveTournament[] | null = null;
  private sharedError = '';
  private listeners: Listener[] = [];

  constructor() {
    try { LEGACY_KEYS.forEach(key => localStorage.removeItem(key)); } catch { /* storage unavailable */ }
    if (!isFirebaseConfigured) return;
    let stopUsersListener: (() => void) | undefined;
    onAuthStateChanged(auth, async user => {
      stopUsersListener?.();
      this.users = []; this.reports = []; this.auditLogs = []; this.drafts = []; this.previous = [];
      this.emit();
      if (!user) return;
      try {
        const token = await user.getIdTokenResult();
        if (token.claims.admin === true && auth.currentUser?.uid === user.uid) {
          stopUsersListener = onSnapshot(collection(db, 'users'), snapshot => {
            this.users = snapshot.docs.map(d => { const profile = d.data(); return { id: d.id, name: profile.name || 'Campus member', email: profile.email || '', role: profile.role || 'user', spectatorInviteApproved: profile.spectatorInviteApproved !== false, emailVerified: profile.emailVerified === true, status: profile.status || 'active', collegeId: '', collegeName: profile.collegeName || '', avatarInitials: profile.avatarInitials || 'U', joinedDate: profile.joinedAt?.toDate?.().toLocaleDateString() || '—', joinedAt: profile.joinedAt?.toMillis?.() } as User; });
            this.emit();
          }, () => { this.users = []; this.emit(); });
        }
      } catch { /* claims unavailable */ }
    });
  }

  // --- Subscriptions ---
  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }
  private emit() { this.listeners.forEach(l => l()); }
  private fail(message: string) { this.sharedError = message; this.emit(); }
  public getSharedError() { return this.sharedError; }

  /** Published tournaments for every admitted viewer. */
  public watchLiveBrackets(): () => void {
    if (!isFirebaseConfigured) return () => {};
    return watchPublishedTournaments(items => {
      // While a write is in flight, keep the newest snapshot and apply it when the write finishes.
      if (this.bracketWritePending) { this.pendingSnapshot = items; return; }
      this.applySnapshot(items);
    }, () => this.fail('Live tournament updates are unavailable. Check your connection and refresh.'));
  }

  private publishedLoaded = false;
  /** True once the first published-tournaments snapshot has arrived, so pages can tell "none" from "not loaded yet". */
  public isPublishedLoaded(): boolean { return this.publishedLoaded; }

  private applySnapshot(items: LiveTournament[]) {
    this.publishedLoaded = true;
    this.published = items.map(item => item.bracket);
    this.cloud = new Map(items.map(item => [item.bracket.id, { revision: item.revision, fingerprint: matchContentFingerprint(item.bracket) }]));
    this.featuredTournaments = new Set(items.filter(item => item.featured).map(item => item.bracket.id));
    this.emit();
  }

  /** Catalog and spotlight for everyone; reports, audit log, drafts and restore points for staff. */
  public watchSharedWorkspace(staff: boolean): () => void {
    if (!isFirebaseConfigured) return () => {};
    let active = true;
    const fail = () => { if (active) this.fail('Shared workspace updates are unavailable. Check your connection and database permissions.'); };
    const stops = [
      watchCatalog(catalog => { this.catalog = catalog; this.emit(); }, fail),
    ];
    const uid = auth.currentUser?.uid;
    if (staff) {
      stops.push(watchCommunityReports(reports => { this.reports = reports; this.emit(); }, fail));
      stops.push(onSnapshot(query(collection(db, 'auditEvents'), orderBy('createdAt', 'desc'), limit(100)), snap => {
        this.auditLogs = snap.docs.map(item => ({ id: item.id, actor: item.data().actorId, action: item.data().action, timestamp: item.data().createdAt?.toDate?.().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) || 'Just now', at: item.data().createdAt?.toMillis?.() ?? Date.now() }));
        this.emit();
      }, fail));
      stops.push(watchPreviousVersions(items => { this.previous = items; this.emit(); }, fail));
      if (uid) {
        stops.push(watchDrafts(uid, drafts => { this.drafts = drafts; this.emit(); }, fail));
        void this.migrateLocalDrafts(uid);
      }
    }
    return () => { active = false; stops.forEach(stop => stop()); };
  }

  /** One-time move of drafts saved by the old version of the app from this browser into the organizer's account. */
  private async migrateLocalDrafts(uid: string) {
    let local: BracketDraft[] = [];
    try { local = JSON.parse(localStorage.getItem(LEGACY_DRAFTS_KEY) || '[]'); } catch { return; }
    if (!Array.isArray(local) || !local.length) { try { localStorage.removeItem(LEGACY_DRAFTS_KEY); } catch {} return; }
    try {
      for (const draft of local) await saveDraft(uid, { ...draft, status: 'saved' });
      localStorage.removeItem(LEGACY_DRAFTS_KEY);
    } catch { this.fail('Drafts saved in this browser could not be moved to your account yet. They are still on this device.'); }
  }

  // --- Tournaments (derived from published brackets) ---
  public getTournaments(): Tournament[] {
    return this.getPublishedBrackets().map(bracket => {
      const matches = bracket.matches.filter(m => !m.inactive && !m.team1?.isBye && !m.team2?.isBye);
      const dates = matches.map(m => m.scheduledDate).filter(Boolean);
      const next = matches.find(m => m.status !== 'completed');
      const colleges = new Set(matches.flatMap(m => [m.team1?.collegeCode, m.team2?.collegeCode]).filter(Boolean));
      return {
        id: bracket.id, title: bracket.title, subtitle: `${bracket.format} · ${bracket.matchFormat}`,
        gameId: bracket.gameId || '', gameName: bracket.gameName, format: tournamentFormat(bracket.format),
        matchFormat: (bracket.matchFormat as MatchFormat) || 'Bo3',
        status: matches.some(m => m.status === 'live') ? 'live' : matches.length && matches.every(m => m.status === 'completed') ? 'completed' : 'upcoming',
        startDate: dates[0] || '', endDate: dates.at(-1) || '', collegesCount: colleges.size,
        bannerImage: this.getGames().find(g => g.id === bracket.gameId)?.bannerImage || '',
        isFeatured: this.featuredTournaments.has(bracket.id), currentStage: next?.roundName || 'Completed',
      };
    });
  }

  public getTournamentById(id: string): Tournament | undefined {
    return this.getTournaments().find(t => t.id === id);
  }

  // --- Matches ---
  public getMatches(): Match[] {
    return this.getPublishedBrackets().flatMap(b => b.matches).filter(m => !isRetiredGame(m));
  }

  public getMatchById(id: string): Match | undefined {
    return this.getMatches().find(m => m.id === id);
  }

  /** Applies a change to the published bracket that contains the match. Callers then call syncBracketsToCloud(). */
  private updateBracketOf(matchId: string, change: (matches: Match[], match: Match) => Match[]): Match | undefined {
    let found: Match | undefined;
    this.published = this.published.map(bracket => {
      const match = bracket.matches.find(m => m.id === matchId);
      if (!match) return bracket;
      const matches = change(bracket.matches, match);
      found = matches.find(m => m.id === matchId);
      return { ...bracket, matches };
    });
    return found;
  }

  private updateMatch(matchId: string, updater: (match: Match) => Match) {
    return this.updateBracketOf(matchId, matches => matches.map(m => m.id === matchId ? updater(m) : m));
  }

  public updateMatchScore(matchId: string, team1Score: number, team2Score: number, instantAdvance = true, newStatus?: Match['status']): void {
    const updated = this.updateBracketOf(matchId, (matches, current) => {
      validateScore(current.matchFormat, team1Score, team2Score, newStatus === 'completed');
      const next: Match = {
        ...current, score: { ...current.score, team1Score, team2Score },
        status: newStatus || (current.status === 'completed' ? 'upcoming' : current.status), winnerId: undefined,
      };
      const target = seriesWinsNeeded(current.matchFormat);
      if (team1Score >= target) { next.winnerId = next.team1?.id; next.status = 'completed'; }
      else if (team2Score >= target) { next.winnerId = next.team2?.id; next.status = 'completed'; }
      return instantAdvance ? updateMatchAndAdvance(matches, next) : matches.map(m => m.id === matchId ? next : m);
    });
    if (!updated) return;
    this.addAuditLog('Score updated for match ' + updated.matchNumber);
    this.emit();
  }

  public async savePublishedMatchSchedules(bracketId: string, updates: MatchScheduleUpdate[]): Promise<void> {
    this.requireSignedIn('change the match schedule');
    const bracket = this.getPublishedBracketById(bracketId);
    const cloud = bracket && this.cloud.get(bracket.id);
    if (!bracket || !cloud) throw new Error('This bracket is no longer published.');
    for (const { id } of updates) {
      const match = bracket.matches.find(match => match.id === id);
      if (!match || !canEditMatchSchedule(match)) throw new Error('A selected match has started or is no longer available. Review the schedule again.');
    }
    const next = { ...bracket, matches: applyMatchSchedules(bracket.matches, updates) };
    await this.writeTournament(next, cloud.revision);
    this.addAuditLog(`Updated schedule for ${updates.length} matches`);
  }

  public async publishMatchBroadcast(matchId: string, { url, title, thumbnailUrl }: { url: string; title: string; thumbnailUrl: string }): Promise<void> {
    const broadcast = liveBroadcastFields(url, thumbnailUrl);
    await this.persistMatchChange(matchId, match => {
      if (!canBroadcastMatch(match)) throw new Error('This match is no longer available to broadcast.');
      return { ...match, ...broadcast, streamTitle: title.trim().slice(0, 160) };
    });
    this.addAuditLog(`Live stream connected to match ${matchId}`);
  }

  public async removeMatchStream(matchId: string): Promise<void> {
    await this.persistMatchChange(matchId, match => { const next = { ...match }; delete next.streamUrl; delete next.broadcastLinks; return next; });
    this.addAuditLog(`Live stream disconnected from match ${matchId}`);
  }

  /** Saves Battle Royale placement results straight to their published event. */
  public async savePlacementEvent(bracketId: string, placement: NonNullable<BracketDraft['placement']>, auditText: string): Promise<void> {
    if (!isFirebaseConfigured || !auth.currentUser) throw new Error('Sign in as tournament staff to save results.');
    const bracket = this.published.find(b => b.id === bracketId);
    const cloud = bracket && this.cloud.get(bracketId);
    if (!bracket?.placement || !cloud) throw new Error('This Battle Royale event is not published. Reload and try again.');
    const updated: BracketDraft = { ...bracket, placement };
    await this.writeTournament(updated, cloud.revision);
    this.published = this.published.map(b => b.id === bracketId ? updated : b);
    this.addAuditLog(auditText);
    this.emit();
  }

  /**
   * Sets (or, without an image, removes) a team's logo. With `everyGame`, the same college's team in every other
   * published bracket gets it too, so one upload covers MLBB, Dota 2 and CODM. Bracket Studio reads the same field.
   */
  public async saveTeamLogo(bracketId: string, teamId: string, image: string | undefined, everyGame = true): Promise<void> {
    this.requireSignedIn('change team logos');
    const source = this.published.find(b => b.id === bracketId);
    const team = source && bracketTeams(source).find(t => t.id === teamId);
    if (!source || !team) throw new Error('This team is no longer in a published bracket. Reload and try again.');
    const code = (team.collegeCode || '').trim().toUpperCase();
    const targets = this.published.flatMap(bracket => {
      const ids = bracket.id === bracketId ? [teamId]
        : everyGame && code ? bracketTeams(bracket).filter(t => (t.collegeCode || '').trim().toUpperCase() === code).map(t => t.id) : [];
      return ids.length && this.cloud.has(bracket.id) ? [{ bracket, ids }] : [];
    });
    await this.guarded(async () => {
      for (const { bracket, ids } of targets) {
        const teams = { ...bracket.appearance?.teams };
        for (const id of ids) {
          const { image: _old, ...rest } = teams[id] || {};
          if (image) teams[id] = { ...rest, image };
          else if (Object.keys(rest).length) teams[id] = rest;
          else delete teams[id];
        }
        const next: BracketDraft = { ...bracket, appearance: { ...bracket.appearance, teams } };
        await this.writeTournament(next, this.cloud.get(bracket.id)!.revision, false);
        this.published = this.published.map(b => b.id === next.id ? next : b);
      }
    });
    this.addAuditLog(`${image ? 'Updated' : 'Removed'} the logo for ${team.name}`);
    this.emit();
  }

  public async setMatchStatus(matchId: string, status: Match['status']): Promise<void> {
    await this.persistMatchChange(matchId, match => {
      if (status === 'live' && !canBroadcastMatch(match)) throw new Error('This match is no longer available to go live.');
      return { ...match, status };
    });
    this.addAuditLog(`Match ${matchId} status updated to ${status}`);
  }

  /** Apply broadcast and status changes after the cloud write succeeds. */
  private async persistMatchChange(matchId: string, change: (match: Match) => Match) {
    this.requireSignedIn('update this match');
    const bracket = this.published.find(bracket => bracket.matches.some(match => match.id === matchId));
    const cloud = bracket && this.cloud.get(bracket.id);
    if (!bracket || !cloud) throw new Error('Publish this match before changing its status.');
    const next = { ...bracket, matches: bracket.matches.map(match => match.id === matchId ? change(match) : match) };
    await this.writeTournament(next, cloud.revision);
    this.published = this.published.map(bracket => bracket.id === next.id ? next : bracket);
    this.emit();
  }

  public saveMatchPlayerStats(matchId: string, stats: NonNullable<Match['playerStats']>, gameNumber = '1', notes = ''): void {
    const updated = this.updateMatch(matchId, match => ({ ...match, playerStats: stats, statGames: { ...match.statGames, [gameNumber]: { playerStats: stats, notes } } }));
    if (!updated) throw new Error('Match not found.');
    this.addAuditLog(`Player stats saved for ${updated.matchNumber}`);
    this.emit();
  }

  /** Saves the organizer-entered timeline and MVP for one published match. Pass no MVP to clear it. */
  public async saveMatchHighlights(matchId: string, events: MatchTimelineEvent[], mvp?: MatchMVP): Promise<void> {
    const updated = this.updateMatch(matchId, match => {
      const next: Match = { ...match, timelineEvents: events };
      if (mvp) next.mvp = mvp; else delete next.mvp;
      return next;
    });
    if (!updated) throw new Error('Match not found. Reload and choose the match again.');
    this.addAuditLog(`Timeline (${events.length} events) and MVP ${mvp ? `(${mvp.ign})` : '(none)'} saved for ${updated.matchNumber}`);
    this.emit();
    await this.syncBracketsToCloud();
  }

  // --- Drafts (per organizer, in Firestore) ---
  public getSavedBracketDraft(): BracketDraft | null { return this.drafts[0] ?? null; }
  public getSavedBracketDrafts(): BracketDraft[] { return this.drafts; }

  public async saveBracketDraft(draft: BracketDraft): Promise<BracketDraft> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Sign in as tournament staff to save drafts.');
    assertUniqueTeamNames(draft);
    const saved: BracketDraft = { ...draft, status: 'saved', createdAt: draft.createdAt || new Date().toLocaleDateString() };
    await saveDraft(uid, saved);
    this.drafts = [saved, ...this.drafts.filter(entry => entry.id !== saved.id)];
    this.addAuditLog(`Saved bracket draft: "${saved.title}" (${saved.teamsCount} teams)`);
    this.emit();
    return saved;
  }

  public async deleteSavedBracketDraft(id: string): Promise<void> {
    const uid = auth.currentUser?.uid;
    const deleted = this.drafts.find(draft => draft.id === id);
    if (!uid) throw new Error('Sign in as tournament staff to delete drafts.');
    if (!deleted) return;
    await deleteDraft(uid, id);
    this.drafts = this.drafts.filter(draft => draft.id !== id);
    this.addAuditLog(`Deleted saved bracket draft: "${deleted.title}"`);
    this.emit();
  }

  // --- Published brackets ---
  public getPublishedBrackets(): BracketDraft[] { return this.published.filter(b => !b.placement && !isRetiredGame(b)); }
  /** Every published event, Battle Royale lobbies included (Anti-cheat check-in needs the lobby games too). */
  public getPublishedEvents(): BracketDraft[] { return this.published.filter(b => !isRetiredGame(b)); }
  public getPublishedBracketById(id: string): BracketDraft | undefined { return this.getPublishedBrackets().find(b => b.id === id); }
  public getPreviousPublishedBrackets(): BracketDraft[] { return this.previous.filter(b => !b.placement); }

  public async publishBracket(draft: BracketDraft, gameName: string, gameId?: string): Promise<BracketDraft> {
    this.requireSignedIn('publish or restore brackets');
    assertUniqueTeamNames(draft);
    if (!draft.placement && !this.getPublishedBracketById(draft.id) && missingMatchSchedules(draft.matches).length) {
      throw new Error('Schedule every playable match before publishing this bracket.');
    }
    const published: BracketDraft = {
      ...draft, gameName, ...(gameId ? { gameId } : {}),
      matches: gameId && gameId !== 'game-custom'
        ? draft.matches.map(({ gameMode: _mode, ...match }) => ({
          ...match, gameId,
          ...(gameId === 'game-codm-mp' ? { gameMode: 'mp' as const } : {}),
          ...(gameId === 'game-codm-br' ? { gameMode: 'br' as const } : {}),
        }))
        : draft.matches,
      status: 'published', createdAt: new Date().toLocaleDateString(),
    };
    await this.guarded(() => publishTournament(published));
    this.addAuditLog(`Published bracket "${published.title}" (${gameName})`);
    return published;
  }

  /**
   * Saves one result straight to a live bracket: the winner advances and spectators see it at once.
   * No new version is kept (Versions is for whole re-publishes), and nothing changes here until the cloud write succeeds.
   */
  public async savePublishedMatchResult(bracketId: string, matchId: string, team1Score: number, team2Score: number): Promise<BracketDraft> {
    this.requireSignedIn('update match results');
    const bracket = this.published.find(b => b.id === bracketId);
    const cloud = bracket && this.cloud.get(bracketId);
    const current = bracket?.matches.find(m => m.id === matchId);
    if (!bracket || !cloud || !current) throw new Error('This bracket is no longer live. Reload and try again.');
    if (!canScoreMatch(current)) throw new Error('Both teams must be known before a result can be saved.');
    const next: BracketDraft = { ...bracket, matches: updateMatchAndAdvance(bracket.matches, scoredMatch(current, team1Score, team2Score)) };
    await this.writeTournament(next, cloud.revision);
    this.published = this.published.map(b => b.id === bracketId ? next : b);
    this.addAuditLog(`Result saved for ${current.team1?.name} vs ${current.team2?.name}: ${team1Score}-${team2Score}`);
    this.emit();
    return next;
  }

  /** Writes an edited live bracket over itself (same game, no Versions entry), for Bracket Studio's "Update live". */
  public async updatePublishedBracket(draft: BracketDraft): Promise<BracketDraft> {
    this.requireSignedIn('update live brackets');
    assertUniqueTeamNames(draft);
    const live = this.published.find(b => b.id === draft.id);
    const cloud = this.cloud.get(draft.id);
    if (!live || !cloud) throw new Error('This bracket is no longer live. Publish it again instead.');
    const next: BracketDraft = { ...draft, gameName: live.gameName, gameId: live.gameId, status: 'published' };
    await this.writeTournament(next, cloud.revision);
    this.published = this.published.map(b => b.id === next.id ? next : b);
    this.addAuditLog(`Updated live bracket "${next.title}"`);
    this.emit();
    return next;
  }

  public async restorePublishedBracket(previous: BracketDraft): Promise<BracketDraft> {
    this.requireSignedIn('publish or restore brackets');
    const restored = await this.guarded(() => restoreTournament(previous));
    this.addAuditLog(`Restored bracket "${restored.title}" (${restored.gameName})`);
    return restored;
  }

  /**
   * Unpublishes one bracket in the cloud first, and removes it here only after that succeeds.
   * If the write fails the bracket stays listed, matching what viewers still see, and the caller can retry.
   */
  public async unpublishBracket(bracketId: string): Promise<void> {
    this.requireSignedIn('unpublish brackets');
    const bracket = this.published.find(b => b.id === bracketId);
    const cloud = this.cloud.get(bracketId);
    if (cloud) await this.guarded(() => unpublishTournament(bracketId, cloud.revision));
    this.published = this.published.filter(b => b.id !== bracketId);
    this.cloud.delete(bracketId);
    if (bracket) this.addAuditLog(`Unpublished bracket "${bracket.title}"`);
    this.emit();
  }

  /** Writes every locally edited tournament, and unpublishes removed ones, each in its own transaction. */
  public async syncBracketsToCloud(): Promise<void> {
    this.requireSignedIn('sync brackets');
    if (this.bracketWritePending) throw new Error('Another bracket update is in progress. Try again.');
    const changed = this.published.filter(b => { const cloud = this.cloud.get(b.id); return cloud && cloud.fingerprint !== matchContentFingerprint(b); });
    const removed = [...this.cloud.entries()].filter(([id]) => !this.published.some(b => b.id === id));
    await this.guarded(async () => {
      for (const bracket of changed) await this.writeTournament(bracket, this.cloud.get(bracket.id)!.revision, false);
      for (const [id, { revision }] of removed) { await unpublishTournament(id, revision); this.cloud.delete(id); }
    });
  }

  private async writeTournament(bracket: BracketDraft, revision: number, guard = true) {
    const write = async () => {
      const next = await saveTournament(bracket, revision);
      this.cloud.set(bracket.id, { revision: next, fingerprint: matchContentFingerprint(bracket) });
    };
    if (guard) await this.guarded(write); else await write();
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    if (this.bracketWritePending) throw new Error('Another bracket update is in progress. Try again.');
    this.bracketWritePending = true;
    try { return await work(); } finally {
      this.bracketWritePending = false;
      const pending = this.pendingSnapshot;
      this.pendingSnapshot = null;
      if (pending) this.applySnapshot(pending);
    }
  }

  private requireSignedIn(action: string) {
    if (!isFirebaseConfigured || !auth.currentUser) throw new Error(`Sign in to ${action}.`);
  }

  // --- Colleges and teams (computed from published records) ---
  public getColleges(): College[] { return collegeStandings(this.getPublishedBrackets()); }
  public getTeams(): Team[] { return directoryTeams(this.getPublishedBrackets()); }

  // --- Users ---
  public getUsers(): User[] { return this.users; }

  public async updateUserStatus(userId: string, status: UserStatus, durationText?: string): Promise<void> {
    if (!auth.currentUser) throw new Error('Sign in as an administrator.');
    if (auth.currentUser.uid === userId && status !== 'active') throw new Error('You cannot restrict your own administrator account.');
    const token = await auth.currentUser.getIdTokenResult();
    if (token.claims.admin !== true) throw new Error('Only a project administrator can change account status.');
    await updateDoc(doc(db, 'users', userId), { status });
    const user = this.users.find(u => u.id === userId);
    if (user) {
      user.status = status;
      user.suspendedUntil = durationText || undefined;
      this.addAuditLog(`${user.name} marked as ${status}`);
      this.emit();
    }
  }

  // --- Reports ---
  public getReports(): ContentReport[] { return this.reports; }
  public async resolveReport(reportId: string, action: 'remove' | 'remove_and_ban' | 'dismiss'): Promise<void> {
    await resolveCommunityReport(reportId, action);
  }

  // --- Games and categories ---
  private catalogOrDefaults(): Catalog { return this.catalog ?? { games: DEFAULT_GAMES, categories: DEFAULT_CATEGORIES }; }

  public getGames(): GameTitle[] {
    const teamCounts = new Map<string, number>();
    for (const team of this.getTeams()) teamCounts.set(team.gameId, (teamCounts.get(team.gameId) || 0) + 1);
    return gameCatalog(this.catalogOrDefaults().games, DEFAULT_GAMES).map(game => ({ ...game, registeredTeams: teamCounts.get(game.id) || 0 }));
  }

  private async changeCatalog(change: (catalog: Catalog) => void) {
    this.requireSignedIn('save shared settings');
    this.catalog = await mutateCatalog(this.catalogOrDefaults(), change);
    this.emit();
  }

  public async addGame(game: GameTitle): Promise<void> {
    await this.changeCatalog(c => { if (c.games.some(g => g.id === game.id || g.name.toLowerCase() === game.name.toLowerCase())) throw new Error('This game already exists.'); c.games.push({ ...game, registeredTeams: 0 }); });
    this.addAuditLog(`Added new game title: ${game.name}`);
  }

  public async removeGame(gameId: string): Promise<void> {
    const game = this.getGames().find(g => g.id === gameId);
    await this.changeCatalog(c => { c.games = c.games.filter(g => g.id !== gameId); });
    if (game) this.addAuditLog(`Removed game title: ${game.name}`);
  }

  public async updateGame(updatedGame: GameTitle): Promise<void> {
    await this.changeCatalog(c => { c.games = c.games.map(g => g.id === updatedGame.id ? { ...updatedGame, registeredTeams: 0 } : g); });
  }

  public getCategories(): string[] { return this.catalogOrDefaults().categories; }
  public async addCategory(cat: string): Promise<void> { await this.changeCatalog(c => { if (!c.categories.includes(cat.trim())) c.categories.push(cat.trim()); }); }
  public async removeCategory(cat: string): Promise<void> { await this.changeCatalog(c => { c.categories = c.categories.filter(x => x !== cat); }); }

  // --- Featured ---
  private featuredCards(kind: FeaturedItem['kind']): FeaturedCard[] {
    return this.featured.filter(item => item.kind === kind).map(item => ({
      id: item.id, title: item.title, link: item.link, isFeatured: item.isFeatured,
      meta: `by ${item.author}${item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}` : ''}`,
    }));
  }
  public getFeaturedHighlights(): FeaturedCard[] { return this.featuredCards('highlight'); }
  public getFeaturedPosts(): FeaturedCard[] { return this.featuredCards('post'); }

  public async addFeaturedItem(kind: FeaturedItem['kind'], input: { title: string; link: string; author: string }) {
    this.requireSignedIn('add spotlight items');
    await addFeatured(kind, input);
    this.addAuditLog(`Added ${kind}: ${input.title.trim()}`);
  }
  public async removeFeaturedItem(id: string) {
    await removeFeatured(id);
    this.addAuditLog(`Removed spotlight item ${id}`);
  }
  public async toggleFeatureTournament(id: string): Promise<void> {
    await setTournamentFeatured(id, !this.featuredTournaments.has(id));
    this.addAuditLog(`Updated tournament spotlight: ${id}`);
  }
  public async toggleFeatureHighlight(id: string): Promise<void> {
    const item = this.featured.find(f => f.id === id);
    if (item) await setFeatured(id, !item.isFeatured);
    this.addAuditLog(`Updated highlight spotlight: ${id}`);
  }
  public async toggleFeaturePost(id: string): Promise<void> { await this.toggleFeatureHighlight(id); }

  // --- Audit log ---
  public getAuditLogs(): AuditLogItem[] { return this.auditLogs; }

  public addAuditLog(actionText: string, actor: string = auth.currentUser?.displayName || auth.currentUser?.email || 'Organizer'): void {
    this.auditLogs = [{ id: `audit-${Date.now()}`, actor, action: actionText, timestamp: 'Just now', at: Date.now() }, ...this.auditLogs].slice(0, 100);
    this.emit();
    const user = auth.currentUser;
    if (user) void user.getIdTokenResult().then(token => {
      if (token.claims.admin !== true && !STAFF_ROLES.includes(String(token.claims.role))) return;
      return addDoc(collection(db, 'auditEvents'), { actorId: user.uid, action: actionText.slice(0, 1500), createdAt: serverTimestamp() });
    }).catch(() => this.fail('The change completed, but its shared activity entry could not be saved.'));
  }
}

export const firestoreService = new FirestoreService();
