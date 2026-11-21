import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Disc3,
  GitBranch,
  ListChecks,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Star,
} from 'lucide-react';
import type { MusicTrack } from '../../types';
import { useApp } from '../../context/AppContext';
import { getMediaObjectUrl } from '../../lib/mediaDb';
import type { TrackGroup } from '../../lib/musicVersioning';
import { resolveEffectiveTrackCover } from '../../lib/trackCover';
import { TRACK_STATUS_META } from '../../utils/theme';
import { getGradientClass } from './MiniAudioPlayer';

interface TrackCardProps {
  group: TrackGroup;
  selectedTrackId?: string;
  isCurrentTrack: boolean;
  isPlaying: boolean;
  isPlayingProd?: boolean;
  onPlay: (track: MusicTrack) => void;
  onPlayProd?: (prodTrack: MusicTrack) => void;
  onToggleFavorite: (group: TrackGroup) => void;
  onOpenDetails: (group: TrackGroup, trackId: string) => void;
  onOpenContextMenu: (
    e: React.MouseEvent,
    group: TrackGroup,
    trackId: string,
    initialSection?: 'versions' | 'projects' | null
  ) => void;
  compact?: boolean;
}

function fmtShortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtDuration(sec?: number): string {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TrackCard({
  group,
  selectedTrackId,
  isCurrentTrack,
  isPlaying,
  isPlayingProd = false,
  onPlay,
  onPlayProd,
  onToggleFavorite,
  onOpenDetails,
  onOpenContextMenu,
  compact = false,
}: TrackCardProps) {
  const { state } = useApp();
  const activeEntry =
    (selectedTrackId ? group.versions.find((v) => v.track.id === selectedTrackId) : null) ||
    group.versions[0];

  const track = activeEntry.track;
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const effectiveCover = useMemo(
    () =>
      resolveEffectiveTrackCover(
        track,
        state.musicProjects,
        group.groupKey,
        group.versions.map((v) => v.track)
      ),
    [track, state.musicProjects, group.groupKey, group.versions]
  );

  useEffect(() => {
    let alive = true;
    if (effectiveCover.coverDataUrl) {
      setCoverUrl(effectiveCover.coverDataUrl);
    } else if (effectiveCover.coverMediaId) {
      getMediaObjectUrl(effectiveCover.coverMediaId).then((u) => alive && setCoverUrl(u));
    } else if (effectiveCover.cloudCoverUrl) {
      setCoverUrl(effectiveCover.cloudCoverUrl);
    } else {
      setCoverUrl(null);
    }
    return () => {
      alive = false;
    };
  }, [
    effectiveCover.coverDataUrl,
    effectiveCover.coverMediaId,
    effectiveCover.cloudCoverUrl,
  ]);

  const gradCls = getGradientClass(effectiveCover.gradientId);
  const todos = track.todos || [];
  const todoDone = todos.filter((t) => t.done).length;
  const todoTotal = todos.length;
  const description = track.description?.trim() || group.description;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetails(group, track.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetails(group, track.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenContextMenu(e, group, track.id, null);
      }}
      title="Clic sur la carte pour ouvrir la page du morceau · Clic sur ▶ pour lire · Clic droit pour options"
      className={`group relative rounded-2xl border p-3.5 transition-all cursor-pointer select-none flex flex-col justify-between gap-3 ${
        isCurrentTrack
          ? 'border-fuchsia-400/90 dark:border-fuchsia-500/70 bg-fuchsia-50/45 dark:bg-fuchsia-950/20 shadow-[0_10px_30px_-14px_rgba(217,70,239,0.45)]'
          : 'border-slate-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#131317] hover:border-slate-300 dark:hover:border-zinc-700 hover:shadow-md'
      }`}
    >
      {/* Top Row: Playable Cover + Title + Star / Context Menu Trigger */}
      <div className="flex items-start gap-3">
        {/* Square Cover = Dedicated Play/Pause Button (stops propagation so card click opens song page!) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlay(track);
          }}
          aria-label={isPlaying ? `Mettre en pause ${group.baseTitle}` : `Lire ${group.baseTitle}`}
          title={isPlaying ? 'Pause' : 'Lire ce morceau'}
          className={`relative group/play shrink-0 rounded-xl overflow-hidden border border-slate-200/70 dark:border-zinc-800 shadow-xs cursor-pointer active:scale-95 transition ${
            compact ? 'h-12 w-12' : 'h-14 w-14'
          }`}
        >
          {coverUrl ? (
            <img src={coverUrl} alt={group.baseTitle} className="h-full w-full object-cover" />
          ) : (
            <div
              className={`h-full w-full bg-gradient-to-br ${gradCls} flex items-center justify-center`}
            >
              <Disc3
                size={compact ? 18 : 22}
                className={`text-white/90 ${isPlaying ? 'animate-spin' : ''}`}
                style={isPlaying ? { animationDuration: '5s' } : undefined}
              />
            </div>
          )}

          {/* Always-clear Play/Pause overlay (crisp pill on mobile, full overlay on hover/playing) */}
          <span
            className={`absolute inset-0 bg-black/45 text-white flex items-center justify-center transition ${
              isCurrentTrack
                ? 'opacity-100'
                : 'opacity-0 group-hover/play:opacity-100 group-hover:opacity-90'
            }`}
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="ml-0.5" />
            )}
          </span>
          {!isCurrentTrack && (
            <span className="sm:hidden absolute bottom-1 right-1 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center backdrop-blur-xs">
              <Play size={10} fill="currentColor" className="ml-0.5" />
            </span>
          )}
        </button>

        {/* Title + Meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1">
            <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-zinc-100 truncate leading-snug">
              {group.baseTitle}
            </h3>

            {/* Right Controls: Star + 3-dots menu */}
            <div
              className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onToggleFavorite(group)}
                aria-label={group.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                  group.isFavorite
                    ? 'text-amber-400'
                    : 'text-slate-300 dark:text-zinc-600 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 hover:text-amber-400'
                }`}
              >
                <Star size={14} fill={group.isFavorite ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={(e) => onOpenContextMenu(e, group, track.id, null)}
                aria-label="Options du morceau"
                className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                <MoreHorizontal size={15} />
              </button>
            </div>
          </div>

          {/* Version Pill + Date + Duration */}
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {group.hasMultipleVersions ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenContextMenu(e, group, track.id, 'versions');
                }}
                title="Choisir une autre version"
                className="inline-flex items-center gap-1 rounded-full bg-slate-900/8 dark:bg-zinc-100/10 hover:bg-slate-900/14 dark:hover:bg-zinc-100/16 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-800 dark:text-zinc-200 transition cursor-pointer"
              >
                <GitBranch size={9} className="text-fuchsia-500" />
                <span>{activeEntry.versionLabel}</span>
                <span className="opacity-55">· {group.versions.length}</span>
                <ChevronDown size={10} className="opacity-70" />
              </button>
            ) : (
              activeEntry.versionLabel !== 'Original' && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-500 dark:text-zinc-400">
                  {activeEntry.versionLabel}
                </span>
              )
            )}

            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                TRACK_STATUS_META[track.status].badge
              }`}
            >
              {TRACK_STATUS_META[track.status].label}
            </span>

            {group.prodTrack && group.prodTrack.id !== track.id && onPlayProd && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlayProd(group.prodTrack!);
                }}
                title="Lancer la prod (instru) de ce morceau"
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition cursor-pointer ${
                  isPlayingProd
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/22'
                }`}
              >
                {isPlayingProd ? (
                  <Pause size={9} fill="currentColor" />
                ) : (
                  <Music2 size={9} />
                )}
                <span>Prod</span>
              </button>
            )}

            {track.durationSec ? (
              <span className="font-mono text-[10px] text-slate-400">
                {fmtDuration(track.durationSec)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Optional Description Preview */}
      {description && !compact && (
        <p className="text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
          {description}
        </p>
      )}

      {/* Footer: Year / Date + TODO chip + Details link */}
      <div
        className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800/70"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {group.yearFolder && (
            <span className="rounded-md bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-600 dark:text-zinc-300 shrink-0">
              {group.yearFolder}
            </span>
          )}
          <span className="font-mono text-[10px] text-slate-400 truncate">
            {fmtShortDate(track.modifiedAt || track.addedAt) || 'Drive'}
            {!activeEntry.isLatest && group.hasMultipleVersions ? ' · ancienne ver.' : ''}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onOpenDetails(group, track.id)}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:text-zinc-400 hover:text-fuchsia-600 dark:hover:text-fuchsia-400 hover:bg-slate-100/80 dark:hover:bg-zinc-800/70 transition cursor-pointer"
        >
          <ListChecks size={12} />
          {todoTotal > 0 ? (
            <span className="font-mono">
              {todoDone}/{todoTotal}
            </span>
          ) : (
            <span>TODO & Notes</span>
          )}
        </button>
      </div>
    </div>
  );
}
