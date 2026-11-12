/**
 * ArenaHub — Firebase SDK initialization
 *
 * Reads config from Vite env vars (VITE_FIREBASE_*).
 * Copy .env.example → .env and fill in your Firebase project values.
 *
 * If the env vars are missing or empty, provides a valid fallback so
 * the UI loads cleanly without throwing synchronous initialization errors.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, Firestore, connectFirestoreEmulator } from 'firebase/firestore';

const rawApiKey = (import.meta.env.VITE_FIREBASE_API_KEY || '').trim();
const rawProjectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();

// Track whether Firebase is configured with real non-placeholder credentials
export const isFirebaseConfigured = Boolean(
  rawApiKey &&
  rawProjectId &&
  !rawApiKey.includes('Placeholder') &&
  !rawApiKey.includes('placeholder')
);

// Firebase SDK requires apiKey to be a non-empty string without colon (':')
const fallbackKey = 'AIzaSyPlaceholderKeyForArenaHubDemo';

const firebaseConfig = {
  apiKey: rawApiKey || fallbackKey,
  authDomain:
    (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim() ||
    `${rawProjectId || 'arenahub-demo'}.firebaseapp.com`,
  projectId: rawProjectId || 'arenahub-demo',
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim() ||
    `${rawProjectId || 'arenahub-demo'}.appspot.com`,
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim() ||
    '123456789012',
  appId:
    (import.meta.env.VITE_FIREBASE_APP_ID || '').trim() ||
    '1:123456789012:web:arenahubdemounit',
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

try {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (err) {
  console.warn('[ArenaHub] Firebase initialization notice:', err);
  // Ensure app and auth exist
  app = getApps().length > 0 ? getApp() : initializeApp({
    apiKey: fallbackKey,
    projectId: 'arenahub-demo',
  });
  auth = getAuth(app);
  db = getFirestore(app);
}

if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === 'true' && rawProjectId === 'demo-arenahub') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9098', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
}

export { app, auth, db };
