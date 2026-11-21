import type { FirebaseUserConfig } from '../types';
import { getCurrentFirebaseIdToken, requestGoogleDriveAccessToken } from './firebase';

export interface DriveAudioFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
  parents?: string[];
}

export interface PermanentDriveInfo {
  configured: boolean;
  serviceAccountEmail: string | null;
  hasSharedFiles: boolean;
}

export class DrivePermanentSetupRequiredError extends Error {
  serviceAccountEmail: string;
  constructor(email: string) {
    super(
      `Partage ton dossier MP3 sur Google Drive avec ${email} (une seule fois) pour ne plus jamais te reconnecter.`
    );
    this.name = 'DrivePermanentSetupRequiredError';
    this.serviceAccountEmail = email;
  }
}

let cachedDriveToken: { token: string; expiresAt: number; permanent: boolean } | null = null;
let cachedPermanentInfo: PermanentDriveInfo | null = null;

export function getCachedDriveToken(): string | null {
  if (!cachedDriveToken) return null;
  if (Date.now() >= cachedDriveToken.expiresAt) {
    cachedDriveToken = null;
    return null;
  }
  return cachedDriveToken.token;
}

export function getCachedPermanentDriveInfo(): PermanentDriveInfo | null {
  return cachedPermanentInfo;
}

export function clearCachedDriveToken(): void {
  cachedDriveToken = null;
}

export async function fetchPermanentDriveSession(
  config?: FirebaseUserConfig | null
): Promise<{
  available: boolean;
  configured: boolean;
  serviceAccountEmail: string | null;
  hasSharedFiles: boolean;
  accessToken: string | null;
  expiresIn: number;
  error?: string;
}> {
  const idToken = await getCurrentFirebaseIdToken(config);
  if (!idToken) {
    return {
      available: false,
      configured: false,
      serviceAccountEmail: null,
      hasSharedFiles: false,
      accessToken: null,
      expiresIn: 0,
    };
  }

  try {
    const res = await fetch('/api/drive', {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        available: false,
        configured: false,
        serviceAccountEmail: null,
        hasSharedFiles: false,
        accessToken: null,
        expiresIn: 0,
      };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      configured?: boolean;
      serviceAccountEmail?: string;
      hasSharedFiles?: boolean;
      accessToken?: string;
      expiresIn?: number;
      error?: string;
    };

    if (!res.ok || !data.ok) {
      return {
        available: res.status !== 404 && res.status !== 503,
        configured: Boolean(data.configured),
        serviceAccountEmail: data.serviceAccountEmail || null,
        hasSharedFiles: false,
        accessToken: null,
        expiresIn: 0,
        error: data.error,
      };
    }

    cachedPermanentInfo = {
      configured: true,
      serviceAccountEmail: data.serviceAccountEmail || null,
      hasSharedFiles: Boolean(data.hasSharedFiles),
    };

    return {
      available: true,
      configured: true,
      serviceAccountEmail: data.serviceAccountEmail || null,
      hasSharedFiles: Boolean(data.hasSharedFiles),
      accessToken: data.accessToken || null,
      expiresIn: Number(data.expiresIn) || 3000,
    };
  } catch {
    return {
      available: false,
      configured: false,
      serviceAccountEmail: null,
      hasSharedFiles: false,
      accessToken: null,
      expiresIn: 0,
    };
  }
}

export async function ensureGoogleDriveToken(
  config?: FirebaseUserConfig | null,
  forceRefresh = false,
  allowLegacyPopupFallback = false
): Promise<string> {
  if (!forceRefresh) {
    const existing = getCachedDriveToken();
    if (existing) return existing;
  }

  // 1. Always try Permanent Zero-Popup Drive Access first (works forever on all devices!)
  const perm = await fetchPermanentDriveSession(config);
  if (perm.configured && perm.hasSharedFiles && perm.accessToken) {
    cachedDriveToken = {
      token: perm.accessToken,
      expiresAt: Date.now() + Math.max(300, perm.expiresIn - 60) * 1000,
      permanent: true,
    };
    return perm.accessToken;
  }

  if (perm.configured && !perm.hasSharedFiles && perm.serviceAccountEmail && !allowLegacyPopupFallback) {
    throw new DrivePermanentSetupRequiredError(perm.serviceAccountEmail);
  }

  if (perm.available && perm.error && !allowLegacyPopupFallback) {
    throw new Error(perm.error);
  }

  // 2. Fallback to legacy OAuth popup only in local dev or when explicitly requested
  const token = await requestGoogleDriveAccessToken(config);
  cachedDriveToken = {
    token,
    expiresAt: Date.now() + 50 * 60 * 1000,
    permanent: false,
  };
  return token;
}

