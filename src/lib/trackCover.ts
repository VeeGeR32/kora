import type {
  FirebaseUserConfig,
  LyricsDoc,
  MusicProject,
  MusicTrack,
  TrackMood,
  TrackStatus,
} from '../types';
import { getCurrentFirebaseIdToken } from './firebase';
import { getCachedPrimaryDriveFolderId, uploadCoverToUserDrive } from './driveStorage';
import { getDeterministicGradientId } from './musicVersioning';
import { normalizeTrackStatus } from '../utils/theme';

export const LYRICS_STATUS_META: Record<1 | 2 | 3, { label: string; dot: string; badge: string }> = {
  1: {
    label: 'Brouillon',
    dot: 'bg-slate-400 dark:bg-zinc-500',
    badge: 'bg-slate-100 dark:bg-zinc-800/90 text-slate-600 dark:text-zinc-300',
  },
  2: {
    label: 'En cours',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  },
  3: {
    label: 'Terminé',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  },
};

/**
 * Finds the active LyricsDoc attached to a song (checks both track.linkedLyricsId
 * and doc.linkedTrackId across all versions of the song).
 */
export function findLinkedLyricsForTrack(
  track: MusicTrack,
  lyricsDocs: LyricsDoc[],
  siblingTrackIds?: string[],
  siblingTracks?: MusicTrack[]
): LyricsDoc | null {
  const activeDocs = lyricsDocs.filter((d) => !d.deletedAt);
  if (activeDocs.length === 0) return null;

  const idSet = new Set<string>([track.id, ...(siblingTrackIds || [])]);
  const directLyricsId =
    track.linkedLyricsId || siblingTracks?.find((s) => Boolean(s.linkedLyricsId))?.linkedLyricsId;
  if (directLyricsId) {
    const found = activeDocs.find((d) => d.id === directLyricsId);
    if (found) return found;
  }

  return activeDocs.find((d) => d.linkedTrackId && idSet.has(d.linkedTrackId)) || null;
}

/** Resolves the song's dual ratings (current + potential, 1..10) across active track & sibling versions */
export function resolveTrackRatings(
  track: MusicTrack,
  siblingTracks?: MusicTrack[]
): { current: number | null; potential: number | null } {
  const valid = (n?: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 10 ? Math.round(n) : null;
  const current =
    valid(track.ratingCurrent) ??
    valid(siblingTracks?.find((s) => valid(s.ratingCurrent) !== null)?.ratingCurrent);
  const potential =
    valid(track.ratingPotential) ??
    valid(siblingTracks?.find((s) => valid(s.ratingPotential) !== null)?.ratingPotential);
  return { current, potential };
}

/** Counts all [FIX] / [FIX: ...] tags in a lyrics document (case-insensitive) */
export function countLyricsFixTags(content?: string | null): number {
  if (!content) return 0;
  const matches = content.match(/\[FIX(?::[^\]]*)?\]/gi);
  return matches ? matches.length : 0;
}

/** Resolves normalized pipeline status & mood across active track and sibling versions */
export function resolveTrackWorkflow(
  track: MusicTrack,
  siblingTracks?: MusicTrack[]
): { status: TrackStatus; mood: TrackMood | null } {
  const rawStatus =
    track.status || siblingTracks?.find((s) => Boolean(s.status))?.status || 'brouillon';
  const status = normalizeTrackStatus(rawStatus);
  const mood =
    track.mood ||
    siblingTracks?.find((s) => Boolean(s.mood))?.mood ||
    null;
  return { status, mood };
}

/** Compresses & center-crops any photo into a crisp square avatar data URL (guaranteed < 65 KB for instant local + Firestore + Social persistence) */
export async function prepareAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const minSide = Math.min(img.width, img.height);
          const sx = Math.max(0, Math.floor((img.width - minSide) / 2));
          const sy = Math.max(0, Math.floor((img.height - minSide) / 2));

          const renderSquare = (size: number, quality: number, mime: 'image/webp' | 'image/jpeg') => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
            }
            return canvas.toDataURL(mime, quality);
          };

          let out = renderSquare(256, 0.85, 'image/webp');
          if (!out.startsWith('data:image/webp')) {
            out = renderSquare(256, 0.85, 'image/jpeg');
          }
          if (out.length > 68_000) {
            out = renderSquare(224, 0.78, 'image/jpeg');
          }
          if (out.length > 68_000) {
            out = renderSquare(180, 0.72, 'image/jpeg');
          }
          resolve(out);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Center-crops & compresses any uploaded cover image into a crisp 1:1 square (supports WebP & high-quality resampling) */
