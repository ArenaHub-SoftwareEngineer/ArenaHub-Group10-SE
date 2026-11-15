export type RetentionDays = 0 | 30 | 90 | 180;
export const DEFAULT_RETENTION_DAYS: RetentionDays = 30;
export const DAY_MS = 86_400_000;
export interface ChatMessage {
  id: string; sender: 'user' | 'assistant'; text: string; timestamp: number;
  source?: string; status?: 'complete' | 'writing' | 'stopped' | 'error';
  /** Which published records the answer was checked against (labels only). */
  references?: string[];
}
export interface ChatThread {
  id: string; title: string; messages: ChatMessage[]; createdAt: number; updatedAt: number;
}
export interface ChatHistory {
  version: 1; threads: ChatThread[]; activeThreadId: string | null; retentionDays: RetentionDays;
}
export interface HistoryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export const historyKey = (userId: string) => `arenahub_chat_history_v1_${userId}`;
export const legacyKeys = (userId: string) => [`arenahub_ai_chat_threads_v4_${userId}`, `arenahub_admin_ai_threads_v3_${userId}`];
export const emptyHistory = (): ChatHistory => ({ version: 1, threads: [], activeThreadId: null, retentionDays: DEFAULT_RETENTION_DAYS });
function timestamp(value: unknown, fallback: number): number {
  const date = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(date) && date > 0 ? date : fallback;
}
const lastMessageTime = (messages: ChatMessage[], fallback: number) => messages.reduce((latest, message) => Math.max(latest, message.timestamp), 0) || fallback;
function parseThread(value: unknown, now: number): ChatThread | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !Array.isArray(input.messages)) return null;
  const messages: ChatMessage[] = input.messages.flatMap((raw): ChatMessage[] => {
    if (!raw || typeof raw !== 'object' || !['user', 'assistant'].includes(raw.sender) || typeof raw.text !== 'string') return [];
    const writing = raw.status === 'writing';
    return [{ id: typeof raw.id === 'string' ? raw.id : `import-${input.id}-${Math.random().toString(36).slice(2)}`, sender: raw.sender,
      text: writing && !raw.text ? 'This response was interrupted. You can try again.' : raw.text,
      timestamp: timestamp(raw.timestamp, now), source: typeof raw.source === 'string' ? raw.source : undefined,
      ...(Array.isArray(raw.references) ? { references: raw.references.filter((r: unknown): r is string => typeof r === 'string').slice(0, 12).map((r: string) => r.slice(0, 160)) } : {}),
      status: writing ? 'stopped' : ['complete', 'stopped', 'error'].includes(raw.status) ? raw.status : 'complete' }];
  });
  if (!messages.length || messages.length !== input.messages.length) return null;
  return { id: input.id, title: typeof input.title === 'string' ? input.title : messages[0].text.slice(0, 70), messages,
    createdAt: timestamp(input.createdAt, messages[0].timestamp), updatedAt: lastMessageTime(messages, now) };
}
export function pruneHistory(data: ChatHistory, now = Date.now()): { data: ChatHistory; removed: number } {
  if (!data.retentionDays) return { data, removed: 0 };
  const threads = data.threads.filter(thread => now - lastMessageTime(thread.messages, thread.updatedAt) < data.retentionDays * DAY_MS);
  return { data: { ...data, threads, activeThreadId: threads.some(t => t.id === data.activeThreadId) ? data.activeThreadId : null }, removed: data.threads.length - threads.length };
}
export function loadHistory(storage: HistoryStorage, userId: string, now = Date.now()): { data: ChatHistory; removed: number } {
  const raw = storage.getItem(historyKey(userId));
  if (raw !== null) {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.threads)) throw new Error('Saved history could not be read. The original data has been kept.');
    const threads = parsed.threads.map((t: unknown) => parseThread(t, now)).filter(Boolean) as ChatThread[];
    if (threads.length !== parsed.threads.length) throw new Error('Some saved chats could not be read. The original data has been kept.');
    return pruneHistory({ version: 1, threads, activeThreadId: threads.some(t => t.id === parsed.activeThreadId) ? parsed.activeThreadId : null,
      retentionDays: [0, 30, 90, 180].includes(parsed.retentionDays) ? parsed.retentionDays : DEFAULT_RETENTION_DAYS }, now);
  }
  const threads = new Map<string, ChatThread>();
  for (const key of legacyKeys(userId)) {
    const legacy = storage.getItem(key);
    if (legacy === null) continue;
    const parsed = JSON.parse(legacy);
    if (!Array.isArray(parsed)) throw new Error('Earlier history could not be read. The original data has been kept.');
    for (const rawThread of parsed) {
      const thread = parseThread(rawThread, now);
      if (!thread) throw new Error('Earlier history could not be read. The original data has been kept.');
      const previous = threads.get(thread.id);
      if (previous) {
        const unique = new Map(previous.messages.map(message => [message.id, message]));
        for (const message of thread.messages) {
          let id = message.id; let suffix = 1;
          while (unique.has(id)) {
            const existing = unique.get(id)!;
            if (existing.sender === message.sender && existing.text === message.text && existing.timestamp === message.timestamp) break;
            id = `${message.id}-import-${suffix++}`;
          }
          if (!unique.has(id)) unique.set(id, { ...message, id });
        }
        const messages = [...unique.values()].sort((a,b) => a.timestamp - b.timestamp);
        threads.set(thread.id, { ...thread, messages, createdAt: Math.min(previous.createdAt, thread.createdAt), updatedAt: Math.max(previous.updatedAt, thread.updatedAt) });
      } else threads.set(thread.id, thread);
    }
  }
  const ordered = [...threads.values()].sort((a,b) => b.updatedAt - a.updatedAt);
  return pruneHistory({ ...emptyHistory(), threads: ordered, activeThreadId: ordered[0]?.id || null }, now);
}
export function saveHistory(storage: HistoryStorage, userId: string, data: ChatHistory): void {
  // Commit first. A quota/error must never erase the original history or evict old chats.
  storage.setItem(historyKey(userId), JSON.stringify(data));
  for (const key of legacyKeys(userId)) storage.removeItem(key);
}
export function deleteThread(data: ChatHistory, id: string): ChatHistory {
  return { ...data, threads: data.threads.filter(t => t.id !== id), activeThreadId: data.activeThreadId === id ? null : data.activeThreadId };
}
export function modelHistory(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; text: string }> {
  const output: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  let remaining = 20_000;
  for (const message of [...messages].reverse()) {
    if (!message.text || message.status === 'error' || message.status === 'stopped' || message.status === 'writing') continue;
    const text = message.text.slice(-Math.min(4000, remaining));
    output.unshift({ role: message.sender, text }); remaining -= text.length;
    if (!remaining || output.length === 24) break;
  }
  while (output[0]?.role === 'assistant') output.shift();
  return output;
}
export const browserHistoryStorage: HistoryStorage = {
  getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key),
};
