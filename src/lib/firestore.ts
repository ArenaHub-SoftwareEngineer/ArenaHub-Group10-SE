import { hydrateSampleRoster, publicBracket, directoryTeams } from './playerProfiles';
import { isRetiredGame, gameCatalog } from './gameRanks';
import { updateBroadcastLinks, validateBroadcastLinks, matchBroadcasts, detectPlatform, streamWatchUrl, type BroadcastLink, type BroadcastPlatform } from './streamUtils';
/**
 * ArenaHub Firestore Service Layer
 * 
 * Published brackets and account status use Firebase. Sample workspace records
 * persist locally. Evidence reports have a separate transaction-based service.
 */

import {
  Tournament,
  Match,
  College,
  Team,
  User,
  ContentReport,
  AuditLogItem,
  GameTitle,
  ChatMessage,
  UserRole,
  UserStatus,
  BracketDraft
} from './types';

import {
  INITIAL_TOURNAMENTS,
  INITIAL_MATCHES,
  INITIAL_COLLEGES,
  INITIAL_TEAMS,
  INITIAL_USERS,
  INITIAL_REPORTS,
  INITIAL_AUDIT_LOGS,
  INITIAL_GAMES,
  INITIAL_CHAT_MESSAGES
} from './mockData';
import { collection, doc, onSnapshot, runTransaction, updateDoc, addDoc, serverTimestamp, orderBy, query, limit } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from './firebase';
import { seriesWinsNeeded } from './types';
import type { MatchScheduleUpdate } from './streamSchedule';
import { validateScore } from './integrityChecks';
import { publicationGameKey, replacePublishedBracket } from './bracketPublication';
import { updateMatchAndAdvance } from './bracketUtils';
import { notificationRecord } from './notificationService';
import { watchCommunityReports, resolveCommunityReport } from './communityReports';

type Listener = () => void;

function stableJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item);
}

class FirestoreService {
  private tournaments: Tournament[] = [...INITIAL_TOURNAMENTS];
  private matches: Match[] = [...INITIAL_MATCHES];
  private colleges: College[] = [...INITIAL_COLLEGES];
  private teams: Team[] = [...INITIAL_TEAMS];
  private users: User[] = [];
  private reports: ContentReport[] = [];
  private auditLogs: AuditLogItem[] = [...INITIAL_AUDIT_LOGS];
  private games: GameTitle[] = [...INITIAL_GAMES];
  private categories: string[] = ['MOBA', 'Tactical FPS', 'Intramurals', 'Freshman Cup', 'Scrims'];
  private chatMessages: ChatMessage[] = [...INITIAL_CHAT_MESSAGES];
  private publishedBrackets: BracketDraft[] = [];
  private savedBracketDraft: BracketDraft | null = null;
  private savedBracketDrafts: BracketDraft[] = [];
  private bracketWritePending = false;
  private previousPublishedBrackets: BracketDraft[] = [];
  private publicationRevision = 0;
  private sharedError = '';
  private featuredHighlights: Array<{ id: string; title: string; meta: string; isFeatured: boolean }> = [
    { id: 'h1', title: "Riley's Lord steal vs COE", meta: '0:42 · 2.1k views', isFeatured: false },
    { id: 'h2', title: "CN Pulse 1v3 clutch on Ascent", meta: '0:31 · 1.4k views', isFeatured: false },
  ];
  private featuredPosts: Array<{ id: string; title: string; meta: string; isFeatured: boolean }> = [
    { id: 'p1', title: 'Upper bracket final is tonight — 11:15 PM', meta: 'by Palaro Committee · 312 reactions', isFeatured: false },
  ];

  private listeners: Listener[] = [];

