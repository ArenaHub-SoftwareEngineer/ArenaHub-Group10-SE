// "Was this answer helpful?" One rating per answer per account, readable only by tournament staff,
// who use the unhelpful ones to find questions Arena AI gets wrong.
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { ChatReference } from './chatHistory';

export type AiRating = 'up' | 'down';
export interface AiFeedback {
  id: string; rating: AiRating; question: string; answer: string; source: string;
  references: string[]; note: string; createdAt?: number;
}

/** The document id ties the rating to one answer, so the same answer cannot be rated twice. */
export const feedbackId = (uid: string, messageId: string) => `${uid}_${messageId}`.replace(/[^\w-]/g, '_').slice(0, 300);

export async function rateAnswer(input: { messageId: string; rating: AiRating; question: string; answer: string; source?: string; references?: ChatReference[]; note?: string }) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in to rate answers.');
  await setDoc(doc(db, 'aiFeedback', feedbackId(uid, input.messageId)), {
    uid, rating: input.rating,
    question: input.question.slice(0, 500), answer: input.answer.slice(0, 2400),
    source: (input.source || '').slice(0, 40),
    references: (input.references || []).map(r => r.label.slice(0, 160)).slice(0, 12),
    note: (input.note || '').trim().slice(0, 300),
    createdAt: serverTimestamp(),
  });
}

/** Staff only. The newest 100 ratings; filtered by rating here, so no composite index is needed. */
export function watchAiFeedback(receive: (items: AiFeedback[]) => void, fail: (message: string) => void) {
  const q = query(collection(db, 'aiFeedback'), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(q, snap => receive(snap.docs.map(d => {
    const data = d.data();
    return { id: d.id, rating: data.rating, question: data.question || '', answer: data.answer || '', source: data.source || '', references: data.references || [], note: data.note || '', createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : undefined };
  })), () => fail('Feedback could not load. Staff access is required.'));
}

/** Staff: mark a rating as reviewed by removing it. */
export const dismissFeedback = (id: string) => deleteDoc(doc(db, 'aiFeedback', id));
