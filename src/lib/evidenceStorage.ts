import { ref, uploadBytesResumable, getBlob } from 'firebase/storage';
import { auth } from './firebase';
import { getArenaStorage } from './firebaseStorage';
export interface EvidenceFile { path: string; name: string; mime: string; size: number }
export async function uploadEvidence(caseId: string, file: File, progress: (percent: number) => void): Promise<EvidenceFile> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in before uploading evidence.');
  if (!['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(file.type) || file.size < 1 || file.size > 100 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, WebP, MP4 or WebM file up to 100 MB.');
  const path = `integrityEvidence/${uid}/${caseId}/${crypto.randomUUID()}`;
  const task = uploadBytesResumable(ref(getArenaStorage(), path), file, { contentType: file.type });
  await new Promise<void>((resolve, reject) => task.on('state_changed', snap => progress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)), () => reject(new Error('Evidence upload failed. Check that private evidence storage is configured and you are connected. No report has been submitted.')), () => resolve()));
  return { path, name: file.name.slice(0, 180), mime: file.type, size: file.size };
}
export async function readEvidence(file: EvidenceFile) {
  return getBlob(ref(getArenaStorage(), file.path), 100 * 1024 * 1024);
}
