import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { app, useFirebaseEmulators } from './firebase';

let storage: FirebaseStorage | undefined;

export function getArenaStorage(): FirebaseStorage {
  if (!storage) {
    storage = getStorage(app);
    if (useFirebaseEmulators) connectStorageEmulator(storage, '127.0.0.1', 9198);
  }
  return storage;
}
