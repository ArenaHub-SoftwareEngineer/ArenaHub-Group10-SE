import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, Timestamp, where, writeBatch, type WriteBatch } from 'firebase/firestore';
import { db } from './firebase';
import { auditLine, KICK_HOURS, type ModerationAction } from './chatModeration';

export interface LiveChatMessage {
  id: string;
  author: string;
  text: string;
  /** Milliseconds since epoch; undefined while the server timestamp is pending. */
  createdAt?: number;
  /** 'staff' when a tournament staff member posted it. Checked against the token role in the rules. */
  badge?: 'staff';
}

export interface ChatPin { messageId: string; author: string; text: string }
export interface ChatState { slowModeSec: number; pinned: ChatPin | null }
export interface ChatMute { until: number; kind: 'mute' | 'kick'; reason: string }

const EMPTY_STATE: ChatState = { slowModeSec: 0, pinned: null };
const millis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : undefined;
const stateRef = (matchId: string) => doc(db, 'matchChat', matchId);
const messageRef = (matchId: string, id: string) => doc(db, 'matchChat', matchId, 'messages', id);
const authorRef = (matchId: string, id: string) => doc(db, 'matchChat', matchId, 'authors', id);
const muteRef = (matchId: string, uid: string) => doc(db, 'matchChat', matchId, 'mutes', uid);
const paceRef = (matchId: string, uid: string) => doc(db, 'matchChat', matchId, 'pace', uid);

export function watchMatchChat(matchId: string, onMessages: (messages: LiveChatMessage[]) => void, onError: () => void) {
  const recent = query(collection(db, 'matchChat', matchId, 'messages'), orderBy('createdAt', 'desc'), limit(60));
  return onSnapshot(recent, snapshot => onMessages(snapshot.docs.map(item => {
    const data = item.data({ serverTimestamps: 'estimate' });
    return { id: item.id, author: data.author, text: data.text, createdAt: millis(data.createdAt), badge: data.badge === 'staff' ? 'staff' as const : undefined };
  }).reverse()), onError);
}

/** Slow mode and the pinned message. A missing document means chat is in its default state. */
export function watchChatState(matchId: string, receive: (state: ChatState) => void) {
  return onSnapshot(stateRef(matchId), snap => {
    const data = snap.data();
    receive(data ? { slowModeSec: Number(data.slowModeSec) || 0, pinned: data.pinned || null } : EMPTY_STATE);
  }, () => receive(EMPTY_STATE));
}

/** The signed-in viewer's own mute, if any. Viewers can read only their own record. */
export function watchMyMute(matchId: string, uid: string, receive: (mute: ChatMute | null) => void) {
  return onSnapshot(muteRef(matchId, uid), snap => {
    const data = snap.data();
    receive(data ? { until: millis(data.until) || 0, kind: data.kind, reason: data.reason || '' } : null);
  }, () => receive(null));
}

/** When this viewer last posted, for the slow-mode countdown. */
export async function lastMessageAt(matchId: string, uid: string) {
  try { return millis((await getDoc(paceRef(matchId, uid))).data()?.lastMessageAt); } catch { return undefined; }
}

export async function sendMatchChat(matchId: string, uid: string, author: string, text: string, staff = false) {
  const message = doc(collection(db, 'matchChat', matchId, 'messages'));
  const batch = writeBatch(db);
  const createdAt = serverTimestamp();
  batch.set(message, staff ? { author, text, createdAt, badge: 'staff' } : { author, text, createdAt });
  batch.set(authorRef(matchId, message.id), { uid, createdAt });
  // The rules require this record in the same write, and use it to enforce slow mode.
  batch.set(paceRef(matchId, uid), { lastMessageAt: createdAt, messageId: message.id });
  await batch.commit();
}

// ---- Staff moderation. Every action writes an audit event in the same batch. ----

function audit(batch: WriteBatch, actorId: string, matchId: string, action: ModerationAction, target = '') {
  const ref = doc(collection(db, 'auditEvents'));
  batch.set(ref, { actorId, action: auditLine(matchId, action, target), createdAt: serverTimestamp() });
  return ref.id;
}

