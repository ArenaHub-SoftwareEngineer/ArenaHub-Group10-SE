import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { app, emulatorHost, useFirebaseEmulators } from './firebase';

let storage: FirebaseStorage | undefined;

export function getArenaStorage(): FirebaseStorage {
  if (!storage) {
    storage = getStorage(app);
    if (useFirebaseEmulators) connectStorageEmulator(storage, emulatorHost, 9198);
  }
  return storage;
}
