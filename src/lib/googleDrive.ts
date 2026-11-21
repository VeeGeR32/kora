import type { FirebaseUserConfig } from '../types';
import { requestGoogleDriveAccessToken } from './firebase';

export interface DriveAudioFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
}

let cachedDriveToken: { token: string; expiresAt: number } | null = null;

export function getCachedDriveToken(): string | null {
  if (!cachedDriveToken) return null;
  if (Date.now() >= cachedDriveToken.expiresAt) {
    cachedDriveToken = null;
    return null;
  }
  return cachedDriveToken.token;
}

export function clearCachedDriveToken(): void {
  cachedDriveToken = null;
}

export async function ensureGoogleDriveToken(
  config?: FirebaseUserConfig | null,
  forceRefresh = false
): Promise<string> {
  if (!forceRefresh) {
    const existing = getCachedDriveToken();
    if (existing) return existing;
  }
  const token = await requestGoogleDriveAccessToken(config);
  // Google OAuth access tokens typically last 60 minutes; cache conservatively for 50 min
  cachedDriveToken = {
    token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };
  return token;
}

export async function listGoogleDriveAudioFiles(
  token: string,
  searchQuery = ''
): Promise<DriveAudioFile[]> {
  const cleanSearch = searchQuery.trim().replace(/'/g, "\\'");
  const mp3Clause = "(mimeType = 'audio/mpeg' or mimeType = 'audio/mp3' or name contains '.mp3')";
  const qParts = [mp3Clause, 'trashed = false'];
  if (cleanSearch) {
    qParts.push(`name contains '${cleanSearch}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '100',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    clearCachedDriveToken();
    throw new Error('Session Google Drive expirée — reconnecte Google Drive.');
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && /Drive API has not been used|accessNotConfigured/i.test(errText)) {
      throw new Error(
        'Active Google Drive API gratuitement dans Google Cloud Console (projet kora-d6019 → Bibliothèque → Google Drive API → Activer).'
      );
    }
    throw new Error(`Erreur Google Drive (HTTP ${res.status}) : ${errText.slice(0, 160)}`);
  }

  const data = (await res.json()) as {
    files?: { id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string }[];
  };

  return (data.files || [])
    .filter((f) => {
      const lower = (f.name || '').toLowerCase();
      return lower.endsWith('.mp3') || f.mimeType === 'audio/mpeg' || f.mimeType === 'audio/mp3';
    })
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType || 'audio/mpeg',
      sizeBytes: Number(f.size) || 0,
      modifiedTime: f.modifiedTime || '',
    }));
}

export async function downloadGoogleDriveAudioBlob(
  token: string,
  fileId: string
): Promise<Blob> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }
    );
    if (res.status === 401) {
      clearCachedDriveToken();
      throw new Error('Session Google Drive expirée — reconnecte Google Drive.');
    }
    if (!res.ok) {
      throw new Error(`Impossible de télécharger le fichier Drive (HTTP ${res.status})`);
    }
    return await res.blob();
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('Délai dépassé (25s) lors du téléchargement depuis Google Drive.');
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}