const EXCLUDED_FOLDER_REGEX = /drum[\s_-]*kits?/i;

/**
 * Finds all Google Drive folder IDs named "drumkit" (case-insensitive)
 * plus every nested subfolder inside them so drum samples are excluded from Music.
 */
async function getExcludedDrumkitFolderIds(token: string): Promise<Set<string>> {
  const allFolders: { id: string; name: string; parents?: string[] }[] = [];
  let nextPageToken: string | undefined;

  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'nextPageToken,files(id,name,parents)',
      pageSize: '200',
    });
    if (nextPageToken) params.set('pageToken', nextPageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: { id: string; name: string; parents?: string[] }[];
    };
    if (data.files) allFolders.push(...data.files);
    if (!data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }

  const excluded = new Set<string>();
  const childrenByParent = new Map<string, string[]>();

  for (const folder of allFolders) {
    if (EXCLUDED_FOLDER_REGEX.test(folder.name || '')) {
      excluded.add(folder.id);
    }
    if (folder.parents) {
      for (const pid of folder.parents) {
        const list = childrenByParent.get(pid);
        if (list) list.push(folder.id);
        else childrenByParent.set(pid, [folder.id]);
      }
    }
  }

  // BFS to include every subfolder nested inside any drumkit folder
  const queue = Array.from(excluded);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const kids = childrenByParent.get(cur);
    if (!kids) continue;
    for (const kid of kids) {
      if (!excluded.has(kid)) {
        excluded.add(kid);
        queue.push(kid);
      }
    }
  }

  return excluded;
}

export async function listGoogleDriveAudioFiles(
  token: string,
  searchQuery = '',
  pageToken?: string
): Promise<DriveAudioFile[]> {
  const [excludedFolders, page] = await Promise.all([
    getExcludedDrumkitFolderIds(token),
    fetchGoogleDriveAudioPage(token, searchQuery, pageToken, 100),
  ]);
  return page.files.filter(
    (f) => !f.parents?.some((pid) => excludedFolders.has(pid))
  );
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
    fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)',
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
    files?: {
      id: string;
      name: string;
      mimeType?: string;
      size?: string;
      modifiedTime?: string;
      parents?: string[];
    }[];
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
      parents: f.parents,
    }));

  return { files, nextPageToken: data.nextPageToken };
}

/**
 * Fetches ALL MP3 files across all pages of Google Drive (excluding any drumkit folders & subfolders).
 */
export async function listAllGoogleDriveAudioFiles(
  token: string,
  searchQuery = '',
  onPageLoaded?: (totalSoFar: number) => void,
  maxPages = 10
): Promise<DriveAudioFile[]> {
  const { files } = await listAllGoogleDriveAudioFilesWithExclusions(
    token,
    searchQuery,
    onPageLoaded,
    maxPages
  );
  return files;
}

export async function listAllGoogleDriveAudioFilesWithExclusions(
  token: string,
  searchQuery = '',
  onPageLoaded?: (totalSoFar: number) => void,
  maxPages = 10
): Promise<{ files: DriveAudioFile[]; excludedFileIds: string[] }> {
  const excludedFolders = await getExcludedDrumkitFolderIds(token);
  const all: DriveAudioFile[] = [];
  const excludedFileIds: string[] = [];
  const seen = new Set<string>();
  let nextPageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await fetchGoogleDriveAudioPage(token, searchQuery, nextPageToken, 200);
    for (const f of res.files) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      if (f.parents?.some((pid) => excludedFolders.has(pid))) {
        excludedFileIds.push(f.id);
      } else {
        all.push(f);
      }
    }
    onPageLoaded?.(all.length);
    if (!res.nextPageToken) break;
    nextPageToken = res.nextPageToken;
  }

  return { files: all, excludedFileIds };
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
