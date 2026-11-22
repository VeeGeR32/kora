import type { FirebaseUserConfig } from '../types';
import { getCurrentFirebaseIdToken, requestGoogleDriveAccessToken } from './firebase';

export interface DriveAudioFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
  parents?: string[];
  yearFolder?: string; // e.g. "2024/2025" from Drive folder "24/25"
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

const EXCLUDED_FOLDER_REGEX =
  /(?:drum[\s_-]*kits?|\bprods?\b|\binstrus?\b|\binstrumentals?\b|\bbeats?\b|\btype[\s_-]*beats?\b|\bsamples?\b)/i;

// Excludes downloaded YouTube type beats / free beats / generic instrumentals,
// while KEEPING song-specific `*_prod.mp3` files (e.g. "Project_306_prod.mp3", "FOLIE_prod.mp3")
// so the user can launch a track's linked prod directly!
const EXCLUDED_PROD_FILENAME_REGEX =
  /(?:ytmp3(?:free)?|y2mate|notube|mp3juice|ssyoutube|savefrom|type[\s_-]*beat|free[\s_-]+(?:for[\s_-]+profit|beat)|\[[\s]*free[\s]*\]|\([\s]*free[\s]*\)|^free[\s_-]+)/i;

/**
 * Returns true if a filename or track title looks like a downloaded YouTube type beat / free beat.
 */
export function isExcludedProdName(raw: string): boolean {
  if (!raw) return false;
  return EXCLUDED_PROD_FILENAME_REGEX.test(raw.trim());
}

/**
 * Parses Google Drive year/season folder names like:
 * - "23/24", "24/25", "25/26", "26/27" -> "2023/2024", "2024/2025", "2025/2026", "2026/2027"
 * - "2024/2025", "2024-2025" -> "2024/2025"
 * - "2024", "2025" -> "2024", "2025"
 */
export function parseDriveYearFolderName(folderName: string): string | null {
  const clean = (folderName || '').trim();
  const rangeMatch = clean.match(/^(?:20)?(\d{2})\s*[/\-_]\s*(?:20)?(\d{2})$/);
  if (rangeMatch) {
    const y1 = 2000 + parseInt(rangeMatch[1], 10);
    const y2 = 2000 + parseInt(rangeMatch[2], 10);
    if (y1 >= 2010 && y1 <= 2099 && y2 >= y1 && y2 <= y1 + 2) {
      return `${y1}/${y2}`;
    }
  }
  const singleMatch = clean.match(/^(20\d{2})$/);
  if (singleMatch) {
    return singleMatch[1];
  }
  return null;
}

interface DriveFolderIndex {
  excludedFolders: Set<string>;
  yearByFolderId: Map<string, string>;
}

/**
 * Indexes all Google Drive folders to:
 * 1) Exclude drumkit / prods / beats / instrus folders + all their subfolders.
 * 2) Map every folder (and its nested subfolders) to its ancestor year/season folder (e.g. "24/25" -> "2024/2025").
 */
async function buildDriveFolderIndex(token: string): Promise<DriveFolderIndex> {
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

  const excludedFolders = new Set<string>();
  const yearByFolderId = new Map<string, string>();
  const childrenByParent = new Map<string, string[]>();

  for (const folder of allFolders) {
    if (EXCLUDED_FOLDER_REGEX.test(folder.name || '')) {
      excludedFolders.add(folder.id);
    }
    const yearLabel = parseDriveYearFolderName(folder.name || '');
    if (yearLabel) {
      yearByFolderId.set(folder.id, yearLabel);
    }
    if (folder.parents) {
      for (const pid of folder.parents) {
        const list = childrenByParent.get(pid);
        if (list) list.push(folder.id);
        else childrenByParent.set(pid, [folder.id]);
      }
    }
  }

  // BFS to propagate exclusions to all nested subfolders
  const exclQueue = Array.from(excludedFolders);
  while (exclQueue.length > 0) {
    const cur = exclQueue.shift()!;
    const kids = childrenByParent.get(cur);
    if (!kids) continue;
    for (const kid of kids) {
      if (!excludedFolders.has(kid)) {
        excludedFolders.add(kid);
        exclQueue.push(kid);
      }
    }
  }

  // BFS to propagate year/season label to all nested subfolders inside "24/25", "25/26", etc.
  const yearQueue = Array.from(yearByFolderId.entries());
  while (yearQueue.length > 0) {
    const [curId, label] = yearQueue.shift()!;
    const kids = childrenByParent.get(curId);
    if (!kids) continue;
    for (const kid of kids) {
      if (!yearByFolderId.has(kid)) {
        yearByFolderId.set(kid, label);
        yearQueue.push([kid, label]);
      }
    }
  }

  return { excludedFolders, yearByFolderId };
}

function resolveFileYearFolder(
  parents: string[] | undefined,
  yearByFolderId: Map<string, string>
): string | undefined {
  if (!parents) return undefined;
  for (const pid of parents) {
    const found = yearByFolderId.get(pid);
    if (found) return found;
  }
  return undefined;
}

export async function listGoogleDriveAudioFiles(
  token: string,
  searchQuery = '',
  pageToken?: string
): Promise<DriveAudioFile[]> {
  const [folderIdx, page] = await Promise.all([
    buildDriveFolderIndex(token),
    fetchGoogleDriveAudioPage(token, searchQuery, pageToken, 100),
  ]);
  return page.files
    .filter(
      (f) =>
        !f.parents?.some((pid) => folderIdx.excludedFolders.has(pid)) &&
        !isExcludedProdName(f.name)
    )
    .map((f) => ({
      ...f,
      yearFolder: resolveFileYearFolder(f.parents, folderIdx.yearByFolderId),
    }));
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
  const { excludedFolders, yearByFolderId } = await buildDriveFolderIndex(token);
  const all: DriveAudioFile[] = [];
  const excludedFileIds: string[] = [];
  const seen = new Set<string>();
  let nextPageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await fetchGoogleDriveAudioPage(token, searchQuery, nextPageToken, 200);
    for (const f of res.files) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      if (f.parents?.some((pid) => excludedFolders.has(pid)) || isExcludedProdName(f.name)) {
        excludedFileIds.push(f.id);
      } else {
        all.push({
          ...f,
          yearFolder: resolveFileYearFolder(f.parents, yearByFolderId),
        });
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
  fileId: string,
  externalSignal?: AbortSignal
): Promise<Blob> {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 25_000);
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
      if (!timedOut) throw err; // Cancelled intentionally because user switched tracks
      throw new Error('Délai dépassé (25s) lors du téléchargement depuis Google Drive.');
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}