/** The account that posted a message. Staff only. */
export async function messageAuthorId(matchId: string, messageId: string) {
  const uid = (await getDoc(authorRef(matchId, messageId))).data()?.uid;
  if (typeof uid !== 'string') throw new Error('This message has no registered author, so it cannot be moderated by account.');
  return uid;
}

export async function muteChatUser(matchId: string, staffUid: string, messageId: string, minutes: number, reason = '') {
  const target = await messageAuthorId(matchId, messageId);
  if (target === staffUid) throw new Error('You cannot mute yourself.');
  const batch = writeBatch(db);
  const auditId = audit(batch, staffUid, matchId, { kind: 'mute', minutes }, target);
  batch.set(muteRef(matchId, target), {
    until: Timestamp.fromMillis(Date.now() + minutes * 60_000), kind: 'mute', reason: reason.slice(0, 200),
    by: staffUid, auditId, createdAt: serverTimestamp(),
  });
  await batch.commit();
}

/** Kick: block posting for KICK_HOURS and remove the viewer's messages in this match. */
export async function kickChatUser(matchId: string, staffUid: string, messageId: string, reason = '') {
  const target = await messageAuthorId(matchId, messageId);
  if (target === staffUid) throw new Error('You cannot remove yourself from chat.');
  const posted = await getDocs(query(collection(db, 'matchChat', matchId, 'authors'), where('uid', '==', target), limit(400)));
  const batch = writeBatch(db);
  const auditId = audit(batch, staffUid, matchId, { kind: 'kick' }, target);
  batch.set(muteRef(matchId, target), {
    until: Timestamp.fromMillis(Date.now() + KICK_HOURS * 3_600_000), kind: 'kick', reason: reason.slice(0, 200),
    by: staffUid, auditId, createdAt: serverTimestamp(),
  });
  posted.docs.forEach(item => batch.delete(messageRef(matchId, item.id)));
  await batch.commit();
  return posted.size;
}

export async function unmuteChatUser(matchId: string, staffUid: string, targetUid: string) {
  const batch = writeBatch(db);
  audit(batch, staffUid, matchId, { kind: 'unmute' }, targetUid);
  batch.delete(muteRef(matchId, targetUid));
  await batch.commit();
}

export async function deleteChatMessage(matchId: string, staffUid: string, messageId: string, state: ChatState) {
  const batch = writeBatch(db);
  const auditId = audit(batch, staffUid, matchId, { kind: 'delete' }, messageId);
  batch.delete(messageRef(matchId, messageId));
  if (state.pinned?.messageId === messageId) batch.set(stateRef(matchId), { slowModeSec: state.slowModeSec, pinned: null, updatedBy: staffUid, auditId, updatedAt: serverTimestamp() });
  await batch.commit();
}

function writeState(matchId: string, staffUid: string, next: ChatState, action: ModerationAction, target = '') {
  const batch = writeBatch(db);
  const auditId = audit(batch, staffUid, matchId, action, target);
  batch.set(stateRef(matchId), { slowModeSec: next.slowModeSec, pinned: next.pinned, updatedBy: staffUid, auditId, updatedAt: serverTimestamp() });
  return batch.commit();
}

export const pinChatMessage = (matchId: string, staffUid: string, message: LiveChatMessage, state: ChatState) =>
  writeState(matchId, staffUid, { ...state, pinned: { messageId: message.id, author: message.author, text: message.text } }, { kind: 'pin' }, message.id);
export const unpinChatMessage = (matchId: string, staffUid: string, state: ChatState) =>
  writeState(matchId, staffUid, { ...state, pinned: null }, { kind: 'unpin' });
export const setSlowMode = (matchId: string, staffUid: string, seconds: number, state: ChatState) =>
  writeState(matchId, staffUid, { ...state, slowModeSec: seconds }, { kind: 'slow-mode', seconds });

/** Staff list of active mutes for this match. */
export function watchMatchMutes(matchId: string, receive: (mutes: Array<ChatMute & { uid: string }>) => void) {
  return onSnapshot(collection(db, 'matchChat', matchId, 'mutes'), snap => receive(snap.docs
    .map(item => ({ uid: item.id, until: millis(item.data().until) || 0, kind: item.data().kind, reason: item.data().reason || '' }))
    .filter(mute => mute.until > Date.now())), () => receive([]));
}