  constructor() {
    this.loadState();
    this.replaceLiveBrackets(this.publishedBrackets);
    if (isFirebaseConfigured) {
      let stopUsersListener: (() => void) | undefined;
      onAuthStateChanged(auth, async (user) => {
        stopUsersListener?.();
        this.users = [];
        this.reports = []; this.auditLogs = [];
        this.listeners.forEach(l => l());
        if (!user) return;
        try {
          const token = await user.getIdTokenResult();
          if (token.claims.admin === true && auth.currentUser?.uid === user.uid) {
            stopUsersListener = onSnapshot(collection(db, 'users'), snapshot => {
              this.users = snapshot.docs.map(d => { const profile = d.data(); return { id: d.id, name: profile.name || 'Campus member', email: profile.email || '', role: profile.role || 'user', spectatorInviteApproved: profile.spectatorInviteApproved === true, status: profile.status || 'active', collegeId: '', collegeName: profile.collegeName || '', avatarInitials: profile.avatarInitials || 'U', joinedDate: profile.joinedAt?.toDate?.().toLocaleDateString() || '—' } as User; });
              this.listeners.forEach(l => l());
            }, () => { this.users = []; this.listeners.forEach(l => l()); });
          }
        } catch {}
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key && event.key.startsWith('arenahub_')) {
          this.loadState();
          this.replaceLiveBrackets(this.publishedBrackets);
          this.listeners.forEach((l) => l());
        }
      });
    }
  }

  public watchLiveBrackets(): () => void {
    if (!isFirebaseConfigured) return () => {};
    return onSnapshot(doc(db, 'arenahub', 'brackets'), snapshot => {
      if (this.bracketWritePending) return;
      if (!snapshot.exists()) { this.replaceLiveBrackets([]); this.previousPublishedBrackets = []; this.publicationRevision = 0; this.notify(); return; }
      const data = snapshot.data();
      this.replaceLiveBrackets(Array.isArray(data.publishedBrackets) ? data.publishedBrackets : [], data.savedBracketDraft || null);
      this.previousPublishedBrackets = Array.isArray(data.previousPublishedBrackets) ? data.previousPublishedBrackets : [];
      this.publicationRevision = Number(data.publicationRevision) || 0;
      this.notify();
    }, error => console.warn('[ArenaHub] Bracket live updates unavailable:', error));
  }

  public getSharedError() { return this.sharedError; }
  public watchSharedWorkspace(staff: boolean): () => void {
    let active = true;
    const fail = () => { if (active) { this.sharedError = 'Shared workspace updates are unavailable. Check your connection and database permissions.'; this.listeners.forEach(l => l()); } };
    const stops = [onSnapshot(doc(db, 'arenahub', 'workspace'), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      this.games = data.games; this.categories = data.categories; this.featuredHighlights = data.featuredHighlights; this.featuredPosts = data.featuredPosts; this.tournaments = data.tournaments;
      this.sharedError = ''; this.notify();
    }, fail)];
    if (staff) stops.push(watchCommunityReports(reports => { this.reports = reports; this.listeners.forEach(l => l()); }, fail));
    if (staff) stops.push(onSnapshot(query(collection(db, 'auditEvents'), orderBy('createdAt', 'desc'), limit(50)), snap => {
      this.auditLogs = snap.docs.map(item => ({ id: item.id, actor: item.data().actorId, action: item.data().action, timestamp: item.data().createdAt?.toDate?.().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) || 'Just now' }));
      this.listeners.forEach(l => l());
    }, fail));
    return () => { active = false; stops.forEach(stop => stop()); };
  }

  private async mutateWorkspace(change: (data: any) => void): Promise<void> {
    if (!auth.currentUser) throw new Error('Sign in as tournament staff to save shared settings.');
    const ref = doc(db, 'arenahub', 'workspace');
    const data = await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const next = snap.exists() ? snap.data() : { games: INITIAL_GAMES, categories: ['MOBA', 'Tactical FPS', 'Intramurals', 'Freshman Cup', 'Scrims'], featuredHighlights: this.featuredHighlights.map(item => ({ ...item, isFeatured: false })), featuredPosts: this.featuredPosts.map(item => ({ ...item, isFeatured: false })), tournaments: INITIAL_TOURNAMENTS };
      const clean = JSON.parse(JSON.stringify(next));
      clean.games = gameCatalog(clean.games, INITIAL_GAMES);
      change(clean);
      if (new Blob([JSON.stringify(clean)]).size > 850000) throw new Error('Shared settings are too large. Use an image link or a smaller banner.');
      tx.set(ref, { ...clean, updatedAt: serverTimestamp() });
      return clean;
    });
    this.games = data.games; this.categories = data.categories; this.featuredHighlights = data.featuredHighlights; this.featuredPosts = data.featuredPosts; this.tournaments = data.tournaments; this.sharedError = ''; this.notify();
  }

  private loadState() {
    try {
      const savedMatches = localStorage.getItem('arenahub_matches');
      if (savedMatches) {
        this.matches = JSON.parse(savedMatches);
        this.matches.forEach((m) => {
          m.team1 = hydrateSampleRoster(m.team1, INITIAL_TEAMS);
          m.team2 = hydrateSampleRoster(m.team2, INITIAL_TEAMS);
          if (m.streamUrl && m.streamUrl.includes('wmsu-palaro-2026-stream')) {
            m.streamUrl = 'https://www.youtube.com/embed/P5E3LDzWTRg?autoplay=1&rel=0&modestbranding=1';
          }
        });
      }

      const savedChat = localStorage.getItem('arenahub_chat');
      if (savedChat) this.chatMessages = JSON.parse(savedChat);
      const savedTournaments = localStorage.getItem('arenahub_tournaments');
      if (savedTournaments) this.tournaments = JSON.parse(savedTournaments);




      const savedCategories = localStorage.getItem('arenahub_categories');
      if (savedCategories) this.categories = JSON.parse(savedCategories);

      const savedGames = localStorage.getItem('arenahub_games');
      if (savedGames) this.games = JSON.parse(savedGames);
      const savedHighlights = localStorage.getItem('arenahub_featured_highlights');
      if (savedHighlights) this.featuredHighlights = JSON.parse(savedHighlights);
      const savedPosts = localStorage.getItem('arenahub_featured_posts');
      if (savedPosts) this.featuredPosts = JSON.parse(savedPosts);

      const savedBrackets = localStorage.getItem('arenahub_published_brackets');
      if (savedBrackets) this.publishedBrackets = JSON.parse(savedBrackets);

      const savedDraft = localStorage.getItem('arenahub_saved_bracket_draft');
      this.savedBracketDraft = savedDraft ? JSON.parse(savedDraft) : null;
      const drafts = JSON.parse(localStorage.getItem('arenahub_saved_bracket_drafts') || '[]');
      if (Array.isArray(drafts)) this.savedBracketDrafts = drafts;
    } catch {
      // storage unavailable
    }
  }

  private saveState() {
    try {
      localStorage.setItem('arenahub_chat', JSON.stringify(this.chatMessages));
      localStorage.setItem('arenahub_tournaments', JSON.stringify(this.tournaments));
      localStorage.setItem('arenahub_matches', JSON.stringify(this.matches));
  
      localStorage.setItem('arenahub_categories', JSON.stringify(this.categories));
      localStorage.setItem('arenahub_games', JSON.stringify(this.games));
      localStorage.setItem('arenahub_featured_highlights', JSON.stringify(this.featuredHighlights));
      localStorage.setItem('arenahub_featured_posts', JSON.stringify(this.featuredPosts));
      localStorage.setItem('arenahub_published_brackets', JSON.stringify(this.publishedBrackets));
      localStorage.setItem('arenahub_saved_bracket_drafts', JSON.stringify(this.getSavedBracketDrafts()));
      if (this.savedBracketDraft) {
        localStorage.setItem('arenahub_saved_bracket_draft', JSON.stringify(this.savedBracketDraft));
      } else {
        localStorage.removeItem('arenahub_saved_bracket_draft');
      }
    } catch {
      // storage unavailable
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.saveState();
    this.listeners.forEach((l) => l());
  }

  private replaceLiveBrackets(brackets: BracketDraft[], oldCloudDraft: BracketDraft | null = null): void {
    const staleMatches = new Set([
      ...this.publishedBrackets, this.savedBracketDraft, oldCloudDraft,
    ].flatMap(bracket => bracket?.matches.map(match => match.id) ?? []));
    const live = new Map(brackets.flatMap(bracket => bracket.matches).map(match => [match.id, match]));
    this.matches = [...this.matches.filter(match => !staleMatches.has(match.id) && !live.has(match.id)), ...live.values()];
    this.publishedBrackets = brackets;
  }

  private serializeBracketPayload(payload: object) {
    const serialized = JSON.stringify(payload);
    if (new Blob([serialized]).size > 950_000) {
      throw new Error('The bracket and its previous versions exceed the cloud storage limit.');
    }
    return JSON.parse(serialized);
  }

  public async syncBracketsToCloud(): Promise<void> {
    if (!isFirebaseConfigured || !auth.currentUser) throw new Error('Sign in to sync brackets.');
    if (this.bracketWritePending) throw new Error('Another bracket update is in progress. Try again.');
    const ref = doc(db, 'arenahub', 'brackets');
    const revision = this.publicationRevision;
    const publishedBrackets = this.publishedBrackets.map(publicBracket);
    this.bracketWritePending = true;
    try {
      await runTransaction(db, async transaction => {
        const data = (await transaction.get(ref)).data();
        if ((Number(data?.publicationRevision) || 0) !== revision) {
          throw new Error('A newer bracket was published. Reload before applying this change.');
        }
        const payload = this.serializeBracketPayload({
          publishedBrackets,
          previousPublishedBrackets: data?.previousPublishedBrackets ?? [],
          publicationRevision: revision + 1,
          savedBracketDraft: null,
          updatedAt: new Date().toISOString(),
        });
        transaction.set(ref, payload, { merge: true });
        const before = new Map<string, Match>((data?.publishedBrackets || []).flatMap((b: BracketDraft) => b.matches).map((match: Match) => [match.id, match]));
        for (const match of publishedBrackets.flatMap(b => b.matches)) {
          const prior = before.get(match.id);
          if (!prior) continue;
          const scheduleChanged = prior.scheduledDate !== match.scheduledDate || prior.scheduledTime !== match.scheduledTime;
          const resultChanged = match.status === 'completed' && (prior.status !== match.status || stableJson(prior.score) !== stableJson(match.score));
          const started = match.status === 'live' && prior.status !== 'live';
          if (!scheduleChanged && !resultChanged && !started) continue;
          transaction.set(doc(collection(db, 'arenaAnnouncements')), notificationRecord(scheduleChanged ? 'schedule' : resultChanged ? 'result' : 'live', scheduleChanged ? 'Match schedule updated' : resultChanged ? 'Match result published' : 'A match is live', `${match.team1?.name || 'TBD'} vs ${match.team2?.name || 'TBD'} · ${scheduleChanged ? `${match.scheduledDate}, ${match.scheduledTime}` : resultChanged ? `${match.score.team1Score}–${match.score.team2Score}` : match.roundName}`, scheduleChanged || resultChanged ? 'schedule' : 'current-live', match.id));
        }
      });
      this.publicationRevision = revision + 1;
    } finally {
      this.bracketWritePending = false;
    }
  }

  // --- Tournaments ---
  public getTournaments(): Tournament[] {
    return this.tournaments.filter(t => !isRetiredGame(t));
  }

  public getTournamentById(id: string): Tournament | undefined {
    return this.tournaments.find((t) => t.id === id);
  }

  // --- Matches ---
  public getMatches(): Match[] {
    return this.matches.filter(m => !isRetiredGame(m));
  }

  public getMatchById(id: string): Match | undefined {
    return this.matches.find((m) => m.id === id);
  }

  /**
   * Update match score. If instantAdvance is true, automatically updates winner and next match.
   * TODO: Wire up Firestore transaction:
   * await runTransaction(db, async (transaction) => { ... })
   */
  public updateMatchScore(
    matchId: string,
    team1Score: number,
    team2Score: number,
    instantAdvance: boolean = true,
    newStatus?: Match['status']
  ): void {
    const matchIndex = this.matches.findIndex((m) => m.id === matchId);
    if (matchIndex === -1) return;

    const currentMatch = this.matches[matchIndex];
    validateScore(currentMatch.matchFormat, team1Score, team2Score, newStatus === 'completed');
    const updatedMatch: Match = {
      ...currentMatch,
      score: {
        ...currentMatch.score,
        team1Score,
        team2Score,
      },
      status: newStatus || (currentMatch.status === 'completed' ? 'upcoming' : currentMatch.status),
      winnerId: undefined,
    };

    // Calculate winner if finished
    const targetWins = seriesWinsNeeded(currentMatch.matchFormat);
    if (team1Score >= targetWins) {
      updatedMatch.winnerId = updatedMatch.team1?.id;
      updatedMatch.status = 'completed';
    } else if (team2Score >= targetWins) {
      updatedMatch.winnerId = updatedMatch.team2?.id;
      updatedMatch.status = 'completed';
    }

    this.matches = instantAdvance
      ? updateMatchAndAdvance(this.matches, updatedMatch)
      : this.matches.map((match) => match.id === matchId ? updatedMatch : match);

    // Keep every saved/published copy aligned with the canonical match graph.
    const currentMatches = new Map(this.matches.map((match) => [match.id, match]));
    this.publishedBrackets = this.publishedBrackets.map((bracket) => ({
      ...bracket,
      matches: bracket.matches.map((match) => currentMatches.get(match.id) || match),
    }));
    if (this.savedBracketDraft) {
      this.savedBracketDraft = {
        ...this.savedBracketDraft,
        matches: this.savedBracketDraft.matches.map((match) => currentMatches.get(match.id) || match),
      };
    }

    // Add audit log
    this.addAuditLog('Score updated for match ' + updatedMatch.matchNumber);
    this.notify();
  }

  public addMatch(match: Match): void {
    this.matches.push(match);
    this.notify();
  }

  public updateMatchSchedules(updates: MatchScheduleUpdate[]): void {
    const schedules = new Map(updates.map(update => [update.id, update]));
    const current = new Map(this.matches.map(match => [match.id, match]));
    for (const { id } of updates) {
      const match = current.get(id);
      if (!match || match.status === 'live' || match.status === 'completed') {
        throw new Error('A selected match has started or is no longer available. Review the schedule again.');
      }
    }

    const updateMatch = (match: Match) => {
      const schedule = schedules.get(match.id);
      return schedule ? { ...match, scheduledDate: schedule.scheduledDate, scheduledTime: schedule.scheduledTime } : match;
    };
    this.matches = this.matches.map(updateMatch);
    this.publishedBrackets = this.publishedBrackets.map(bracket => ({
      ...bracket,
      matches: bracket.matches.map(updateMatch),
    }));
    if (this.savedBracketDraft) {
      this.savedBracketDraft = { ...this.savedBracketDraft, matches: this.savedBracketDraft.matches.map(updateMatch) };
    }
    this.addAuditLog(`Updated schedule for ${updates.length} matches`);
  }

  public updateMatchStream(matchId: string, streamUrl: string, setLive: boolean = true, streamTitle?: string): void {
    const match = this.matches.find((m) => m.id === matchId);
    if (match) {
      match.streamUrl = streamUrl;
      const platform=detectPlatform(streamUrl),watch=streamWatchUrl(streamUrl);
      if(platform!=='other' && watch)match.broadcastLinks=[...matchBroadcasts(match).filter(link=>link.platform!==platform).map(({platform,url})=>({platform,url})),{platform,url:watch}];
      if (streamTitle) match.streamTitle = streamTitle;
      if (setLive) {
        match.status = 'live';
      }
      this.updateBracketMatchCopies(matchId, (bracketMatch) => ({
        ...bracketMatch,
        streamUrl,
        ...(match.broadcastLinks?{broadcastLinks:match.broadcastLinks}:{}),
        ...(streamTitle ? { streamTitle } : {}),
        status: setLive ? 'live' : bracketMatch.status,
      }));
      this.addAuditLog(`Live stream connected to match ${match.matchNumber}`);
      this.notify();
    }
  }

  public removeMatchStream(matchId: string): void {
    const match = this.matches.find((m) => m.id === matchId);
    if (match) {
      delete match.streamUrl;
      delete match.broadcastLinks;
      this.updateBracketMatchCopies(matchId, (bracketMatch) => {
        const updated = { ...bracketMatch };
        delete updated.streamUrl;
        delete updated.broadcastLinks;
        return updated;
      });
      this.addAuditLog(`Live stream disconnected from match ${match.matchNumber}`);
      this.notify();
    }
  }

  /** Read the latest cloud bracket and change one match; parallel matches remain independent. */
  public async saveMatchBroadcastLinks(matchId:string,links:BroadcastLink[],primary?:BroadcastPlatform):Promise<void> {
    if(!isFirebaseConfigured || !auth.currentUser)throw new Error('Sign in as tournament staff to save broadcast links.');
    validateBroadcastLinks(links,primary);
    if(this.bracketWritePending)throw new Error('Another bracket update is in progress. Try again.');
    this.bracketWritePending=true;
    try {
      const result=await runTransaction(db,async tx=>{
        const ref=doc(db,'arenahub','brackets'),snapshot=await tx.get(ref);
        if(!snapshot.exists())throw new Error('Publish the bracket before saving broadcast links.');
        const data=snapshot.data();
        const publishedBrackets=updateBroadcastLinks(data.publishedBrackets || [],matchId,links,primary).map(publicBracket);
        const payload=this.serializeBracketPayload({...data,publishedBrackets,publicationRevision:(Number(data.publicationRevision)||0)+1,updatedAt:new Date().toISOString()});
        tx.set(ref,payload);return payload;
      });
      this.replaceLiveBrackets(result.publishedBrackets,result.savedBracketDraft || null);
      this.previousPublishedBrackets=result.previousPublishedBrackets || [];
      this.publicationRevision=result.publicationRevision;
      this.notify();
    } finally {this.bracketWritePending=false;}
  }

  public setMatchStatus(matchId: string, status: Match['status']): void {
    const match = this.matches.find((m) => m.id === matchId);
    if (match) {
      match.status = status;
      this.updateBracketMatchCopies(matchId, (bracketMatch) => ({ ...bracketMatch, status }));
      this.addAuditLog(`Match ${match.matchNumber} status updated to ${status}`);
      this.notify();
    }
  }

  private updateBracketMatchCopies(matchId: string, updater: (match: Match) => Match): void {
    this.publishedBrackets = this.publishedBrackets.map((bracket) => ({
      ...bracket,
      matches: bracket.matches.map((match) => match.id === matchId ? updater(match) : match),
    }));
    if (this.savedBracketDraft) {
      this.savedBracketDraft = {
        ...this.savedBracketDraft,
        matches: this.savedBracketDraft.matches.map((match) => match.id === matchId ? updater(match) : match),
      };
    }
  }

  // --- Saved & Published Brackets ---
  public getSavedBracketDraft(): BracketDraft | null {
    return this.getSavedBracketDrafts()[0] ?? null;
  }

  public getSavedBracketDrafts(): BracketDraft[] {
    const latest = this.savedBracketDraft;
    if (!latest || latest.status === 'published') return this.savedBracketDrafts;
    return [latest, ...this.savedBracketDrafts.filter(draft => draft.id !== latest.id)];
  }

  public saveBracketDraft(draft: BracketDraft): BracketDraft {
    const saved: BracketDraft = {
      ...draft,
      status: 'saved',
      createdAt: draft.createdAt || new Date().toLocaleDateString(),
    };
    this.savedBracketDrafts = this.getSavedBracketDrafts().filter(entry => entry.id !== saved.id);
    this.savedBracketDraft = saved;

    this.addAuditLog(`Saved bracket draft: "${saved.title}" (${saved.teamsCount} teams)`);
    return saved;
  }

  public deleteSavedBracketDraft(id: string): void {
    const drafts = this.getSavedBracketDrafts();
    const deleted = drafts.find(draft => draft.id === id);
    if (!deleted) return;
    const remaining = drafts.filter(draft => draft.id !== id);
    const latest = this.savedBracketDraft;
    const clearLatest = latest?.id === id && latest.status !== 'published';
    try {
      localStorage.setItem('arenahub_saved_bracket_drafts', JSON.stringify(remaining));
      if (clearLatest) localStorage.removeItem('arenahub_saved_bracket_draft');
    } catch {
      throw new Error('The draft could not be deleted from browser storage.');
    }
    this.savedBracketDrafts = remaining;
    if (clearLatest) this.savedBracketDraft = null;
    this.addAuditLog(`Deleted saved bracket draft: "${deleted.title}"`);
  }

  public getPublishedBrackets(): BracketDraft[] {
    return this.publishedBrackets.filter(b => !isRetiredGame(b));
  }

  public getPublishedBracketById(id: string): BracketDraft | undefined {
    return this.publishedBrackets.find((b) => b.id === id);
  }

  public getPublishedBracketByGame(gameName: string): BracketDraft | undefined {
    return this.publishedBrackets.find(
      (b) => b.gameName.toLowerCase() === gameName.toLowerCase()
    );
  }

  public getPreviousPublishedBrackets(): BracketDraft[] {
    return this.previousPublishedBrackets;
  }

  public publishBracket(draft: BracketDraft, gameName: string, gameId?: string): Promise<BracketDraft> {
    const published: BracketDraft = {
      ...draft,
      gameName,
      ...(gameId ? { gameId } : {}),
      matches: gameId && gameId !== 'game-custom'
        ? draft.matches.map(({ gameMode: _mode, ...match }) => ({
          ...match,
          gameId,
          ...(gameId === 'game-codm-mp' ? { gameMode: 'mp' as const } : {}),
          ...(gameId === 'game-codm-br' ? { gameMode: 'br' as const } : {}),
        }))
        : draft.matches,
      status: 'published',
      createdAt: new Date().toLocaleDateString(),
    };
    return this.commitPublication(published, gameName);
  }

  public restorePublishedBracket(previous: BracketDraft): Promise<BracketDraft> {
    return this.commitPublication(null, previous.gameName, previous);
  }

  private async commitPublication(next: BracketDraft | null, gameName: string, expectedPrevious?: BracketDraft): Promise<BracketDraft> {
    if (!isFirebaseConfigured || !auth.currentUser) throw new Error('Sign in to publish or restore brackets.');
    if (this.bracketWritePending) throw new Error('Another bracket update is in progress. Try again.');
    const ref = doc(db, 'arenahub', 'brackets');
    this.bracketWritePending = true;
    try {
      const result = await runTransaction(db, async transaction => {
        const data = (await transaction.get(ref)).data();
        const published: BracketDraft[] = Array.isArray(data?.publishedBrackets) ? data.publishedBrackets : [];
        const previous: BracketDraft[] = Array.isArray(data?.previousPublishedBrackets) ? data.previousPublishedBrackets : [];
        const restore = expectedPrevious && previous.find(bracket => publicationGameKey(bracket) === publicationGameKey(expectedPrevious));
        if (expectedPrevious && stableJson(restore) !== stableJson(expectedPrevious)) {
          throw new Error('The previous version changed. Reopen Bracket Studio before restoring.');
        }
        const incoming = next ?? restore;
        if (!incoming) throw new Error('There is no previous published version for this game.');
        const versions = replacePublishedBracket(published, previous, publicBracket(incoming));
        const revision = (Number(data?.publicationRevision) || 0) + 1;
        const payload = this.serializeBracketPayload({
          publishedBrackets: versions.published.map(publicBracket),
          previousPublishedBrackets: versions.previous.map(publicBracket),
          savedBracketDraft: null,
          publicationRevision: revision,
          updatedAt: new Date().toISOString(),
        });
        transaction.set(ref, payload, { merge: true });
        transaction.set(doc(collection(db, 'arenaAnnouncements')), notificationRecord('bracket', next ? 'Tournament bracket published' : 'Tournament bracket restored', `${incoming.gameName} · ${incoming.title}`, 'brackets', incoming.id));
        return {
          published: payload.publishedBrackets as BracketDraft[],
          previous: payload.previousPublishedBrackets as BracketDraft[],
          revision, incoming, oldCloudDraft: data?.savedBracketDraft || null,
        };
      });
      this.replaceLiveBrackets(result.published, result.oldCloudDraft);
      this.previousPublishedBrackets = result.previous;
      this.publicationRevision = result.revision;
      this.addAuditLog(`${next ? 'Published' : 'Restored'} bracket "${result.incoming.title}" (${gameName})`);
      return result.incoming;
    } finally {
      this.bracketWritePending = false;
    }
  }

  public deletePublishedBracket(bracketId: string): void {
    const bracket = this.publishedBrackets.find((b) => b.id === bracketId);
    this.publishedBrackets = this.publishedBrackets.filter((b) => b.id !== bracketId);
    if (bracket) {
      this.addAuditLog(`Unpublished bracket "${bracket.title}"`);
    }
    this.notify();
  }

  // --- Colleges & Teams ---
  public getColleges(): College[] {
    return this.colleges;
  }

  public getCollegeById(id: string): College | undefined {
    return this.colleges.find((c) => c.id === id);
  }

  public getTeams(): Team[] {
    return directoryTeams(this.teams,this.getPublishedBrackets());
  }

  public getTeamsByGame(gameId: string): Team[] {
    return this.getTeams().filter((t) => t.gameId === gameId);
  }

  // --- Users ---
  public getUsers(): User[] {
    return this.users;
  }

  public updateUserRole(userId: string, role: UserRole): void {
    const user = this.users.find((u) => u.id === userId);
    if (user) {
      user.role = role;
      this.addAuditLog(`Role of ${user.name} changed to ${role}`);
      this.notify();
    }
  }

  public async updateUserStatus(userId: string, status: UserStatus, durationText?: string): Promise<void> {
    if (!auth.currentUser) throw new Error('Sign in as an administrator.');
    if (auth.currentUser.uid === userId && status !== 'active') throw new Error('You cannot restrict your own administrator account.');
    const token = await auth.currentUser.getIdTokenResult();
    if (token.claims.admin !== true) throw new Error('Only a project administrator can change account status.');
    await updateDoc(doc(db, 'users', userId), { status });
    const user = this.users.find((u) => u.id === userId);
    if (user) {
      user.status = status;
      if (durationText) {
        user.suspendedUntil = durationText;
      } else {
        user.suspendedUntil = undefined;
      }
      this.addAuditLog(`${user.name} marked as ${status}`);
      this.notify();
    }
  }

  // --- Reports & Moderation ---
  public getReports(): ContentReport[] {
    return this.reports;
  }

  public async resolveReport(reportId: string, action: 'remove' | 'remove_and_ban' | 'dismiss'): Promise<void> {
    if (this.reports.some(report => report.id === reportId && report.shared)) { await resolveCommunityReport(reportId, action); return; }
    const rep = this.reports.find((r) => r.id === reportId);
    if (rep) {
      if (action === 'remove_and_ban') {
        const source = this.chatMessages.find(m => m.id === rep.sourceMessageId);
        if (!source) throw new Error('This sample report has no registered account attached. Use Remove or Dismiss.');
        await this.updateUserStatus(source.userId, 'banned');
      }
      rep.status = 'resolved';
      if (action !== 'dismiss' && rep.sourceMessageId) {
        this.chatMessages = this.chatMessages.map(m => m.id === rep.sourceMessageId ? { ...m, isMuted: true } : m);
      }
      if (action === 'remove_and_ban') {
        const offendingUser = this.users.find((u) => u.id === this.chatMessages.find(m => m.id === rep.sourceMessageId)?.userId);
        if (offendingUser) {
          offendingUser.status = 'banned';
        }
        this.addAuditLog(`Report ${rep.id} resolved: content removed & ${rep.postedBy} banned`);
      } else if (action === 'remove') {
        this.addAuditLog(`Report ${rep.id} resolved: content removed`);
      } else {
        this.addAuditLog(`Report ${rep.id} dismissed`);
      }
      this.notify();
    }
  }

  // --- Games & Categories ---
  public getGames(): GameTitle[] {
    return gameCatalog(this.games, INITIAL_GAMES);
  }

  public async addGame(game: GameTitle): Promise<void> {
    await this.mutateWorkspace(data => { if (data.games.some((g: GameTitle) => g.id === game.id || g.name.toLowerCase() === game.name.toLowerCase())) throw new Error('This game already exists.'); data.games.push(game); });
    this.addAuditLog(`Added new game title: ${game.name}`);
    this.notify();
  }

  public async removeGame(gameId: string): Promise<void> {
    const game = this.getGames().find((g) => g.id === gameId);
    await this.mutateWorkspace(data => { data.games = data.games.filter((g: GameTitle) => g.id !== gameId); });
    if (game) {
      this.addAuditLog(`Removed game title: ${game.name}`);
    }
    this.notify();
  }

  public async updateGame(updatedGame: GameTitle): Promise<void> {
    await this.mutateWorkspace(data => { data.games = data.games.map((g: GameTitle) => g.id === updatedGame.id ? updatedGame : g); });
    this.notify();
  }

  public getCategories(): string[] {
    return this.categories;
  }

  public async addCategory(cat: string): Promise<void> {
    await this.mutateWorkspace(data => { if (!data.categories.includes(cat.trim())) data.categories.push(cat.trim()); });
  }

  public async removeCategory(cat: string): Promise<void> {
    await this.mutateWorkspace(data => { data.categories = data.categories.filter((c: string) => c !== cat); });
  }

  // --- Featured ---
  public getFeaturedHighlights() {
    return this.featuredHighlights;
  }

  public getFeaturedPosts() {
    return this.featuredPosts;
  }

  public async toggleFeatureTournament(id: string): Promise<void> {
    await this.mutateWorkspace(data => { const t = data.tournaments.find((item: Tournament) => item.id === id); if (t) t.isFeatured = !t.isFeatured; });
    this.addAuditLog(`Updated tournament spotlight: ${id}`);
  }

  public async toggleFeatureHighlight(id: string): Promise<void> {
    await this.mutateWorkspace(data => { const h = data.featuredHighlights.find((item: any) => item.id === id); if (h) h.isFeatured = !h.isFeatured; });
    this.addAuditLog(`Updated highlight spotlight: ${id}`);
  }

  public async toggleFeaturePost(id: string): Promise<void> {
    await this.mutateWorkspace(data => { const p = data.featuredPosts.find((item: any) => item.id === id); if (p) p.isFeatured = !p.isFeatured; });
    this.addAuditLog(`Updated post spotlight: ${id}`);
  }

  // --- Chat Messages ---
  public getChatMessages(matchId: string): ChatMessage[] {
    return this.chatMessages.filter((m) => m.matchId === matchId && !m.isMuted);
  }

  public reportChatMessage(messageId: string, reporter: string): void {
    const message = this.chatMessages.find(item => item.id === messageId);
    if (!message) throw new Error('Message not found.');
    const existing = this.reports.find(report => report.sourceMessageId === messageId && report.status === 'open');
    if (existing) return;
    this.reports.unshift({ id: `report-${crypto.randomUUID()}`, type: 'HARASSMENT', contentType: 'Chat message', contentSnippet: message.text, reportedBy: reporter, postedBy: message.userName, timeAgo: 'Just now', flagCount: 1, status: 'open', sourceMessageId: messageId });
    this.notify();
  }

  public saveMatchPlayerStats(matchId: string, stats: NonNullable<Match['playerStats']>, gameNumber = '1', notes = ''): void {
    const match = this.matches.find(m => m.id === matchId);
    if (!match) throw new Error('Match not found.');
    match.playerStats = stats;
    match.statGames = { ...match.statGames, [gameNumber]: { playerStats: stats, notes } };
    this.updateBracketMatchCopies(matchId, m => ({ ...m, playerStats: stats, statGames: match.statGames }));
    this.addAuditLog(`Player stats saved for ${match.matchNumber}`);
    this.notify();
  }

  public sendChatMessage(msg: Omit<ChatMessage, 'id' | 'timestamp'>): void {
    const text = msg.text.trim();
    if (!text || text.length > 500) throw new Error('Messages must contain 1–500 characters.');
    const last = this.chatMessages.filter(m => m.userId === msg.userId).at(-1);
    if (last?.sentAt && Date.now() - last.sentAt < 3000) throw new Error('Wait a moment before sending another message.');
    const newMsg: ChatMessage = {
      sentAt: Date.now(),
      ...msg,
      text,
      id: `chat-${crypto.randomUUID()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.chatMessages.push(newMsg);
    this.notify();
  }

  // --- Audit Logs ---
  public getAuditLogs(): AuditLogItem[] {
    return this.auditLogs;
  }

  public addAuditLog(actionText: string, actor: string = auth.currentUser?.displayName || auth.currentUser?.email || 'Local organizer'): void {
    this.auditLogs.unshift({
      id: `audit-${Date.now()}`,
      actor,
      action: actionText,
      timestamp: 'Just now',
    });
    if (this.auditLogs.length > 20) this.auditLogs.pop();
    this.notify();
    const user = auth.currentUser;
    if (user) void user.getIdTokenResult().then(token => {
      if (token.claims.admin !== true && !['admin', 'organizer', 'school-admin', 'moderator'].includes(String(token.claims.role))) return;
      return addDoc(collection(db, 'auditEvents'), { actorId: user.uid, action: actionText.slice(0, 1500), createdAt: serverTimestamp() });
    }).catch(() => { this.sharedError = 'The change completed, but its shared activity entry could not be saved.'; this.listeners.forEach(l => l()); });
  }
}

export const firestoreService = new FirestoreService();
