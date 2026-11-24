import { collection, doc, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { ContentReport } from './types';
import type { LiveChatMessage } from './matchChat';
import { notificationRecord, notificationRef } from './notificationService';
export function watchCommunityReports(receive: (reports: ContentReport[]) => void, fail: () => void) {
  return onSnapshot(collection(db, 'communityReports'), snap => receive(snap.docs.map(d => ({ ...d.data(), id: d.id, shared: true, contentType: 'Chat message', reportedBy: 'Verified campus member', timeAgo: d.data().createdAt?.toDate?.().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) || 'Just now', createdAt: d.data().createdAt?.toMillis?.() ?? Date.now(), flagCount: 1 } as ContentReport))), fail);
}
export async function reportLiveMessage(matchId: string, message: LiveChatMessage) {
  const user = auth.currentUser; if (!user?.emailVerified) throw new Error('Sign in with your campus account to report chat.');
  const id = `${matchId}__${message.id}__${user.uid}`, batch = writeBatch(db);
  batch.set(doc(db, 'communityReports', id), { reporterId: user.uid, matchId, sourceMessageId: message.id, contentSnippet: message.text, postedBy: message.author, type: 'HARASSMENT', status: 'open', reviewerId: '', resolution: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, 'staffInbox', `community-${id}`), { ...notificationRecord('fair-play', 'Chat message reported', 'A viewer reported a match chat message for organizer review.', 'reports', id), actorId: user.uid, sourceId: id });
  await batch.commit();
}
export async function resolveCommunityReport(id: string, action: 'remove' | 'remove_and_ban' | 'dismiss') {
  const user = auth.currentUser; if (!user) throw new Error('Sign in as tournament staff.');
  await runTransaction(db, async tx => {
    const ref = doc(db, 'communityReports', id), report = (await tx.get(ref)).data();
    if (!report || report.status !== 'open') throw new Error('This report is already resolved or unavailable.');
    const message = doc(db, 'matchChat', report.matchId, 'messages', report.sourceMessageId), messageSnap = await tx.get(message);
    const author = action === 'remove_and_ban' ? (await tx.get(doc(db, 'matchChat', report.matchId, 'authors', report.sourceMessageId))).data()?.uid : undefined;
    if (action === 'remove_and_ban' && (!author || author === user.uid)) throw new Error('A registered author is required, and you cannot restrict your own account.');
    if (author) tx.update(doc(db, 'users', author), { status: 'banned' });
    if (action !== 'dismiss' && messageSnap.exists()) tx.delete(message);
    tx.update(ref, { status: 'resolved', reviewerId: user.uid, resolution: action, updatedAt: serverTimestamp() });
    tx.set(notificationRef(report.reporterId, `community-review-${id}`), notificationRecord('fair-play', 'Chat report reviewed', action === 'dismiss' ? 'An organizer reviewed your report and kept the message.' : 'An organizer reviewed your report and removed the message.', 'current-live', report.matchId));
    tx.set(doc(collection(db, 'auditEvents')), { actorId: user.uid, action: `Community report ${id}: ${action}`, createdAt: serverTimestamp() });
  });
}
