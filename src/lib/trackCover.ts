import type { MusicProject, MusicTrack } from '../types';
import { getDeterministicGradientId } from './musicVersioning';

/** Compresses any uploaded cover image cleanly for instant cross-device Firestore sync */
export async function compressCoverImage(file: File, maxSize = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function findLinkedProjectForTrack(
  track: MusicTrack,
  projects: MusicProject[]
): MusicProject | null {
  return (
    projects.find((p) => p.id === track.linkedProjectId || p.trackIds.includes(track.id)) || null
  );
}

/**
 * Unified cover resolution rule:
 * - If the track belongs to a project that HAS a cover -> use the project's cover for all tracks in it.
 * - Otherwise (standalone track, OR project has NO cover) -> use the track's own individual cover.
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
  const linkedProject = findLinkedProjectForTrack(track, projects);

  // 1. Project cover overrides all tracks inside that project when present
  if (linkedProject && (linkedProject.coverDataUrl || linkedProject.coverMediaId)) {
    return {
      coverDataUrl: linkedProject.coverDataUrl || null,
      coverMediaId: linkedProject.coverMediaId || null,
      cloudCoverUrl: null,
      gradientId: linkedProject.coverGradient || track.coverGradient || 'pink',
      inheritedFromProject: true,
    };
  }

  // 2. Otherwise use the track's own individual cover (or sibling version's cover)
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
