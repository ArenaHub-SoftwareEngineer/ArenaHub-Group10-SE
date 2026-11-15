// Groq's OpenAI-compatible chat completions API, used when Gemini fails or is over quota.
// Plain fetch; no SDK. Streaming tool calls arrive in pieces and are reassembled by index.
import { MAX_TOOL_ROUNDS, readSse, runTool, toolOutput, type Provider } from './provider.ts';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export function groqProvider(apiKey: string, model: string, fetcher: typeof fetch = fetch): Provider {
  const call = (body: object, signal: AbortSignal) => fetcher(ENDPOINT, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, ...body }), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  return {
    id: 'groq',
    model,
    async *stream(request) {
      const messages: any[] = [
        { role: 'system', content: request.system },
        ...request.history.map(item => ({ role: item.role, content: item.text })),
        { role: 'user', content: request.question },
      ];
      const tools = request.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const last = round === MAX_TOOL_ROUNDS - 1;
        const response = await call({ messages, stream: true, max_completion_tokens: request.maxOutputTokens, ...(tools.length ? { tools, tool_choice: last ? 'none' : 'auto' } : {}) }, request.signal);
        if (!response.ok || !response.body) throw new Error(`Groq returned ${response.status}.`);
        let text = '';
        const calls: Array<{ id: string; name: string; args: string }> = [];
        for await (const data of readSse(response.body, request.signal)) {
          if (data === '[DONE]') break;
          let delta: any;
          try { delta = JSON.parse(data).choices?.[0]?.delta; } catch { continue; }
          if (typeof delta?.content === 'string' && delta.content) { text += delta.content; yield delta.content; }
          for (const piece of delta?.tool_calls || []) {
            const slot = calls[piece.index ?? 0] ||= { id: '', name: '', args: '' };
            if (piece.id) slot.id = piece.id;
            if (piece.function?.name) slot.name += piece.function.name;
            if (piece.function?.arguments) slot.args += piece.function.arguments;
          }
        }
        const made = calls.filter(Boolean);
        if (!made.length) return;
        messages.push({ role: 'assistant', content: text || null, tool_calls: made.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
        for (const c of made) {
          let args: unknown = {};
          try { args = JSON.parse(c.args || '{}'); } catch { /* the tool rejects invalid arguments */ }
          messages.push({ role: 'tool', tool_call_id: c.id, content: toolOutput(await runTool(request.tools, c.name, args)) });
        }
      }
    },
    async json(request) {
      const response = await call({ messages: [{ role: 'system', content: `${request.system}\nReturn only a JSON object with these fields: ${JSON.stringify(request.schema)}` }, { role: 'user', content: request.prompt }], response_format: { type: 'json_object' }, max_completion_tokens: 2000 }, request.signal);
      if (!response.ok) throw new Error(`Groq returned ${response.status}.`);
      return JSON.parse((await response.json() as any).choices?.[0]?.message?.content || 'null');
    },
  };
}
