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
  searchQuery = '',
  pageToken?: string
): Promise<DriveAudioFile[]> {
  const { files } = await fetchGoogleDriveAudioPage(token, searchQuery, pageToken, 100);
  return files;
}

async function fetchGoogleDriveAudioPage(
  token: string,
  searchQuery = '',
  pageToken?: string,
  pageSize = 200
): Promise<{ files: DriveAudioFile[]; nextPageToken?: string }> {
  const cleanSearch = searchQuery.trim().replace(/'/g, "\\'");
  const mp3Clause = "(mimeType = 'audio/mpeg' or mimeType = 'audio/mp3' or name contains '.mp3')";
  const qParts = [mp3Clause, 'trashed = false'];
  if (cleanSearch) {
    qParts.push(`name contains '${cleanSearch}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: String(pageSize),
  });
  if (pageToken) {
    params.set('pageToken', pageToken);
  }

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
    nextPageToken?: string;
    files?: { id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string }[];
  };

  const files = (data.files || [])
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

  return { files, nextPageToken: data.nextPageToken };
}

/**
 * Fetches ALL MP3 files across all pages of Google Drive (fast metadata-only sync).
 */
export async function listAllGoogleDriveAudioFiles(
  token: string,
  searchQuery = '',
  onPageLoaded?: (totalSoFar: number) => void,
  maxPages = 10
): Promise<DriveAudioFile[]> {
  const all: DriveAudioFile[] = [];
  const seen = new Set<string>();
  let nextPageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await fetchGoogleDriveAudioPage(token, searchQuery, nextPageToken, 200);
    for (const f of res.files) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        all.push(f);
      }
    }
    onPageLoaded?.(all.length);
    if (!res.nextPageToken) break;
    nextPageToken = res.nextPageToken;
  }

  return all;
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
