import { getGradientClass } from './MiniAudioPlayer';

interface ProjectCoverArtworkProps {
  title: string;
  projectCoverUrl?: string | null;
  trackCoverUrls?: string[];
  gradientId?: string;
}

/**
 * Renders a project's artwork following the exact rule:
 * 1. If the project has its own cover -> show it.
 * 2. Else if its tracks have individual covers -> show a crisp 2x2 mosaic (or single cover if 1).
 * 3. Else -> fallback gradient.
 */
export function ProjectCoverArtwork({
  title,
  projectCoverUrl,
  trackCoverUrls = [],
  gradientId,
}: ProjectCoverArtworkProps) {
  if (projectCoverUrl) {
    return <img src={projectCoverUrl} alt={title} className="h-full w-full object-cover" />;
  }

  if (trackCoverUrls.length === 1) {
    return <img src={trackCoverUrls[0]} alt={title} className="h-full w-full object-cover" />;
  }

  if (trackCoverUrls.length >= 2) {
    const tiles =
      trackCoverUrls.length >= 4
        ? trackCoverUrls.slice(0, 4)
        : trackCoverUrls.length === 3
        ? [trackCoverUrls[0], trackCoverUrls[1], trackCoverUrls[2], trackCoverUrls[0]]
        : [trackCoverUrls[0], trackCoverUrls[1], trackCoverUrls[1], trackCoverUrls[0]];

    return (
      <div className="h-full w-full grid grid-cols-2 grid-rows-2 bg-zinc-900">
        {tiles.map((src, i) => (
          <img
            key={`${i}-${src.slice(-16)}`}
            src={src}
            alt={title}
            className="h-full w-full object-cover"
          />
        ))}
      </div>
    );
  }

  const gradCls = getGradientClass(gradientId);
  return <div className={`h-full w-full bg-gradient-to-br ${gradCls}`} />;
}
