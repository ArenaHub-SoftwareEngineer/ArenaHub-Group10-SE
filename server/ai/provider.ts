// The model interface. A provider streams text deltas and runs the tool loop itself, because each API
// shapes tool calls differently. The pipeline (index.ts) decides which provider runs and when to fall back.
import type { Tool } from './tools.ts';

export interface ProviderRequest {
  system: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  question: string;
  tools: Tool[];
  signal: AbortSignal;
  maxOutputTokens: number;
}
export interface JsonRequest { system: string; prompt: string; schema: Record<string, unknown>; signal: AbortSignal }

export interface Provider {
  id: 'gemini' | 'groq' | 'fake' | 'mock';
  stream(request: ProviderRequest): AsyncGenerator<string>;
  json(request: JsonRequest): Promise<unknown>;
}

/** Model calls per question, including tool rounds. The last round must answer in text. */
export const MAX_TOOL_ROUNDS = 4;
/** Tool output sent back to the model is capped so one large bracket cannot exhaust the context. */
export const toolOutput = (data: unknown) => {
  const text = JSON.stringify(data ?? null);
  return text.length > 12_000 ? JSON.stringify({ truncated: true, partial: text.slice(0, 11_900) }) : text;
};

export async function runTool(tools: Tool[], name: string | undefined, args: unknown) {
  const tool = tools.find(t => t.name === name);
  return tool ? (await tool.run(args)).data : { error: 'Unknown tool.' };
}

/** Server-sent events from a fetch body: yields each `data:` payload. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (line.startsWith('data:')) yield line.slice(5).trimStart();
      }
    }
    if (buffer.startsWith('data:')) yield buffer.slice(5).trimStart();
  } finally { reader.releaseLock(); }
}
