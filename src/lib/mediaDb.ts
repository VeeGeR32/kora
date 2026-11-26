/**
 * Local IndexedDB media store for Kora.
 * Stores heavy binary blobs (MP3 audio, album covers, PDF course docs, photos)
 * so the app stays instant and works offline without hitting localStorage's 5 MB limit.
 */

const DB_NAME = 'kora_media_db_v1';
const STORE_NAME = 'blobs';

export const OFFLINE_TRACK_PREFIX = 'offline_trk_';

export function getOfflineTrackKey(trackId: string): string {
  return `${OFFLINE_TRACK_PREFIX}${trackId}`;
}

export interface StoredMedia {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
const objectUrlCache = new Map<string, string>();

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function saveMediaBlob(id: string, file: Blob, name = 'file'): Promise<StoredMedia> {
  const db = await openDb();
  const entry: StoredMedia = {
    id,
    blob: file,
    name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    createdAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Refresh object URL cache if previously loaded
  const existingUrl = objectUrlCache.get(id);
  if (existingUrl) {
    URL.revokeObjectURL(existingUrl);
    objectUrlCache.delete(id);
  }
  return entry;
}

export async function getMediaBlob(id: string): Promise<StoredMedia | null> {
  try {
    const db = await openDb();
    return await new Promise<StoredMedia | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as StoredMedia) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getMediaObjectUrl(id: string): Promise<string | null> {
  const cached = objectUrlCache.get(id);
  if (cached) return cached;
  const item = await getMediaBlob(id);
  if (!item) return null;
  const url = URL.createObjectURL(item.blob);
  objectUrlCache.set(id, url);
  return url;
}

export async function deleteMediaBlob(id: string): Promise<void> {
  try {
    const existingUrl = objectUrlCache.get(id);
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl);
      objectUrlCache.delete(id);
    }
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore deletion errors
  }
}

export async function listOfflineMediaMeta(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const key = String(cursor.key || '');
        if (key.startsWith(OFFLINE_TRACK_PREFIX)) {
          const val = cursor.value as StoredMedia | undefined;
          const trackId = key.slice(OFFLINE_TRACK_PREFIX.length);
          result[trackId] = val?.size || val?.blob?.size || 0;
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore IDB read issues (e.g. private browsing)
  }
  return result;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
