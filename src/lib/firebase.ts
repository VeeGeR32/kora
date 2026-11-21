import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  initializeFirestore,
  getFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import type { AppState, FirebaseUserConfig } from '../types';

export interface FirebaseBundle {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
}

let activeBundle: FirebaseBundle | null = null;
let activeConfigKey = '';

export function getEnvFirebaseConfig(): FirebaseUserConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket:
      (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || `${projectId}.firebasestorage.app`,
    messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || '',
    appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || '',
  };
}

/**
 * Parses either strict JSON or raw JS snippet copied from Firebase Console:
 * e.g. `const firebaseConfig = { apiKey: "...", projectId: "..." };`
 */
export function parseFirebaseConfigSnippet(raw: string): FirebaseUserConfig | null {
  const extract = (key: string): string => {
    const re = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`);
    return raw.match(re)?.[1]?.trim() || '';
  };
  const apiKey = extract('apiKey');
  const projectId = extract('projectId');
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    projectId,
    authDomain: extract('authDomain') || `${projectId}.firebaseapp.com`,
    storageBucket: extract('storageBucket') || `${projectId}.firebasestorage.app`,
    messagingSenderId: extract('messagingSenderId'),
    appId: extract('appId'),
  };
}

export function initFirebaseClient(config?: FirebaseUserConfig | null): FirebaseBundle | null {
  const resolved = config?.apiKey && config?.projectId ? config : getEnvFirebaseConfig();
  if (!resolved) return null;

  const key = `${resolved.projectId}:${resolved.apiKey}`;
  if (activeBundle && activeConfigKey === key) return activeBundle;

  try {
    const existing = getApps()[0];
    let app: FirebaseApp;
    if (existing && activeConfigKey === key) {
      app = existing;
    } else {
      if (existing) {
        void deleteApp(existing);
      }
      app = initializeApp(resolved);
    }

    let db: Firestore;
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      db = getFirestore(app);
    }

    const auth = getAuth(app);
    const storage = getStorage(app);

    activeBundle = { app, auth, db, storage };
    activeConfigKey = key;
    return activeBundle;
  } catch (err) {
    console.error('[Kora Firebase] Init error:', err);
    return null;
  }
}

export async function signInWithGoogle(config?: FirebaseUserConfig | null): Promise<User | null> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(bundle.auth, provider);
  return res.user;
}

export async function signInWithEmail(
  config: FirebaseUserConfig | null | undefined,
  email: string,
  password: string
): Promise<User> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const res = await signInWithEmailAndPassword(bundle.auth, email.trim(), password);
  return res.user;
}

export async function signUpWithEmail(
  config: FirebaseUserConfig | null | undefined,
  email: string,
  password: string
): Promise<User> {
  const bundle = initFirebaseClient(config);
  if (!bundle) throw new Error('Configuration Firebase manquante');
  const res = await createUserWithEmailAndPassword(bundle.auth, email.trim(), password);
  return res.user;
}

export async function signOutFirebase(config?: FirebaseUserConfig | null): Promise<void> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return;
  await signOut(bundle.auth);
}

export function listenAuthState(
  config: FirebaseUserConfig | null | undefined,
  cb: (user: User | null) => void
): () => void {
  const bundle = initFirebaseClient(config);
  if (!bundle) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(bundle.auth, cb);
}

/** Deeply removes all `undefined` values because Firestore rejects `undefined` fields */
function sanitizeForFirestore<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

export function formatFirebaseSyncError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code || '';
  const msg = e?.message || String(err || 'Erreur inconnue');
  if (code === 'permission-denied' || /permission|insufficient/i.test(msg)) {
    return 'Accès Firestore refusé (permission-denied) : publie les dernières règles firestore.rules dans Firebase Console → Firestore Database → Règles.';
  }
  if (code === 'unavailable' || /offline|network/i.test(msg)) {
    return 'Hors ligne : les modifications seront synchronisées dès le retour du réseau.';
  }
  return msg;
}

export async function fetchCloudStateOnce(
  config: FirebaseUserConfig | null | undefined,
  uid: string
): Promise<AppState | null> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return null;
  const refDoc = doc(bundle.db, 'users', uid, 'appState', 'main');
  const snap = await getDoc(refDoc);
  if (!snap.exists()) return null;
  return snap.data() as AppState;
}

export async function pushStateToCloud(
  config: FirebaseUserConfig | null | undefined,
  uid: string,
  state: AppState
): Promise<number> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return state.updatedAt || Date.now();
  const refDoc = doc(bundle.db, 'users', uid, 'appState', 'main');
  const ts = state.updatedAt && state.updatedAt >= 1577836800000 ? state.updatedAt : Date.now();
  const cleanPayload = sanitizeForFirestore({
    ...state,
    updatedAt: ts,
  });
  await setDoc(refDoc, cleanPayload);
  return ts;
}

export function subscribeCloudState(
  config: FirebaseUserConfig | null | undefined,
  uid: string,
  onRemoteState: (remote: AppState, meta: { fromCache: boolean }) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const bundle = initFirebaseClient(config);
  if (!bundle) return () => {};
  const refDoc = doc(bundle.db, 'users', uid, 'appState', 'main');
  return onSnapshot(
    refDoc,
    (snap) => {
      if (!snap.exists()) return;
      if (snap.metadata.hasPendingWrites) return;
      const data = snap.data() as AppState;
      if (data && typeof data === 'object') {
        onRemoteState(data, { fromCache: snap.metadata.fromCache });
      }
    },
    (err) => {
      console.error('[Kora Sync] Snapshot error:', err);
      onError?.(err);
    }
  );
}

export async function uploadCloudMedia(
  config: FirebaseUserConfig | null | undefined,
  uid: string,
  mediaId: string,
  blob: Blob
): Promise<string | null> {
  const bundle = initFirebaseClient(config);
  if (!bundle) return null;
  const storageRef = ref(bundle.storage, `users/${uid}/media/${mediaId}`);
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'application/octet-stream' });
  return await getDownloadURL(storageRef);
}