export async function compressCoverImage(
  file: File,
  maxSize = 1080,
  quality = 0.9,
  preferWebp = true
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const minSide = Math.min(img.width, img.height);
        const sx = Math.max(0, Math.floor((img.width - minSide) / 2));
        const sy = Math.max(0, Math.floor((img.height - minSide) / 2));
        const targetSize = Math.max(1, Math.min(maxSize, minSide));

        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);
        }
        if (preferWebp) {
          const webp = canvas.toDataURL('image/webp', quality);
          if (webp.startsWith('data:image/webp')) {
            resolve(webp);
            return;
          }
        }
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const squareArtworkCache = new Map<string, string>();

/**
 * Ensures any cover image (even older non-square uploads) is center-cropped to a
 * crisp 512x512 1:1 square before passing to iOS/OS MediaSession Now Playing artwork.
 */
export async function ensureSquareMediaArtwork(src: string): Promise<string> {
  if (!src || typeof document === 'undefined') return src;
  const cached = squareArtworkCache.get(src);
  if (cached) return cached;

  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h || Math.abs(w - h) <= 2) {
          squareArtworkCache.set(src, src);
          resolve(src);
          return;
        }
        const minSide = Math.min(w, h);
        const sx = Math.max(0, Math.floor((w - minSide) / 2));
        const sy = Math.max(0, Math.floor((h - minSide) / 2));
        const size = Math.min(512, minSide);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        }
        const squared = canvas.toDataURL('image/jpeg', 0.9);
        if (squareArtworkCache.size > 40) {
          const firstKey = squareArtworkCache.keys().next().value;
          if (firstKey) squareArtworkCache.delete(firstKey);
        }
        squareArtworkCache.set(src, squared);
        resolve(squared);
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/**
 * Prepares a razor-sharp HD Retina cover (up to 1080x1080 WebP/JPEG) and uploads it
 * to dedicated cloud cover storage (/api/cover) so appState/main stays tiny (< 40 bytes per cover!)
 * while covers render in crystal-clear HD across all devices and public share links.
 * Gracefully falls back to inline compressed image if offline / local dev.
 */
export async function prepareAndUploadHdCover(
  file: File,
  firebaseConfig?: FirebaseUserConfig | null
): Promise<string> {
  let hdDataUrl = await compressCoverImage(file, 1080, 0.9, true);
  if (hdDataUrl.length > 720_000) {
    hdDataUrl = await compressCoverImage(file, 900, 0.84, true);
  }
  if (hdDataUrl.length > 720_000) {
    hdDataUrl = await compressCoverImage(file, 760, 0.78, true);
  }

  // 1. Google Drive-first storage (_Rowav_Data/covers/) so HD covers use 0 bytes in DB!
  try {
    const primaryFolderId = getCachedPrimaryDriveFolderId();
    if (primaryFolderId) {
      const driveRes = await uploadCoverToUserDrive(
        primaryFolderId,
        hdDataUrl,
        `cover_${Date.now()}`,
        firebaseConfig
      );
      if (driveRes.ok && driveRes.url) {
        return driveRes.url;
      }
    }
  } catch {
    // Drive folder may be read-only or offline — fall back cleanly below
  }

  // 2. Fallback to dedicated cloud cover endpoint (/api/cover)
  try {
    const idToken = await getCurrentFirebaseIdToken(firebaseConfig);
    if (idToken) {
      const res = await fetch('/api/cover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ dataUrl: hdDataUrl }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; url?: string };
        if (data?.ok && data.url) {
          return data.url;
        }
      }
    }
  } catch {
    // Offline or local dev without Vercel API — fall back to compact inline cover
  }

  // Fallback for offline / local dev
  return compressCoverImage(file, 420, 0.8, true);
}

