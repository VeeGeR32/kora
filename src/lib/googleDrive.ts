import type { DriveSource, FirebaseUserConfig } from '../types';
import { getCurrentFirebaseIdToken, requestGoogleDriveAccessToken } from './firebase';

export interface DriveAudioFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
  parents?: string[];
  yearFolder?: string; // e.g. "2024/2025" from Drive folder "24/25"
  parentFolderId?: string;
  parentFolderName?: string; // Direct parent folder name when it is a song-specific folder
  driveSourceId?: string;
}

export interface PermanentDriveInfo {
  configured: boolean;
  serviceAccountEmail: string | null;
  hasSharedFiles: boolean;
  isLegacyOwner?: boolean;
}

/**
 * Extracts a clean Google Drive folder ID from any Drive folder link or raw folder ID.
 * Supports:
 * - https://drive.google.com/drive/folders/1AbCdEfG...
 * - https://drive.google.com/drive/u/0/folders/1AbCdEfG...
 * - https://drive.google.com/open?id=1AbCdEfG...
 * - Raw folder ID (15..80 chars)
 */
export function extractDriveFolderId(rawInput: string): string | null {
  const s = (rawInput || '').trim();
  if (!s) return null;
  if (s === 'root') return 'root';
  const folderPathMatch = s.match(/\/folders\/([A-Za-z0-9_-]{12,100})/);
  if (folderPathMatch) return folderPathMatch[1];
  const idParamMatch = s.match(/[?&]id=([A-Za-z0-9_-]{12,100})/);
  if (idParamMatch) return idParamMatch[1];
  if (/^[A-Za-z0-9_-]{15,100}$/.test(s)) return s;
  return null;
}

