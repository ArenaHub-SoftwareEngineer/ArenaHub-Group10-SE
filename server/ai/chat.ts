// Arena AI in a match's live chat. A viewer's "@Arena ..." message is already posted by the browser;
// this answers it in the chat, as "Arena AI" with isAI: true, through firebase-admin (the rules let no
// client write either). Context is this one match only. Replies are at most 280 characters.
// Budgets: one question per viewer per interval, and a per-match model budget; beyond it, the reply is
// built from the match record without a model. Identical questions on the same data share one reply.
import type { App } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Caller } from '../auth.ts';
import type { PublishedData } from '../data.ts';
import { AnswerCache, normalizeQuestion } from './cache.ts';
import type { AiConfig } from './config.ts';
import { screenQuestion, type RateStore } from './guard.ts';
import { chatPrompt } from './prompt.ts';
import { runTool, type Provider } from './provider.ts';
import { cleanReply } from './sanitize.ts';
import { buildTools } from './tools.ts';

export const CHAT_REPLY_MAX = 280;
export class ChatAskError extends Error { constructor(readonly status: 400 | 403 | 404 | 409 | 429 | 503, message: string) { super(message); } }

/** Where replies go. Firestore through firebase-admin in production; a list in tests. */
export interface ChatSink {
  aiEnabled(matchId: string): Promise<boolean>;
  mutedUntil(matchId: string, uid: string): Promise<number>;
  post(matchId: string, text: string): Promise<string>;
}

export function firestoreChatSink(app: App): ChatSink {
  const db = getFirestore(app);
  return {
    async aiEnabled(matchId) { return (await db.doc(`matchChat/${matchId}`).get()).get('aiEnabled') !== false; },
    async mutedUntil(matchId, uid) { return (await db.doc(`matchChat/${matchId}/mutes/${uid}`).get()).get('until')?.toMillis?.() || 0; },
    async post(matchId, text) {
      const ref = await db.collection(`matchChat/${matchId}/messages`).add({ author: 'Arena AI', text, isAI: true, createdAt: FieldValue.serverTimestamp() });
      return ref.id;
    },
  };
}

/** The reply when no model runs: the match record in one line. */
export function recordReply(match: any): string {
  if (!match) return 'I could not find this match in the published records.';
  if (match.lobby) {
    return match.status === 'completed' ? `${match.round} is final${match.lobby.winner ? `: ${match.lobby.winner} placed first` : ''}.`
      : match.status === 'live' ? `${match.round} is in progress with ${match.lobby.squads} squads. Standings update when results are entered.`
      : `${match.round} has not started yet${match.date ? `; it is set for ${match.date}${match.time ? ` at ${match.time}` : ''}` : ''}.`;
  }
  const teams = `${match.team1?.name || 'To be decided'} vs ${match.team2?.name || 'To be decided'}`;
  if (match.status === 'live') return `${teams}: ${match.score ?? 'no score yet'}, live and not final (${match.series}).`;
  if (match.status === 'completed') return `${teams} ended ${match.score ?? 'with no recorded score'}${match.winner ? `; ${match.winner} won` : ''}.`;
  return `${teams} has not started${match.date ? `; it is set for ${match.date}${match.time ? ` at ${match.time}` : ''}` : ''}.`;
}

export interface ChatDeps {
  providers: Provider[];
  config: Pick<AiConfig, 'chatUserIntervalSec' | 'chatMatchPerMinute'>;
  rate: RateStore;
  sink: ChatSink;
  cache?: AnswerCache<{ text: string; source: string }>;
  log?: (message: string) => void;
}

export function createChatResponder(deps: ChatDeps) {
  const cache = deps.cache || new AnswerCache<{ text: string; source: string }>(120_000);
  const log = deps.log || ((message: string) => console.warn(`[Arena AI chat] ${message}`));

  return async function answer(input: { caller: Caller; matchId: string; question: string; data: PublishedData; signal: AbortSignal }) {
    const { caller, matchId, question, data, signal } = input;
    if (!caller.campus) throw new ChatAskError(403, 'Posting in chat is for verified campus accounts.');
    if (!await deps.sink.aiEnabled(matchId)) throw new ChatAskError(409, 'Staff turned Arena AI off in this chat.');
    if (await deps.sink.mutedUntil(matchId, caller.uid) > Date.now()) throw new ChatAskError(403, 'You are muted in this chat.');
    const tools = buildTools({ brackets: data.brackets, checkedAt: data.checkedAt, staff: false });
    const found = await runTool(tools, 'getMatch', { matchId }) as any;
    if (!found || found.error) throw new ChatAskError(404, 'Arena AI answers only in chats of published matches.');
    if (!await deps.rate.hit(`chat_${caller.uid}`, 1, deps.config.chatUserIntervalSec)) {
      throw new ChatAskError(429, `Arena AI answers one question per viewer every ${deps.config.chatUserIntervalSec} seconds.`);
    }

    let reply: { text: string; source: string };
    const screen = screenQuestion(question);
    const key = `${matchId}|${data.revision}|${normalizeQuestion(question)}`;
    if (screen.kind === 'refuse') reply = { text: screen.text, source: 'Arena AI' };
    else {
      const hit = cache.get(key);
      if (hit) reply = hit;
      else {
        reply = { text: recordReply(found.match), source: 'Live records' };
        // Only this match goes to the model: teams, score, schedule, timeline and MVP by in-game name.
        const context = { tournament: found.tournament, game: found.game, ...found.match, timeline: found.timeline?.slice(-10) || [], mvp: found.mvp };
        if (deps.providers.length && await deps.rate.hit(`chatmatch_${matchId}`, deps.config.chatMatchPerMinute, 60)) {
          for (const [index, provider] of deps.providers.entries()) {
            try {
              let text = '';
              for await (const delta of provider.stream({ system: chatPrompt(), history: [], question: `Match data: ${JSON.stringify(context)}\n\nQuestion: ${question}`, tools: [], signal, maxOutputTokens: 200 })) {
                text += delta;
                if (text.length > CHAT_REPLY_MAX * 2) break;
              }
              const clean = cleanReply(text.replace(/\s*\n+\s*/g, ' '), CHAT_REPLY_MAX);
              if (clean) { reply = { text: clean, source: index > 0 || provider.id === 'groq' ? 'Arena AI (backup model)' : 'Arena AI' }; break; }
            } catch (error) {
              if (signal.aborted) throw error;
              log(`${provider.id} failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`);
            }
          }
        }
        cache.set(key, reply);
      }
    }
    const id = await deps.sink.post(matchId, cleanReply(reply.text, CHAT_REPLY_MAX));
    return { id, source: reply.source };
  };
}
