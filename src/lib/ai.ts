/**
 * ArenaHub assistant: secure provider proxy and local tournament guide.
 *
 * The browser sends authorized queries to the server; provider keys stay server-side.
 *
 * Scope policy: strictly refuses questions outside the ArenaHub / WMSU Palaro domain.
 */

import { auth } from './firebase';
import { firestoreService } from './firestore';
import { AIParsedBracketParams, BracketDraft, Match, Team, MatchFormat, ExtractedTeam } from "./types";
import { INITIAL_TEAMS, INITIAL_COLLEGES } from "./mockData";
import {
  extractTeamsFromPrompt,
  extractTournamentTitle,
  createBracketFromTeams,
  detectTournamentSizeFromPrompt,
} from "./bracketUtils";

// Types
export interface AIResponse {
  type: "bracket_draft" | "text_answer" | "refusal" | "streaming";
  text: string;
  groundedIn?: string;
  parsedParams?: AIParsedBracketParams;
  bracketDraft?: BracketDraft;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  source?: string;
}

class AIService {


  private isOnline: boolean = true;

  public setOnlineStatus(online: boolean): void {
    this.isOnline = online;
  }

  public isProviderOnline(): boolean {
    return this.isOnline;
  }

  private async onlineAnswer(query: string, history: Array<{ role: 'user' | 'assistant'; text: string }> = [], signal?: AbortSignal): Promise<string | null> {
    if (!this.isOnline) return null;
    try {
      let token = 'local-dev-token';
      if (auth.currentUser) {
        try { token = await auth.currentUser.getIdToken(); } catch {}
      }
      const published = firestoreService.getPublishedBrackets();
      const allMatches = firestoreService.getMatches();
      const teams = firestoreService.getTeams();
      const colleges = firestoreService.getColleges();

      const reference = JSON.stringify({
        scope: 'Real-time ArenaHub WMSU Palaro live tournament database',
        publishedBrackets: published.map(b => ({
          id: b.id,
          title: b.title,
          game: b.gameName,
          gameId: b.gameId,
          format: b.format,
          matchFormat: b.matchFormat,
          teamsCount: b.teamsCount,
          teams: b.teams.map(t => (typeof t === 'string' ? t : t?.name || t?.id)),
          matches: (b.matches || []).map(m => ({
            id: m.id,
            matchNumber: m.matchNumber,
            roundName: m.roundName,
            team1: m.team1?.name || 'TBD',
            team1College: m.team1?.collegeCode || '',
            team2: m.team2?.name || 'TBD',
            team2College: m.team2?.collegeCode || '',
            score: `${m.score?.team1Score ?? 0}–${m.score?.team2Score ?? 0}`,
            status: m.status,
            streamTitle: m.streamTitle,
            scheduledDate: m.scheduledDate,
            scheduledTime: m.scheduledTime,
          })),
        })),
        liveMatches: allMatches
          .filter(m => m.status === 'live')
          .map(m => ({
            matchNumber: m.matchNumber,
            gameId: m.gameId,
            team1: m.team1?.name,
            team2: m.team2?.name,
            score: `${m.score?.team1Score ?? 0}–${m.score?.team2Score ?? 0}`,
            streamTitle: m.streamTitle,
            status: m.status,
          })),
        upcomingMatches: allMatches
          .filter(m => m.status === 'upcoming' || m.status === 'pre-match')
          .slice(0, 10)
          .map(m => ({
            matchNumber: m.matchNumber,
            gameId: m.gameId,
            roundName: m.roundName,
            team1: m.team1?.name,
            team2: m.team2?.name,
            scheduledDate: m.scheduledDate,
            scheduledTime: m.scheduledTime,
          })),
        colleges: colleges.map(c => ({
          code: c.code,
          name: c.name,
          stats: c.stats,
        })),
        teams: teams.filter(t => !t.isBye).map(t => ({
          name: t.name,
          collegeCode: t.collegeCode,
          gameId: t.gameId,
          players: t.players.map(p => `${p.ign} (${p.role || 'Player'})`),
        })),
      });

      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, context: reference, history }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      if (!response.ok) return null;
      const result = await response.json();
      return typeof result.text === 'string' ? result.text : null;
    } catch {
      if (signal?.aborted) throw new Error('Response stopped.');
      return null;
    }
  }

  public async *streamAnswer(query: string, history: Array<{ role: 'user' | 'assistant'; text: string }> = [], signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    if (signal?.aborted) throw new Error('Response stopped.');
    const online = await this.onlineAnswer(query, history, signal);
    if (signal?.aborted) throw new Error('Response stopped.');
    const answer = online || (await this.localFallback(query)).text;
    yield { delta: answer, done: true, source: online ? 'Arena AI (Gemini 3.8 Flash)' : 'Arena AI (Live Engine)' };
  }

  public async answerQuery(query: string): Promise<AIResponse> {
    const text = await this.onlineAnswer(query);
    return text ? { type: 'text_answer', text, groundedIn: 'Loaded ArenaHub tournament records' } : this.localFallback(query);
  }

  private async localFallback(query: string): Promise<AIResponse> {
    const q = query.trim().toLowerCase();
    const answer = (text: string): AIResponse => ({ type: 'text_answer', text, groundedIn: 'Loaded ArenaHub live tournament records' });

    if (/weather|recipe|bitcoin|politic|write an essay|capital of|python script/.test(q)) {
      return { type: 'refusal', text: 'I am Arena AI, your campus esports assistant. I specialize in ArenaHub tournaments, live matches, published brackets, college rosters, and fair play. How can I help with your campus tournament?' };
    }

    if (/cheat|fair.?play|evidence|report/.test(q)) {
      return answer('Open Fair play to check loaded rosters or submit match evidence. Use a verified account, choose the match, and include a replay timestamp and evidence link. Authorized organizers review reports.');
    }

    const publishedBrackets = firestoreService.getPublishedBrackets();
    const liveMatches = firestoreService.getMatches().filter(m => m.status === 'live');
    const upcomingMatches = firestoreService.getMatches().filter(m => !m.team2?.isBye && (m.status === 'upcoming' || m.status === 'pre-match'));
    const allTeams = firestoreService.getTeams().filter(t => !t.isBye);

    // Specific or General Bracket queries (e.g. "what is the bracket for mlbb", "bracket", "tournament tree")
    if (/bracket|tree|seed|round|format|quarterfinal|semifinal|mlbb|mobile legends|valorant|dota|codm|league/.test(q)) {
      let filtered = publishedBrackets;
      let gameNameFilter = '';

      if (q.includes('mlbb') || q.includes('mobile legends')) {
        filtered = publishedBrackets.filter(b => b.gameName.toLowerCase().includes('mobile') || b.gameId?.includes('mlbb'));
        gameNameFilter = 'Mobile Legends: Bang Bang';
      } else if (q.includes('val') || q.includes('valorant')) {
        filtered = publishedBrackets.filter(b => b.gameName.toLowerCase().includes('val') || b.gameId?.includes('val'));
        gameNameFilter = 'Valorant';
      } else if (q.includes('dota')) {
        filtered = publishedBrackets.filter(b => b.gameName.toLowerCase().includes('dota') || b.gameId?.includes('dota'));
        gameNameFilter = 'Dota 2';
      } else if (q.includes('codm') || q.includes('call of duty')) {
        filtered = publishedBrackets.filter(b => b.gameName.toLowerCase().includes('codm') || b.gameId?.includes('codm'));
        gameNameFilter = 'CODM';
      } else if (q.includes('league') || q.includes('lol')) {
        filtered = publishedBrackets.filter(b => b.gameName.toLowerCase().includes('league') || b.gameId?.includes('lol'));
        gameNameFilter = 'League of Legends';
      }

      if (filtered.length > 0) {
        const sections = filtered.map(b => {
          const teamNames = b.teams.map(t => typeof t === 'string' ? t : t?.name || t?.id).join(', ');
          const matchesList = (b.matches || []).slice(0, 10).map(m => {
            const t1 = m.team1?.name || 'TBD';
            const t2 = m.team2?.name || 'TBD';
            const statusLabel = m.status === 'live' ? '🔴 LIVE' : m.status === 'completed' ? 'Final' : 'Upcoming';
            const scoreLabel = `${m.score?.team1Score ?? 0}–${m.score?.team2Score ?? 0}`;
            const timeInfo = m.scheduledTime ? ` · ${m.scheduledTime}` : '';
            return `  • [${m.roundName}] ${m.matchNumber}: ${t1} vs ${t2} (${scoreLabel}) · ${statusLabel}${timeInfo}`;
          }).join('\n');

          return `🏆 **${b.title}** (${b.gameName})\n` +
                 `• **Format**: ${b.format} (${b.matchFormat}) · ${b.teamsCount} teams\n` +
                 `• **Enrolled Teams**: ${teamNames || 'Roster enrolled'}\n` +
                 `• **Matchups & Bracket Schedule**:\n${matchesList || '  (Schedule will appear when matches commence)'}`;
        });

        return answer(`Here are the published brackets currently active in ArenaHub:\n\n` + sections.join('\n\n') +
          `\n\n💡 *Tip: Organizers can publish or edit brackets in real time via the Admin Bracket Studio.*`);
      }

      if (gameNameFilter) {
        return answer(`No official bracket has been published yet specifically for **${gameNameFilter}**. \n\n` +
          (publishedBrackets.length
            ? `However, the following brackets are published and active in the arena:\n` +
              publishedBrackets.map(b => `• **${b.title}**: ${b.gameName} (${b.teamsCount} teams, ${b.format})`).join('\n')
            : `Open **Brackets** in the navigation to view the tournament schedule, or wait for the organizer to publish the bracket.`));
      }
    }

    // Schedule / Who plays next / Match queries
    if (/match|schedule|today|next|when|result|score|tonight|who plays/.test(q)) {
      const parts: string[] = [];

      if (liveMatches.length > 0) {
        parts.push(`🔴 **LIVE NOW ON STAGE:**`);
        liveMatches.forEach(m => {
          parts.push(`• **${m.matchNumber} (${m.roundName})**: ${m.team1?.name || 'TBD'} vs ${m.team2?.name || 'TBD'} · Score: ${m.score.team1Score}–${m.score.team2Score}${m.streamTitle ? ` [${m.streamTitle}]` : ''}`);
        });
      }

      if (upcomingMatches.length > 0) {
        parts.push(`\n⏳ **UPCOMING MATCHES:**`);
        upcomingMatches.slice(0, 6).forEach(m => {
          const time = m.scheduledTime ? `${m.scheduledDate || 'Today'} ${m.scheduledTime}` : 'Schedule TBA';
          parts.push(`• **${m.matchNumber} (${m.roundName})**: ${m.team1?.name || 'TBD'} vs ${m.team2?.name || 'TBD'} · ${time}`);
        });
      }

      if (parts.length > 0) {
        return answer(parts.join('\n'));
      }
    }

    // Teams / Rosters / Players
    if (/roster|player|team|lineup|plays|who is/.test(q)) {
      const matchedTeams = allTeams.filter(t =>
        q.includes(t.name.toLowerCase()) ||
        q.includes(t.collegeCode.toLowerCase()) ||
        (t.collegeCode && q.includes(t.collegeCode.toLowerCase()))
      );

      if (matchedTeams.length > 0) {
        const text = matchedTeams.slice(0, 4).map(t => {
          const players = t.players.map(p => `${p.ign} (${p.role || 'Member'})`).join(', ');
          return `🛡️ **${t.name}** [${t.collegeCode}] — Seed #${t.seed}\n• Roster: ${players}\n• Win Rate: ${(t.winRate * 100).toFixed(0)}% (Record: ${t.record})`;
        }).join('\n\n');
        return answer(`Here are the matching team rosters from our tournament database:\n\n${text}`);
      }

      // If general team question, summarize colleges and top teams
      const colleges = firestoreService.getColleges();
      const summary = colleges.map(c => `• **${c.code}** (${c.name}): ${c.teamsCount} rosters registered · ${c.stats.wins}W - ${c.stats.losses}L`).join('\n');
      return answer(`Here are the participating colleges and teams in ArenaHub:\n\n${summary}\n\n💡 *Select **Teams** in the sidebar to view full player cards and career highs.*`);
    }

    // Standings
    if (/standing|leads|leader|winning|rank|points/.test(q)) {
      const colleges = [...firestoreService.getColleges()].sort((a,b) => b.stats.wins - a.stats.wins);
      const rows = colleges.map((c, i) => `${i + 1}. **${c.code}** (${c.name}): ${c.stats.wins} Wins, ${c.stats.losses} Losses [${c.stats.status || 'Active'}]`).join('\n');
      return answer(`🏆 **Current Campus Standings (WMSU Palaro):**\n\n${rows}`);
    }

    return answer('Welcome to ArenaHub! I am your real-time tournament intelligence assistant.\n\n' +
      'You can ask me:\n' +
      '• *"What is the bracket for MLBB?"* (inspects current published brackets and live matches)\n' +
      '• *"Who plays next?"* (shows live streams and upcoming matches)\n' +
      '• *"Tell me about the teams"* (shows rosters, players, and colleges)\n' +
      '• *"What are the current standings?"* (ranks colleges by victories)');
  }

  public parseBracketPrompt(prompt: string): AIParsedBracketParams {
    const p = prompt.toLowerCase();
    let game = "Mobile Legends";
    if (p.includes("valorant") || p.includes("val")) game = "Valorant";
    else if (p.includes("league") || p.includes("lol"))
      game = "League of Legends";
    else if (/\bdota\s*2\b/.test(p)) game = "Dota 2";
    else if (/\bcodm\b|call of duty/.test(p)) {
      if (/battle royale|\bbr\b/.test(p)) throw new Error('CODM Battle Royale uses placement scoring. Use a head-to-head game for this bracket.');
      game = "Call of Duty: Mobile Multiplayer";
    }
    else if (p.includes("tekken")) game = "Tekken 8";

    let format = "Single elimination";
    if (p.includes("double") || p.includes("double elim"))
      format = "Double elimination";
    else if (p.includes("round robin") || p.includes("groups"))
      format = "Round robin";

    let seeding = "Win rate";
    if (
      p.includes("skill rating") ||
      p.includes("rating") ||
      p.includes("elo")
    )
      seeding = "Skill rating";
    else if (p.includes("random") || p.includes("draw"))
      seeding = "Random draw";

    let constraint = "None";
    if (
      p.includes("same college apart") ||
      p.includes("same-college") ||
      p.includes("college apart")
    ) {
      constraint = "same-college squads apart in round 1";
    }

    const final = p.match(/\b(?:grand )?final(?:s)?(?: (?:is|as|to|uses))?\s+(?:bo|best[- ]of[- ]?)([1357])\b|\b(?:bo|best[- ]of[- ]?)([1357])\s+(?:grand )?final(?:s)?\b/);
    const series = (final ? p.replace(final[0], '') : p).match(/\b(?:bo|best[- ]of[- ]?)([1357])\b/);
    const matchFormat = series ? `Bo${series[1]}` as MatchFormat : 'Bo3';
    const finalMatchFormat = final ? `Bo${final[1] || final[2]}` as MatchFormat : undefined;

    const detectedSize = detectTournamentSizeFromPrompt(prompt, 0);
    const teamsCount = detectedSize >= 2 ? detectedSize : 8;

    return { game, format, seeding, constraint, teamsCount, matchFormat, finalMatchFormat };
  }

  public async generateBracketFromPrompt(
    prompt: string
  ): Promise<{
    draft: BracketDraft;
    explanation: string;
  }> {
    // The tested local parser constructs brackets without exposing provider keys.
    // Deterministic fallback
    const parsed = this.parseBracketPrompt(prompt);
    const extractedTeams = extractTeamsFromPrompt(prompt);
    const title = extractTournamentTitle(prompt, `${parsed.game} - ${parsed.format}`);
    const detectedSize = detectTournamentSizeFromPrompt(prompt, extractedTeams.length || parsed.teamsCount);

    const draft = createBracketFromTeams({
      title,
      teams: extractedTeams,
      gameName: parsed.game,
      format: parsed.format,
      matchFormat: (parsed.matchFormat as MatchFormat) || "Bo3",
      finalMatchFormat: parsed.finalMatchFormat,
      seedingRule: parsed.seeding,
      explicitBracketSize: detectedSize,
    });

    return {
      draft,
      explanation: `Generated a ${draft.teamsCount}-team ${draft.format} bracket accommodating all participants with standard competitive pairings.`,
    };
  }

  public generateBracketDraft(prompt: string): BracketDraft {
    const parsed = this.parseBracketPrompt(prompt);
    const extractedTeams = extractTeamsFromPrompt(prompt);
    const title = extractTournamentTitle(prompt, `${parsed.game} - ${parsed.format}`);
    const detectedSize = detectTournamentSizeFromPrompt(prompt, extractedTeams.length || parsed.teamsCount);

    return createBracketFromTeams({
      title,
      teams: extractedTeams,
      gameName: parsed.game,
      format: parsed.format,
      matchFormat: (parsed.matchFormat as MatchFormat) || 'Bo3',
      finalMatchFormat: parsed.finalMatchFormat,
      seedingRule: parsed.seeding,
      explicitBracketSize: detectedSize,
    });
  }
}

export const aiService = new AIService();
