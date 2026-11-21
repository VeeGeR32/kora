import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Disc3,
  FileText,
  FolderKanban,
  GitBranch,
  Link2,
  ListChecks,
  Pause,
  Play,
  Star,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { MusicTrack } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import type { TrackGroup } from '../../lib/musicVersioning';

export interface TrackContextMenuState {
  group: TrackGroup;
  activeTrackId: string;
  x: number;
  y: number;
  initialSection?: 'versions' | 'projects' | null;
}

interface TrackContextMenuProps {
  menu: TrackContextMenuState | null;
  queueTracks: MusicTrack[];
  onClose: () => void;
  onSelectVersion: (groupKey: string, trackId: string, autoPlay?: boolean) => void;
  onOpenDetails: (groupKey: string, trackId: string) => void;
  onOpenLyrics: (track: MusicTrack) => void;
  onRequestLinkVersion: (group: TrackGroup, trackId: string) => void;
  onDetachVersion: (trackId: string) => void;
}

function fmtShortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function TrackContextMenu({
  menu,
  queueTracks,
  onClose,
  onSelectVersion,
  onOpenDetails,
  onOpenLyrics,
  onRequestLinkVersion,
  onDetachVersion,
}: TrackContextMenuProps) {
  const {
    state,
    setTrackGroupFavorite,
    updateMusicTrack,
    updateMusicProject,
    deleteMusicTrack,
    notify,
  } = useApp();
  const player = useAudioPlayer();

  const [openSection, setOpenSection] = useState<'versions' | 'projects' | null>(null);

  useEffect(() => {
    setOpenSection(menu?.initialSection ?? null);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, onClose]);

  const position = useMemo(() => {
    if (!menu) return { left: 0, top: 0 };
    const menuW = 256;
    const menuH = 380;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const left = Math.max(12, Math.min(menu.x, vw - menuW - 12));
    const top = Math.max(12, Math.min(menu.y, vh - menuH - 12));
    return { left, top };
  }, [menu]);

  if (!menu) return null;

  const { group, activeTrackId } = menu;
  const activeEntry =
    group.versions.find((v) => v.track.id === activeTrackId) || group.versions[0];
  if (!activeEntry) return null;
  const track = activeEntry.track;

  const isCurrent = player.currentTrack?.id === track.id;
  const isPlaying = isCurrent && player.isPlaying;
  const allIds = group.versions.map((v) => v.track.id);
  const todos = track.todos || [];
  const todoDone = todos.filter((t) => t.done).length;

  const handleAssignProject = (projectId: string) => {
    const prevProjId = track.linkedProjectId;
    const isRemoving = prevProjId === projectId;
    const nextProjId = isRemoving ? undefined : projectId;

    updateMusicTrack(track.id, { linkedProjectId: nextProjId });

    if (prevProjId) {
      const oldProj = state.musicProjects.find((p) => p.id === prevProjId);
      if (oldProj) {
        updateMusicProject(oldProj.id, {
          trackIds: oldProj.trackIds.filter((id) => id !== track.id),
        });
      }
    }
    if (nextProjId) {
      const targetProj = state.musicProjects.find((p) => p.id === nextProjId);
      if (targetProj && !targetProj.trackIds.includes(track.id)) {
        updateMusicProject(targetProj.id, {
          trackIds: [...targetProj.trackIds, track.id],
        });
      }
      notify(`Ajouté à « ${targetProj?.title || 'Projet'} » ✓`);
    } else {
      notify('Retiré du projet');
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ left: position.left, top: position.top }}
        className="fixed w-64 rounded-2xl bg-white/98 dark:bg-[#16161a]/98 backdrop-blur-xl border border-slate-200/90 dark:border-zinc-800 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_70px_-10px_rgba(0,0,0,0.85)] py-1.5 text-xs overflow-hidden"
      >
        {/* Header Summary */}
        <div className="px-3 py-2 border-b border-slate-100 dark:border-zinc-800/80 flex items-center gap-2">
          <Disc3 size={14} className="text-fuchsia-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 dark:text-zinc-100 truncate">
              {group.baseTitle}
            </p>
            <p className="text-[10px] font-mono text-slate-400 truncate">
              {activeEntry.versionLabel}
              {group.hasMultipleVersions ? ` · ${group.versions.length} versions` : ''}
            </p>
          </div>
        </div>

        <div className="p-1 space-y-0.5">
          {/* Play / Pause */}
          <button
            type="button"
            onClick={() => {
              if (isCurrent) player.togglePlay();
              else void player.playTrack(track, 0, queueTracks);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
          >
            {isPlaying ? (
              <Pause size={14} className="text-fuchsia-500 shrink-0" />
            ) : (
              <Play size={14} className="text-fuchsia-500 shrink-0" />
            )}
            <span className="font-medium">{isPlaying ? 'Mettre en pause' : 'Écouter'}</span>
          </button>

          {/* Toggle Favorite */}
          <button
            type="button"
            onClick={() => {
              setTrackGroupFavorite(allIds, !group.isFavorite);
              notify(
                !group.isFavorite
                  ? `« ${group.baseTitle} » ajouté aux favoris ★`
                  : `« ${group.baseTitle} » retiré des favoris`
              );
              onClose();
            }}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
          >
            <Star
              size={14}
              className={group.isFavorite ? 'text-amber-400 shrink-0' : 'text-slate-400 shrink-0'}
              fill={group.isFavorite ? 'currentColor' : 'none'}
            />
            <span className="font-medium">
              {group.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            </span>
          </button>

          {/* Details, Description & TODO */}
          <button
            type="button"
            onClick={() => {
              onOpenDetails(group.groupKey, track.id);
              onClose();
            }}
            className="w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <ListChecks size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
              <span className="font-medium">Description & TODO</span>
            </span>
            {todos.length > 0 && (
              <span className="font-mono text-[10px] rounded-full bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400 px-1.5 py-0.5 font-semibold">
                {todoDone}/{todos.length}
              </span>
            )}
          </button>

          {/* Versions Sub-section */}
          {group.hasMultipleVersions && (
            <div>
              <button
                type="button"
                onClick={() =>
                  setOpenSection((s) => (s === 'versions' ? null : 'versions'))
                }
                className="w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
              >
                <span className="flex items-center gap-2.5">
                  <GitBranch size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span className="font-medium">Versions ({group.versions.length})</span>
                </span>
                <ChevronRight
                  size={13}
                  className={`text-slate-400 transition-transform ${
                    openSection === 'versions' ? 'rotate-90' : ''
                  }`}
                />
              </button>

              {openSection === 'versions' && (
                <div className="mt-0.5 mb-1 mx-1 rounded-xl bg-slate-50 dark:bg-zinc-900/90 border border-slate-100 dark:border-zinc-800 max-h-44 overflow-y-auto p-1 space-y-0.5">
                  {group.versions.map((v) => {
                    const selected = v.track.id === track.id;
                    return (
                      <button
                        key={v.track.id}
                        type="button"
                        onClick={() => {
                          onSelectVersion(group.groupKey, v.track.id, true);
                          onClose();
                        }}
                        className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition cursor-pointer ${
                          selected
                            ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold'
                            : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-[11px]">{v.versionLabel}</span>
                          {v.isLatest && (
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded-full ${
                                selected
                                  ? 'bg-white/20 text-white dark:bg-black/15 dark:text-zinc-950'
                                  : 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400'
                              }`}
                            >
                              Dernière
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] opacity-60 font-mono">
                            {fmtShortDate(v.track.modifiedAt || v.track.addedAt)}
                          </span>
                          {selected && <Check size={11} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Manual Version Link / Detach */}
          <button
            type="button"
            onClick={() => {
              onRequestLinkVersion(group, track.id);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
          >
            <Link2 size={14} className="text-fuchsia-500 shrink-0" />
            <span className="font-medium">Version d’un autre son…</span>
          </button>

          {group.hasMultipleVersions && (
            <button
              type="button"
              onClick={() => {
                onDetachVersion(track.id);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
            >
              <Unlink size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
              <span className="font-medium">Détacher en son séparé</span>
            </button>
          )}

          {/* Open Lyrics (LexCore) */}
          <button
            type="button"
            onClick={() => {
              onOpenLyrics(track);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
          >
            <FileText size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
            <span className="font-medium">
              {track.linkedLyricsId ? 'Ouvrir texte LexCore' : 'Créer texte LexCore'}
            </span>
          </button>

          {/* Add to Album / Project */}
          {state.musicProjects.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() =>
                  setOpenSection((s) => (s === 'projects' ? null : 'projects'))
                }
                className="w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
              >
                <span className="flex items-center gap-2.5">
                  <FolderKanban size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span className="font-medium">Ajouter à un projet</span>
                </span>
                <ChevronRight
                  size={13}
                  className={`text-slate-400 transition-transform ${
                    openSection === 'projects' ? 'rotate-90' : ''
                  }`}
                />
              </button>

              {openSection === 'projects' && (
                <div className="mt-0.5 mb-1 mx-1 rounded-xl bg-slate-50 dark:bg-zinc-900/90 border border-slate-100 dark:border-zinc-800 max-h-36 overflow-y-auto p-1 space-y-0.5">
                  {state.musicProjects.map((proj) => {
                    const linked =
                      track.linkedProjectId === proj.id || proj.trackIds.includes(track.id);
                    return (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() => handleAssignProject(proj.id)}
                        className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-slate-700 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800 transition cursor-pointer"
                      >
                        <span className="truncate">{proj.title}</span>
                        {linked && <Check size={12} className="text-fuchsia-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="my-1 border-t border-slate-100 dark:border-zinc-800/80" />

          {/* Delete active version */}
          <button
            type="button"
            onClick={() => {
              deleteMusicTrack(track.id);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
          >
            <Trash2 size={14} className="shrink-0" />
            <span className="font-medium">
              Supprimer {group.hasMultipleVersions ? activeEntry.versionLabel : 'ce son'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