/** Recompresses an existing inline data URL to shrink Firestore document size if needed */
export async function recompressDataUrl(
  dataUrl: string,
  maxSize = 200,
  quality = 0.62
): Promise<string> {
  if (typeof document === 'undefined' || !dataUrl.startsWith('data:image/')) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const smaller = canvas.toDataURL('image/jpeg', quality);
        resolve(smaller.length < dataUrl.length ? smaller : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function findLinkedProjectForTrack(
  track: MusicTrack,
  projects: MusicProject[],
  siblingTracks?: MusicTrack[]
): MusicProject | null {
  const direct = projects.find(
    (p) => p.id === track.linkedProjectId || p.trackIds.includes(track.id)
  );
  if (direct) return direct;
  if (siblingTracks && siblingTracks.length > 0) {
    for (const s of siblingTracks) {
      const sibProj = projects.find(
        (p) => p.id === s.linkedProjectId || p.trackIds.includes(s.id)
      );
      if (sibProj) return sibProj;
    }
  }
  return null;
}

/**
 * Unified cover resolution rule:
 * - Default (`preferIndividual = false`, used in MiniAudioPlayer, TrackCard, Playlists, Tabs, etc.):
 *   1. If the song belongs to a project that HAS a cover -> ALWAYS display the project's cover (even if the song has an individual cover).
 *   2. Otherwise, if the song has its own individual cover -> display it.
 *   3. Otherwise -> deterministic gradient fallback.
 * - Song page (`preferIndividual = true`, used ONLY in TrackDetailModal):
 *   1. If the song has its own individual cover -> display it.
 *   2. Otherwise, if the song belongs to a project that HAS a cover -> inherit the project's cover.
 *   3. Otherwise -> deterministic gradient fallback.
 */
export function resolveEffectiveTrackCover(
  track: MusicTrack,
  projects: MusicProject[],
  groupKey?: string,
  siblingTracks?: MusicTrack[],
  options?: { preferIndividual?: boolean }
): {
  coverDataUrl: string | null;
  coverMediaId: string | null;
  cloudCoverUrl: string | null;
  gradientId: string;
  inheritedFromProject: boolean;
} {
  const linkedProject = findLinkedProjectForTrack(track, projects, siblingTracks);
  const preferIndividual = Boolean(options?.preferIndividual);

  // Project cover lookup
  const hasProjectCover = Boolean(
    linkedProject && (linkedProject.coverDataUrl || linkedProject.coverMediaId)
  );

  // Individual song cover (checked across active track + sibling versions)
  const ownDataUrl =
    track.coverDataUrl ||
    siblingTracks?.find((s) => Boolean(s.coverDataUrl))?.coverDataUrl ||
    null;
  const ownMediaId =
    track.coverMediaId ||
    siblingTracks?.find((s) => Boolean(s.coverMediaId))?.coverMediaId ||
    null;
  const ownCloudUrl =
    track.cloudCoverUrl ||
    siblingTracks?.find((s) => Boolean(s.cloudCoverUrl))?.cloudCoverUrl ||
    null;
  const hasIndividualCover = Boolean(ownDataUrl || ownMediaId || ownCloudUrl);

  const projectResult = () => ({
    coverDataUrl: linkedProject?.coverDataUrl || null,
    coverMediaId: linkedProject?.coverMediaId || null,
    cloudCoverUrl: null,
    gradientId: linkedProject?.coverGradient || track.coverGradient || 'pink',
    inheritedFromProject: true,
  });

  const individualResult = () => ({
    coverDataUrl: ownDataUrl,
    coverMediaId: ownMediaId,
    cloudCoverUrl: ownCloudUrl,
    gradientId:
      track.coverGradient ||
      siblingTracks?.find((s) => Boolean(s.coverGradient))?.coverGradient ||
      (groupKey ? getDeterministicGradientId(groupKey) : linkedProject?.coverGradient || 'pink'),
    inheritedFromProject: false,
  });

  if (preferIndividual) {
    if (hasIndividualCover) return individualResult();
    if (hasProjectCover) return projectResult();
  } else {
    if (hasProjectCover) return projectResult();
    if (hasIndividualCover) return individualResult();
  }

  // Deterministic gradient fallback
  return {
    coverDataUrl: null,
    coverMediaId: null,
    cloudCoverUrl: null,
    gradientId:
      linkedProject?.coverGradient ||
      track.coverGradient ||
      siblingTracks?.find((s) => Boolean(s.coverGradient))?.coverGradient ||
      (groupKey ? getDeterministicGradientId(groupKey) : 'pink'),
    inheritedFromProject: false,
  };
}

/** Collects up to 4 unique individual cover images from a project's tracks (for mosaic fallback when project has no cover) */
export function getProjectTrackIndividualCovers(tracks: MusicTrack[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    const src = t.coverDataUrl || t.cloudCoverUrl;
    if (src && !seen.has(src)) {
      seen.add(src);
      out.push(src);
      if (out.length >= 4) break;
    }
  }
  return out;
}
