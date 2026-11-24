// Scripted provider for browser tests on the demo-arenahub emulators (ARENA_AI_PROVIDER=fake).
// It uses the real tools, so a test sees real records flow through the real pipeline and streaming,
// without a network call or an API key. aiConfig() refuses it for any other project.
import { parseBracketPromptLocally } from '../../src/lib/bracketRequest.ts';
import { runTool, type Provider } from './provider.ts';

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

function words(text: string) { return text.match(/\S+\s*/g) || []; }

export function fakeProvider(): Provider {
  return {
    id: 'fake',
    async *stream(request) {
      let reply: string;
      const chat = request.question.match(/^Match data: (.+)\n\nQuestion: /s);
      const digest = request.question.match(/^Case digest:\n([\s\S]+)$/);
      if (digest) {
        const field = (name: string) => digest[1].match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1] || 'not recorded';
        reply = `A ${field('Concern').toLowerCase()} report about ${field('Match')} is ${field('Status')}. Evidence: ${field('Evidence')}. ${field('Decision')}`;
      } else if (chat) {
        const m = JSON.parse(chat[1]);
        reply = m.score ? `${m.team1?.name} ${m.score} ${m.team2?.name}${m.status === 'live' ? ', live and not final.' : '.'}` : `${m.team1?.name || 'This match'} vs ${m.team2?.name || 'opponent'}: no score is recorded yet.`;
      } else if (/score|live|winning|next|schedule|plays/i.test(request.question) && request.thinkingBudget) {
        // Thinking modes: a scripted reasoning summary and the real tools, so the browser tests see the thinking panel and cards.
        request.onThought?.('The viewer wants the current state of play. Live scores are not final, so I should check the live matches and say that.');
        await pause(900, request.signal);
        const live = await runTool(request.tools, 'getLiveMatches', {}) as any[];
        const next = await runTool(request.tools, 'getSchedule', {}) as any;
        request.onUsage?.(1800);
        reply = live.length ? `Live now: ${live.map(m => `${m.team1?.name} vs ${m.team2?.name}, ${m.score ?? 'no score yet'} (not final)`).join('; ')}.` : 'No match is live right now.';
        if (next?.matches?.length) reply += ` ${next.matches.length} match${next.matches.length === 1 ? ' is' : 'es are'} scheduled next.`;
      } else if (/score|live/i.test(request.question)) {
        const live = await runTool(request.tools, 'getLiveMatches', {}) as any[];
        reply = live.length ? `Live now: ${live.map(m => `${m.team1?.name} vs ${m.team2?.name}, ${m.score ?? 'no score yet'} (not final)`).join('; ')}.` : 'No match is live right now.';
      } else {
        const list = await runTool(request.tools, 'listTournaments', {}) as any[];
        reply = list.length ? `Published tournaments: ${list.map(t => `${t.title} (${t.game})`).join(', ')}.` : 'No tournament is published yet.';
      }
      for (const word of words(reply)) { await pause(15, request.signal); yield word; }
    },
    async json(request) {
      return parseBracketPromptLocally(request.prompt);
    },
  };
}
