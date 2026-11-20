import { emptyHistory, type ChatHistory, type ChatMessage, type ChatThread } from './chatHistory';

export interface HistorySnapshot { revision: number; history: ChatHistory; deleted: string[] }
export const emptySnapshot = (): HistorySnapshot => ({ revision: 0, history: emptyHistory(), deleted: [] });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge: an unchanged stale browser must never overwrite another device's work. */
export function mergeHistory(base: ChatHistory, local: ChatHistory, remote: HistorySnapshot): ChatHistory {
  const before = new Map(base.threads.map(t => [t.id, t]));
  const mine = new Map(local.threads.map(t => [t.id, t]));
  const deleted = new Set([...remote.deleted, ...base.threads.filter(t => !mine.has(t.id)).map(t => t.id)]);
  const threads = new Map(remote.history.threads.filter(t => !deleted.has(t.id)).map(t => [t.id, t]));
  for (const thread of local.threads) {
    if (deleted.has(thread.id) || same(thread, before.get(thread.id))) continue;
    const other = threads.get(thread.id), old = before.get(thread.id);
    if (!other) { threads.set(thread.id, thread); continue; }
    const oldMessages = new Map(old?.messages.map(m => [m.id, m]) || []);
    const messages = new Map<string, ChatMessage>(other.messages.map(m => [m.id, m]));
    for (const message of thread.messages) if (!same(message, oldMessages.get(message.id))) messages.set(message.id, message);
    const merged: ChatThread = { ...other, title: thread.title !== old?.title ? thread.title : other.title,
      messages: [...messages.values()].sort((a, b) => a.timestamp - b.timestamp),
      createdAt: Math.min(thread.createdAt, other.createdAt), updatedAt: Math.max(thread.updatedAt, other.updatedAt) };
    threads.set(thread.id, merged);
  }
  return { version: 1, threads: [...threads.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    activeThreadId: threads.has(local.activeThreadId || '') ? local.activeThreadId : null,
    retentionDays: local.retentionDays !== base.retentionDays ? local.retentionDays : remote.history.retentionDays };
}
