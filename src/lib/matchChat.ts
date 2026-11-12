import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

export interface LiveChatMessage {
  id: string;
  author: string;
  text: string;
}

export function watchMatchChat(matchId: string, onMessages: (messages: LiveChatMessage[]) => void, onError: () => void) {
  const recent = query(collection(db, 'matchChat', matchId, 'messages'), orderBy('createdAt', 'desc'), limit(60));
  return onSnapshot(recent, snapshot => onMessages(snapshot.docs.map(item => ({
    id: item.id, author: item.data().author, text: item.data().text,
  })).reverse()), onError);
}

export async function sendMatchChat(matchId: string, uid: string, author: string, text: string) {
  const message = doc(collection(db, 'matchChat', matchId, 'messages'));
  const batch = writeBatch(db);
  const createdAt = serverTimestamp();
  batch.set(message, { author, text, createdAt });
  batch.set(doc(db, 'matchChat', matchId, 'authors', message.id), { uid, createdAt });
  await batch.commit();
}
