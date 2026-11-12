import { collection, doc, onSnapshot, query, where, serverTimestamp, runTransaction } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';
import { CaseStatus, IntegrityCase, validateReport } from './integrityChecks';
import { notificationRecord, notificationRef } from './notificationService';
import { uploadEvidence } from './evidenceStorage';
import { type FrameFinding } from './videoReview';
import { writeBatch } from 'firebase/firestore';

function requireAccount() {
  const user = auth.currentUser;
  if (!isFirebaseConfigured || !user || user.isAnonymous || !user.emailVerified) throw new Error('Sign in with a verified account to submit or review evidence.');
  return user;
}
export function subscribeIntegrityCases(staff: boolean, receive: (cases: IntegrityCase[]) => void, fail: (message: string) => void) {
  const user = auth.currentUser;
  if (!user || !isFirebaseConfigured) { receive([]); return () => {}; }
  const source = staff ? collection(db, 'integrityCases') : query(collection(db, 'integrityCases'), where('reporterId', '==', user.uid));
  return onSnapshot(source, snap => receive(snap.docs.map(d => ({ ...d.data(), id: d.id } as IntegrityCase)).filter(record => typeof record.details === 'string' && typeof record.matchId === 'string' && typeof record.reporterId === 'string' && typeof record.reason === 'string').sort((a, b) => ((b.createdAt as any)?.seconds || 0) - ((a.createdAt as any)?.seconds || 0))), () => fail('The review service could not be reached. Check your connection and the deployed database permissions.'));
}
export async function submitIntegrityCase(input: { matchId: string; reason: string; details: string; evidenceUrl: string }, file?: File, progress: (percent: number) => void = () => {}) {
  const user = requireAccount();
  const ticket = doc(collection(db, 'integrityCases'));
  const evidenceFiles = file ? [await uploadEvidence(ticket.id, file, progress)] : [];
  const clean = validateReport({ ...input, evidenceFiles });
  const limit = doc(db, 'integrityRateLimits', user.uid);
  await runTransaction(db, async tx => {
    const prior = await tx.get(limit);
    const lastTime = prior.data()?.submittedAt?.toMillis?.() || 0;
    if (Date.now() - lastTime < 60_000) throw new Error('Please wait one minute before submitting another report.');
    tx.set(ticket, { ...clean, reporterId: user.uid, status: 'open', reviewerId: '', resolution: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(limit, { submittedAt: serverTimestamp(), caseId: ticket.id });
    tx.set(notificationRef(user.uid, `case-${ticket.id}`), notificationRecord('fair-play', 'Evidence received', 'Your clip or evidence link is in the private organizer review queue.', 'integrity', ticket.id));
    tx.set(doc(db, 'staffInbox', `case-${ticket.id}`), { ...notificationRecord('fair-play', 'New match evidence', 'A match concern is ready for private review.', 'integrity', ticket.id), actorId: user.uid, sourceId: ticket.id });
  });
  return ticket.id;
}
export async function reviewIntegrityCase(id: string, status: Exclude<CaseStatus, 'open'>, resolution: string) {
  const user = requireAccount();
  const token = await user.getIdTokenResult();
  if (token.claims.admin !== true && !['admin', 'organizer', 'school-admin', 'moderator'].includes(String(token.claims.role))) throw new Error('Only authorized tournament staff can review evidence.');
  const note = resolution.trim();
  if (note.length < 10 || note.length > 2000) throw new Error('Enter a review note of 10–2,000 characters.');
  await runTransaction(db, async tx => {
    const ref = doc(db, 'integrityCases', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('This report no longer exists.');
    if (['resolved', 'dismissed'].includes(snap.data().status)) throw new Error('This report has already been closed.');
    tx.update(ref, { status, resolution: note, reviewerId: user.uid, updatedAt: serverTimestamp() });
    tx.set(doc(collection(ref, 'events')), { actorId: user.uid, action: status, note, createdAt: serverTimestamp() });
    tx.set(notificationRef(snap.data().reporterId, `case-review-${id}-${Date.now()}`), notificationRecord('fair-play', `Evidence review ${status}`, note, 'integrity', id));
  });
}

export function subscribeCaseActivity(caseId: string, receive: (events: any[]) => void, fail: (message: string) => void) {
  return onSnapshot(collection(db, 'integrityCases', caseId, 'events'), snap => receive(snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a: any, b: any) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0) || (a.createdAt?.nanoseconds || 0) - (b.createdAt?.nanoseconds || 0))), () => fail('Case history could not load.'));
}
export async function saveVideoReview(caseId: string, frames: FrameFinding[], summary: string) {
  const user = requireAccount();
  if (summary.trim().length < 10 || summary.length > 2000 || frames.length > 60) throw new Error('Add a brief organizer observation before saving.');
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'integrityCases', caseId, 'events')), { actorId: user.uid, action: 'video-review', note: summary.trim(), frames, createdAt: serverTimestamp() });
  await batch.commit();
}
export function subscribeCaseAppeal(caseId: string, receive: (appeal: any) => void, fail: (message: string) => void) {
  return onSnapshot(doc(db, 'integrityCases', caseId, 'appeals', 'appeal'), snap => receive(snap.exists() ? snap.data() : null), () => fail('The appeal could not load.'));
}
export async function submitCaseAppeal(caseId: string, note: string) {
  const user = requireAccount(); if (note.trim().length < 10 || note.length > 2000) throw new Error('Explain the requested correction in 10–2,000 characters.');
  await runTransaction(db, async tx => {
    const ref = doc(db, 'integrityCases', caseId), record = await tx.get(ref), appeal = doc(ref, 'appeals', 'appeal');
    const prior = await tx.get(appeal);
    if (prior.exists()) throw new Error('An appeal has already been submitted for this case.');
    if (record.data()?.reporterId !== user.uid || !['resolved', 'dismissed'].includes(record.data()?.status)) throw new Error('You can request a review of your closed case.');
    tx.set(appeal, { ownerId: user.uid, note: note.trim(), status: 'open', resolution: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(doc(db, 'staffInbox', `appeal-${caseId}`), { ...notificationRecord('fair-play', 'Case review requested', 'The reporter requested a review of a closed case.', 'integrity', caseId), actorId: user.uid, sourceId: caseId });
  });
}
export async function resolveCaseAppeal(caseId: string, status: 'accepted' | 'rejected', note: string) {
  const user = requireAccount(); if (note.trim().length < 10 || note.length > 2000) throw new Error('Record an appeal decision in 10–2,000 characters.');
  await runTransaction(db, async tx => {
    const ref = doc(db, 'integrityCases', caseId, 'appeals', 'appeal'), snap = await tx.get(ref);
    if (!snap.exists() || snap.data().status !== 'open') throw new Error('This appeal is no longer open.');
    tx.update(ref, { status, resolution: note.trim(), updatedAt: serverTimestamp() });
    tx.set(doc(collection(db, 'integrityCases', caseId, 'events')), { actorId: user.uid, action: `appeal-${status}`, note: note.trim(), createdAt: serverTimestamp() });
    tx.set(notificationRef(snap.data().ownerId, `appeal-result-${caseId}`), notificationRecord('fair-play', `Case appeal ${status}`, note.trim(), 'integrity', caseId));
  });
}