export async function verifyDriveFolderAccess(
  folderInput: string,
  config?: FirebaseUserConfig | null
): Promise<{
  ok: boolean;
  folderId: string | null;
  folderName: string | null;
  serviceAccountEmail: string | null;
  error?: string;
}> {
  const folderId = extractDriveFolderId(folderInput);
  if (!folderId) {
    return {
      ok: false,
      folderId: null,
      folderName: null,
      serviceAccountEmail: cachedPermanentInfo?.serviceAccountEmail || null,
      error: 'Colle un lien de dossier Google Drive valide (ex. https://drive.google.com/drive/folders/...)',
    };
  }
  const idToken = await getCurrentFirebaseIdToken(config);
  if (!idToken) {
    return {
      ok: false,
      folderId,
      folderName: null,
      serviceAccountEmail: null,
      error: 'Connecte-toi à ton compte Kora.',
    };
  }
  try {
    const res = await fetch(`/api/drive?folderId=${encodeURIComponent(folderId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      serviceAccountEmail?: string;
      folderAccessible?: boolean;
      folder?: { id: string; name: string };
      accessToken?: string;
      expiresIn?: number;
      error?: string;
    };
    if (data.accessToken) {
      cachedDriveToken = {
        token: data.accessToken,
        expiresAt: Date.now() + Math.max(300, (Number(data.expiresIn) || 3000) - 60) * 1000,
        permanent: true,
      };
    }
    if (!res.ok || !data.ok || !data.folderAccessible || !data.folder) {
      return {
        ok: false,
        folderId,
        folderName: null,
        serviceAccountEmail: data.serviceAccountEmail || cachedPermanentInfo?.serviceAccountEmail || null,
        error:
          data.error ||
          'Dossier inaccessible — partage-le en « Lecteur » avec le compte Kora puis réessaie.',
      };
    }
    return {
      ok: true,
      folderId: data.folder.id,
      folderName: data.folder.name,
      serviceAccountEmail: data.serviceAccountEmail || null,
    };
  } catch (err) {
    return {
      ok: false,
      folderId,
      folderName: null,
      serviceAccountEmail: cachedPermanentInfo?.serviceAccountEmail || null,
      error: (err as Error)?.message || 'Erreur réseau lors de la vérification du dossier Drive.',
    };
  }
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
  isLegacyOwner?: boolean;
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
      isLegacyOwner?: boolean;
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
      isLegacyOwner: Boolean(data.isLegacyOwner),
    };

    return {
      available: true,
      configured: true,
      serviceAccountEmail: data.serviceAccountEmail || null,
      hasSharedFiles: Boolean(data.hasSharedFiles),
      isLegacyOwner: Boolean(data.isLegacyOwner),
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

const GENERIC_CONTAINER_FOLDER_RE =
  /^(?:sons?|musiques?|music|audio|mp3|wav|exports?|bounces?|renders?|mix(?:es)?|masters?|maquettes?|d[eé]mos?|projets?|projects?|rowav|_rowav_data|kora|google\s*drive|mon\s*drive|my\s*drive|studio|tracks?|morceaux?|nouveau\s*dossier|untitled\s*folder|archives?|corbeille|trash|backups?|recs?|enregistrements?|voix|vocals?|stems?|en\s*vrac|vrac|divers|autres?|other|misc|inbox|to\s*sort|[aà]\s*trier)$/i;

const GENERIC_PROJECT_FILENAME_RE =
  /^(?:(?:nouveau[\s_-]+|new[\s_-]+)?(?:proj(?:et|ect)?|prj)(?:[\s_-]*\d+(?:$|[\s._-].*)|$)|(?:sans[\s_-]*titre|untitled|audio|track|song|session|export|bounce|render|rec(?:ording)?|flp|ableton)(?:[\s_-]*\d+(?:$|[\s._-].*)|$)|\d{1,4}(?:$|[\s._-].*))$/i;

/**
 * Returns true if an audio filename is a generic DAW/project name (e.g. "projet 12.mp3",
 * "Project_306_v2.mp3", "projet42_prod.mp3", "Sans titre 3.mp3") rather than a real song title.
 */
export function isGenericProjectFilename(filename: string): boolean {
  let clean = (filename || '')
    .replace(/\.(mp3|wav|m4a|flac|aac|ogg)$/i, '')
    .trim();
  clean = clean.replace(/^(?:copie\s+de\s+|copy\s+of\s+)/i, '').trim();
  if (!clean) return true;
  return GENERIC_PROJECT_FILENAME_RE.test(clean);
}

export function isGenericContainerFolderName(folderName: string): boolean {
  const clean = (folderName || '').trim();
  if (!clean || clean.length < 2) return true;
  if (parseDriveYearFolderName(clean)) return true;
  if (EXCLUDED_FOLDER_REGEX.test(clean)) return true;
  return GENERIC_CONTAINER_FOLDER_RE.test(clean);
}

interface DriveFolderIndex {
  excludedFolders: Set<string>;
  yearByFolderId: Map<string, string>;
  folderNameById: Map<string, string>;
  childrenByParent: Map<string, string[]>;
}

/**
 * Indexes all Google Drive folders to:
 * 1) Exclude drumkit / prods / beats / instrus folders + all their subfolders.
 * 2) Map every folder (and its nested subfolders) to its ancestor year/season folder (e.g. "24/25" -> "2024/2025").
 * 3) Keep each folder's own name so generic "projetXX.mp3" files inside a song-named folder inherit the song title.
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
  const folderNameById = new Map<string, string>();
  const childrenByParent = new Map<string, string[]>();

  for (const folder of allFolders) {
    if (folder.name) {
      folderNameById.set(folder.id, folder.name.trim());
    }
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

  return { excludedFolders, yearByFolderId, folderNameById, childrenByParent };
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
  maxPages = 10,
  driveSources?: DriveSource[]
): Promise<{ files: DriveAudioFile[]; excludedFileIds: string[] }> {
  const { excludedFolders, yearByFolderId, folderNameById, childrenByParent } =
    await buildDriveFolderIndex(token);

  // Build folderId -> driveSourceId map when explicit folder sources are configured
  const explicitSources = (driveSources || []).filter(
    (s) => s.folderId && s.folderId !== 'root'
  );
  const explicitSourceRootIds = new Set(explicitSources.map((s) => s.folderId));
  const hasRootSource = (driveSources || []).some((s) => s.folderId === 'root');
  const rootSourceId = (driveSources || []).find((s) => s.folderId === 'root')?.id;

  const sourceIdByFolderId = new Map<string, string>();
  if (explicitSources.length > 0) {
    for (const src of explicitSources) {
      const q = [src.folderId];
      sourceIdByFolderId.set(src.folderId, src.id);
      while (q.length > 0) {
        const cur = q.shift()!;
        const kids = childrenByParent.get(cur);
        if (!kids) continue;
        for (const kid of kids) {
          if (!sourceIdByFolderId.has(kid)) {
            sourceIdByFolderId.set(kid, src.id);
            q.push(kid);
          }
        }
      }
    }
  }

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
        continue;
      }

      let matchedSourceId: string | undefined;
      if (explicitSources.length > 0) {
        for (const pid of f.parents || []) {
          const sid = sourceIdByFolderId.get(pid);
          if (sid) {
            matchedSourceId = sid;
            break;
          }
        }
        if (!matchedSourceId && hasRootSource) {
          matchedSourceId = rootSourceId;
        }
        if (!matchedSourceId) {
          // Belongs to a folder not connected to this user's active DriveSources -> exclude!
          excludedFileIds.push(f.id);
          continue;
        }
      } else if (rootSourceId) {
        matchedSourceId = rootSourceId;
      }

      const directParentId = f.parents?.[0];
      const rawParentName = directParentId ? folderNameById.get(directParentId) : undefined;
      const validSongFolderName =
        directParentId &&
        rawParentName &&
        !explicitSourceRootIds.has(directParentId) &&
        !isGenericContainerFolderName(rawParentName)
          ? rawParentName
          : undefined;

      all.push({
        ...f,
        yearFolder: resolveFileYearFolder(f.parents, yearByFolderId),
        parentFolderId: directParentId,
        parentFolderName: validSongFolderName,
        driveSourceId: matchedSourceId,
      });
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
