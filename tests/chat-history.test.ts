import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatHistory, ChatThread, DAY_MS, deleteThread, emptyHistory, historyKey, HistoryStorage, legacyKeys, loadHistory, modelHistory, pruneHistory, saveHistory } from '../src/lib/chatHistory';
const now = Date.UTC(2026,10,1,12);
function memory(): HistoryStorage & { values: Map<string,string> } {
  const values = new Map<string,string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key,value) => { values.set(key,value); }, removeItem: key => { values.delete(key); } };
}
function thread(id: string, time = now): ChatThread { return { id, title: id, createdAt: time, updatedAt: time, messages: [{ id: `${id}-user`, sender: 'user', text: 'Explain the bracket.', timestamp: time, status: 'complete' }] }; }
const state = (...threads: ChatThread[]): ChatHistory => ({ ...emptyHistory(), threads, activeThreadId: threads[0]?.id || null });

test('viewer and organizer legacy chats migrate into one account history without losing messages', () => {
  const storage = memory();
  const shared = thread('shared');
  storage.setItem(legacyKeys('alice')[0], JSON.stringify([thread('viewer'),shared]));
  storage.setItem(legacyKeys('alice')[1], JSON.stringify([thread('organizer'),{ ...shared,messages:[{...shared.messages[0],text:'A different message with the same old ID.'}] }]));
  const result = loadHistory(storage,'alice',now);
  assert.equal(result.data.retentionDays,30); assert.equal(result.data.threads.length,3);
  assert.equal(result.data.threads.find(t=>t.id==='shared')?.messages.length,2);
  saveHistory(storage,'alice',result.data);
  assert.equal(storage.getItem(legacyKeys('alice')[0]),null);
  assert.deepEqual(loadHistory(storage,'alice',now).data.threads.map(t => t.id).sort(),['organizer','shared','viewer']);
});
test('30-day cleanup uses the last message time and removes an expired active chat at the exact boundary', () => {
  const value = state(thread('old',now - 30*DAY_MS),thread('recent',now - 29*DAY_MS));
  const result = pruneHistory(value,now);
  assert.equal(result.removed,1); assert.equal(result.data.activeThreadId,null);
  assert.deepEqual(result.data.threads.map(t => t.id),['recent']);
  assert.equal(pruneHistory(state(thread('boundary',now - 30*DAY_MS + 1)),now).removed,0);
  const renamed = thread('renamed',now-31*DAY_MS); renamed.updatedAt=now;
  assert.equal(pruneHistory(state(renamed),now).removed,1);
  const storage = memory(); saveHistory(storage,'alice',state(renamed));
  assert.equal(loadHistory(storage,'alice',now).removed,1);
});
test('keep-until-deleted disables age cleanup, and merely loading a chat never renews its timer', () => {
  const storage = memory(); const value = { ...state(thread('old',now-1000*DAY_MS)), retentionDays: 0 as const };
  saveHistory(storage,'alice',value);
  const loaded = loadHistory(storage,'alice',now).data;
  assert.equal(loaded.threads[0].updatedAt,now-1000*DAY_MS);
  assert.equal(pruneHistory(loaded,now+1000*DAY_MS).removed,0);
});
test('quota errors preserve legacy originals and never evict older conversations', () => {
  const storage = memory(); const old = JSON.stringify([thread('preserve')]);
  storage.setItem(legacyKeys('alice')[0],old);
  const blocked = { ...storage, setItem() { throw new Error('Quota exceeded'); } };
  assert.throws(() => saveHistory(blocked,'alice',loadHistory(storage,'alice',now).data),/Quota/);
  assert.equal(storage.getItem(legacyKeys('alice')[0]),old); assert.equal(storage.getItem(historyKey('alice')),null);
});
test('unreadable history and malformed messages are rejected without overwriting original data', () => {
  const storage = memory(); const raw = '{not valid JSON'; storage.setItem(historyKey('alice'),raw);
  assert.throws(() => loadHistory(storage,'alice',now)); assert.equal(storage.getItem(historyKey('alice')),raw);
  storage.setItem(historyKey('alice'),JSON.stringify({ ...state(thread('bad')), threads:[{ ...thread('bad'), messages:[...thread('bad').messages,{ text:'invalid' }] }] }));
  assert.throws(() => loadHistory(storage,'alice',now));
});
test('manual deletion stays deleted across reload and leaves other chats and the policy intact', () => {
  const storage = memory(); const value = state(thread('remove'),thread('keep'));
  saveHistory(storage,'alice',deleteThread(value,'remove'));
  const loaded = loadHistory(storage,'alice',now).data;
  assert.deepEqual(loaded.threads.map(t => t.id),['keep']); assert.equal(loaded.activeThreadId,null); assert.equal(loaded.retentionDays,30);
});
test('account histories remain separate and the active conversation is restored', () => {
  const storage = memory(); saveHistory(storage,'alice',state(thread('alice-chat'))); saveHistory(storage,'bob',state(thread('bob-chat')));
  assert.equal(loadHistory(storage,'alice',now).data.activeThreadId,'alice-chat');
  assert.deepEqual(loadHistory(storage,'bob',now).data.threads.map(t => t.id),['bob-chat']);
  assert.equal(loadHistory(storage,'guest',now).data.threads.length,0);
});
test('a reload makes unfinished assistant replies recoverable instead of leaving an endless spinner', () => {
  const storage = memory(); const value = state(thread('interrupted'));
  value.threads[0].messages.push({ id:'reply',sender:'assistant',text:'',timestamp:now,status:'writing' });
  saveHistory(storage,'alice',value);
  const reply = loadHistory(storage,'alice',now).data.threads[0].messages[1];
  assert.equal(reply.status,'stopped'); assert.ok(reply.text.includes('interrupted'));
});
test('bounded model context does not truncate saved conversations', () => {
  const value = thread('long');
  value.messages = Array.from({length:60},(_,i) => ({id:String(i),sender:i%2 ? 'assistant' : 'user',text:'x'.repeat(3900),timestamp:now,status:'complete'}));
  const context = modelHistory(value.messages);
  assert.equal(context[0].role,'user');
  assert.ok(context.length<=24); assert.ok(context.reduce((n,m)=>n+m.text.length,0)<=20000);
  assert.equal(value.messages.length,60); assert.equal(value.messages[0].text.length,3900);
});
test('expired chats stay removed when cleanup is committed and history is reopened', () => {
  const storage = memory(); const value = state(thread('expired',now-31*DAY_MS),thread('keep'));
  saveHistory(storage,'alice',value);
  const result = loadHistory(storage,'alice',now); assert.equal(result.removed,1);
  saveHistory(storage,'alice',result.data);
  assert.deepEqual(loadHistory(storage,'alice',now).data.threads.map(t => t.id),['keep']);
});
