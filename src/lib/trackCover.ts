import type { FirebaseUserConfig, LyricsDoc, MusicProject, MusicTrack } from '../types';
import { getCurrentFirebaseIdToken } from './firebase';
import { getDeterministicGradientId } from './musicVersioning';

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

/** Compresses any uploaded cover image cleanly (supports WebP & high-quality resampling) */
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
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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
 * Unified cover resolution rule (shared by TrackCard, TrackDetailModal, and MiniAudioPlayer):
 * 1. If the song has its own individual cover (on the track or any sibling version) -> ALWAYS display it immediately.
 * 2. Otherwise, if the song belongs to a project that HAS a cover -> inherit the project's cover.
 * 3. Otherwise -> deterministic gradient fallback.
 * (Inside ProjectAlbumModal, the project's own cover still overrides tracklist items when set.)
 */
export function resolveEffectiveTrackCover(
  track: MusicTrack,
  projects: MusicProject[],
  groupKey?: string,
  siblingTracks?: MusicTrack[]
): {
  coverDataUrl: string | null;
  coverMediaId: string | null;
  cloudCoverUrl: string | null;
  gradientId: string;
  inheritedFromProject: boolean;
} {
  const linkedProject = findLinkedProjectForTrack(track, projects, siblingTracks);

  // 1. Individual song cover (checked across active track + sibling versions)
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

  if (ownDataUrl || ownMediaId || ownCloudUrl) {
    return {
      coverDataUrl: ownDataUrl,
      coverMediaId: ownMediaId,
      cloudCoverUrl: ownCloudUrl,
      gradientId:
        track.coverGradient ||
        siblingTracks?.find((s) => Boolean(s.coverGradient))?.coverGradient ||
        (groupKey ? getDeterministicGradientId(groupKey) : linkedProject?.coverGradient || 'pink'),
      inheritedFromProject: false,
    };
  }

  // 2. Project cover fallback when song has no individual cover
  if (linkedProject && (linkedProject.coverDataUrl || linkedProject.coverMediaId)) {
    return {
      coverDataUrl: linkedProject.coverDataUrl || null,
      coverMediaId: linkedProject.coverMediaId || null,
      cloudCoverUrl: null,
      gradientId: linkedProject.coverGradient || track.coverGradient || 'pink',
      inheritedFromProject: true,
    };
  }

  // 3. Deterministic gradient fallback
  return {
    coverDataUrl: null,
    coverMediaId: null,
    cloudCoverUrl: null,
    gradientId:
      track.coverGradient ||
      siblingTracks?.find((s) => Boolean(s.coverGradient))?.coverGradient ||
      (groupKey ? getDeterministicGradientId(groupKey) : linkedProject?.coverGradient || 'pink'),
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
