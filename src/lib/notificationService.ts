import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';

export interface ArenaNotification { id: string; kind: string; title: string; body: string; tab: string; entityId: string; createdAt: any; readAt: any }
export function notificationRecord(kind: string, title: string, body: string, tab: string, entityId = '') {
  return { kind, title: title.slice(0, 120), body: body.slice(0, 500), tab, entityId, createdAt: serverTimestamp(), readAt: null };
}
export function notificationRef(uid: string, id: string) { return doc(db, 'users', uid, 'notifications', id); }
export function subscribeNotifications(uid: string, receive: (items: ArenaNotification[]) => void, fail: (message: string) => void) {
  return onSnapshot(query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(30)), snap => receive(snap.docs.map(d => ({ ...d.data(), id: d.id } as ArenaNotification))), () => fail('Notifications could not load. Check your connection and database permissions.'));
}
/** Durable broadcasts are copied once into each admitted user's private inbox, also after an offline period. */
export function subscribeNotificationSources(uid: string, staff: boolean, fail: (message: string) => void) {
  let active = true;
  const stops = ['arenaAnnouncements', ...(staff ? ['staffInbox'] : [])].map(source => onSnapshot(query(collection(db, source), orderBy('createdAt', 'desc'), limit(20)), snap => {
    for (const change of snap.docChanges()) if (change.type === 'added') {
      const item = change.doc.data();
      void runTransaction(db, async tx => {
        if (!active || auth.currentUser?.uid !== uid) return;
        const ref = notificationRef(uid, `${source}-${change.doc.id}`);
        if ((await tx.get(ref)).exists()) return;
        tx.set(ref, { ...notificationRecord(item.kind, item.title, item.body, item.tab, item.entityId), createdAt: item.createdAt });
      }).catch(() => { if (active) fail('Some tournament updates could not be added to your inbox.'); });
    }
  }, () => { if (active) fail('Tournament notification updates are unavailable.'); }));
  return () => { active = false; stops.forEach(stop => stop()); };
}
export async function setNotificationsRead(uid: string, ids: string[], read: boolean) {
  if (auth.currentUser?.uid !== uid) throw new Error('Sign in to your own notification inbox.');
  const batch = writeBatch(db);
  ids.forEach(id => batch.update(notificationRef(uid, id), { readAt: read ? serverTimestamp() : null }));
  await batch.commit();
}
