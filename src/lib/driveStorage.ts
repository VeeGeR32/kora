import type { FirebaseUserConfig } from '../types';
import { getCurrentFirebaseIdToken, getEnvFirebaseConfig } from './firebase';

export const PRIMARY_DRIVE_FOLDER_KEY = 'rowav_primary_drive_folder_id';

export function getCachedPrimaryDriveFolderId(): string | null {
  try {
    return localStorage.getItem(PRIMARY_DRIVE_FOLDER_KEY) || null;
  } catch {
    return null;
  }
}

export function setCachedPrimaryDriveFolderId(folderId: string | null) {
  try {
    if (folderId) localStorage.setItem(PRIMARY_DRIVE_FOLDER_KEY, folderId);
    else localStorage.removeItem(PRIMARY_DRIVE_FOLDER_KEY);
  } catch {
    // ignore storage errors
  }
}

export async function uploadCoverToUserDrive(
  folderId: string,
  dataUrl: string,
  name?: string,
  firebaseConfig?: FirebaseUserConfig | null
): Promise<{ ok: boolean; url?: string; readonly?: boolean; error?: string }> {
  try {
    const resolved = firebaseConfig?.apiKey ? firebaseConfig : getEnvFirebaseConfig();
    const idToken = await getCurrentFirebaseIdToken(resolved);
    if (!idToken) return { ok: false, error: 'Non connecté' };

    const res = await fetch('/api/drive-storage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        action: 'upload_cover',
        folderId,
        dataUrl,
        name: name || `cover_${Date.now()}`,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        readonly: Boolean(data?.readonly),
        error: data?.error || 'Upload Drive impossible',
      };
    }
    return { ok: true, url: data.url };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Erreur réseau Drive' };
  }
}

export async function syncStudioBackupToUserDrive(
  folderId: string,
  payload: {
    profile: Record<string, unknown>;
    musicProjects: unknown[];
    playlists: unknown[];
    lyricsFolders: unknown[];
    lyricsDocs: unknown[];
  },
  firebaseConfig?: FirebaseUserConfig | null
): Promise<{ ok: boolean; readonly?: boolean; syncedAt?: string; error?: string }> {
  try {
    const resolved = firebaseConfig?.apiKey ? firebaseConfig : getEnvFirebaseConfig();
    const idToken = await getCurrentFirebaseIdToken(resolved);
    if (!idToken) return { ok: false, error: 'Non connecté' };

    const res = await fetch('/api/drive-storage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        action: 'sync_studio_data',
        folderId,
        ...payload,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        readonly: Boolean(data?.readonly),
        error: data?.error || 'Sauvegarde Drive impossible',
      };
    }
    return { ok: true, syncedAt: data.syncedAt };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Erreur réseau Drive' };
  }
}
