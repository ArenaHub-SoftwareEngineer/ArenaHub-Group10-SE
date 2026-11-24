// Broadcast thumbnails: the organizer's picture is cropped to 16:9 (the shape of every match card) and shrunk
// before it leaves the browser. With Firebase on, it goes to public Storage and the match keeps the link. Without
// Firebase (local demo), a small JPEG is kept on the match itself so the card still shows it.
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, isFirebaseConfigured, useFirebaseEmulators } from './firebase';
import { getArenaStorage } from './firebaseStorage';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
async function cover169(file: File, width: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('That image could not be opened. Choose a PNG, JPEG or WebP picture.'); });
  const height = Math.round(width * 9 / 16);
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the image.');
  context.drawImage(bitmap, (width - bitmap.width * scale) / 2, (height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image could not be prepared.')), 'image/jpeg', quality));
}

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('The image could not be read.'));
  reader.readAsDataURL(blob);
});

/** Returns the URL to save as the match's custom thumbnail. */
export async function uploadBroadcastThumbnail(matchId: string, file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a picture under 15 MB.');
  if (useFirebaseEmulators || !isFirebaseConfigured || !auth.currentUser) return toDataUrl(await cover169(file, 640, 0.72));
  const blob = await cover169(file, 1280, 0.85);
  const target = ref(getArenaStorage(), `broadcastThumbnails/${matchId.replace(/[^\w-]/g, '_')}/${crypto.randomUUID()}.jpg`);
  try { await uploadBytes(target, blob, { contentType: 'image/jpeg', cacheControl: 'public,max-age=31536000' }); }
  catch { throw new Error('The thumbnail could not upload. Check your connection and try again.'); }
  return getDownloadURL(target);
}
