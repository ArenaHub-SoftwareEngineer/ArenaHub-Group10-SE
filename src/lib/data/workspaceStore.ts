/**
 * Shared workspace records that used to live in one arenahub/workspace document or in localStorage:
 *   config/catalog                 game titles and categories (small, rarely changes)
 *   featured/{id}                  spotlight items with real fields (no invented view or reaction counts)
 *   users/{uid}/drafts/{draftId}   an organizer's saved bracket drafts (private to that organizer)
 */
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { BracketDraft, GameTitle } from '../types';
import { assertDocSize } from './tournamentDocs';

export interface Catalog { games: GameTitle[]; categories: string[] }
export interface FeaturedItem {
  id: string; kind: 'highlight' | 'post'; title: string; link: string; author: string;
  createdAt: number; isFeatured: boolean;
}

const catalogRef = () => doc(db, 'config', 'catalog');

export function watchCatalog(receive: (catalog: Catalog | null) => void, fail: (error: unknown) => void) {
  return onSnapshot(catalogRef(), snapshot => {
    if (!snapshot.exists()) { receive(null); return; }
    const data = snapshot.data();
    receive({ games: Array.isArray(data.games) ? data.games : [], categories: Array.isArray(data.categories) ? data.categories : [] });
  }, fail);
}

/** Applies a change to the shared catalog, starting from the defaults when it does not exist yet. */
export async function mutateCatalog(defaults: Catalog, change: (catalog: Catalog) => void): Promise<Catalog> {
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(catalogRef());
    const current: Catalog = snapshot.exists()
      ? { games: snapshot.data().games ?? [], categories: snapshot.data().categories ?? [] }
      : JSON.parse(JSON.stringify(defaults));
    change(current);
    if (current.games.length > 100 || current.categories.length > 100) throw new Error('The catalog holds at most 100 games and 100 categories.');
    assertDocSize(current, 'The game catalog');
    tx.set(catalogRef(), { games: JSON.parse(JSON.stringify(current.games)), categories: current.categories, updatedAt: serverTimestamp() });
    return current;
  });
}

export function watchFeatured(receive: (items: FeaturedItem[]) => void, fail: (error: unknown) => void) {
  return onSnapshot(query(collection(db, 'featured'), orderBy('createdAt', 'desc')), snapshot => {
    receive(snapshot.docs.map(item => {
      const data = item.data();
      return {
        id: item.id, kind: data.kind === 'post' ? 'post' : 'highlight', title: String(data.title || ''), link: String(data.link || ''),
        author: String(data.author || ''), createdAt: data.createdAt?.toMillis?.() ?? 0, isFeatured: data.isFeatured === true,
      };
    }));
  }, fail);
}

export function validateFeatured(input: { title: string; link: string; author: string }) {
  const title = input.title.trim(), author = input.author.trim(), link = input.link.trim();
  if (title.length < 3 || title.length > 120) throw new Error('Use a title of 3 to 120 characters.');
  if (author.length < 2 || author.length > 80) throw new Error('Name who made or posted this item (2 to 80 characters).');
  let url: URL;
  try { url = new URL(link); } catch { throw new Error('Enter the full https:// link to the clip or post.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an https:// link without a username or password.');
  return { title, author, link: url.toString() };
}

export async function addFeatured(kind: FeaturedItem['kind'], input: { title: string; link: string; author: string }) {
  const clean = validateFeatured(input);
  const ref = doc(collection(db, 'featured'));
  await setDoc(ref, { ...clean, kind, isFeatured: false, createdAt: serverTimestamp() });
  return ref.id;
}

export const setFeatured = (id: string, isFeatured: boolean) => updateDoc(doc(db, 'featured', id), { isFeatured });
export const removeFeatured = (id: string) => deleteDoc(doc(db, 'featured', id));

export function watchDrafts(uid: string, receive: (drafts: BracketDraft[]) => void, fail: (error: unknown) => void) {
  return onSnapshot(query(collection(db, 'users', uid, 'drafts'), orderBy('savedAt', 'desc')), snapshot => {
    receive(snapshot.docs.map(item => item.data().draft as BracketDraft).filter(Boolean));
  }, fail);
}

export async function saveDraft(uid: string, draft: BracketDraft) {
  const payload = { draft: JSON.parse(JSON.stringify(draft)), savedAt: serverTimestamp() };
  assertDocSize(payload, 'This draft');
  await setDoc(doc(db, 'users', uid, 'drafts', draft.id), payload);
}

export const deleteDraft = (uid: string, id: string) => deleteDoc(doc(db, 'users', uid, 'drafts', id));
