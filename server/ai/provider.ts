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
  /** Thinking tokens per model call; 0 or absent turns thinking off where the model allows it. */
  thinkingBudget?: number;
  /** The model's own summary of its reasoning, as the API returns it. Shown to the viewer, never fact-checked as an answer. */
  onThought?(text: string): void;
  /** Tokens the API reports for one model call (prompt, output, thinking and tool results). Called once per call. */
  onUsage?(tokens: number): void;
}
export interface JsonRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
}

export interface Provider {
  id: 'gemini' | 'groq' | 'fake' | 'mock';
  /** The model name, for the cooldown key and logs. Never shown to viewers. */
  model?: string;
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

/**
 * One provider attempt: aborts with the viewer's request, or when the model has written no text within
 * firstTokenMs (tool rounds included), so a hung model falls through to the next one instead of making
 * a student wait out the HTTP timeout. Call gotText() on the first text and done() when finished.
 */
export function attemptSignal(parent: AbortSignal, firstTokenMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent.reason);
  if (parent.aborted) onAbort(); else parent.addEventListener('abort', onAbort, { once: true });
  const expire = () => setTimeout(() => controller.abort(new Error(`no reply within ${firstTokenMs} ms`)), firstTokenMs);
  let timer: ReturnType<typeof setTimeout> | undefined = expire();
  return {
    signal: controller.signal,
    gotText: () => { clearTimeout(timer); timer = undefined; },
    /** The model is working (a thought, a tool call): restart the silence timer until text arrives. */
    alive: () => { if (timer !== undefined) { clearTimeout(timer); timer = expire(); } },
    done: () => { clearTimeout(timer); parent.removeEventListener('abort', onAbort); },
  };
}

/**
 * Benches a model that is over quota (429) or silent, so the next questions go straight to the next
 * model instead of waiting on it again. Shared by the assistant page and live chat in this process.
 */
export class Cooldown {
  private until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  private key = (p: Provider) => `${p.id}:${p.model || ''}`;
  active(p: Provider) { return (this.until.get(this.key(p)) || 0) > this.now(); }
  /** Records a failure; returns how long the model is benched (0 when the error is not one that repeats). */
  failed(p: Provider, error: unknown) {
    const text = error instanceof Error ? `${(error as { status?: number }).status ?? ''} ${error.message}` : String(error);
    const ms = /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(text) ? 60_000 : /no reply within|DEADLINE_EXCEEDED|\b504\b|\b503\b|UNAVAILABLE|overloaded/i.test(text) ? 30_000 : 0;
    if (ms) this.until.set(this.key(p), this.now() + ms);
    return ms;
  }
}
export const sharedCooldown = new Cooldown();

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
