import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Disc3,
  Edit3,
  ExternalLink,
  FileText,
  FolderKanban,
  GitBranch,
  ImagePlus,
  Link2,
  ListChecks,
  Music2,
  Pause,
  Play,
  Share2,
  Star,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { MusicTrack } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import type { TrackGroup } from '../../lib/musicVersioning';
import { shareOrCopyPublicLink } from '../../lib/publicShare';
import { prepareAndUploadHdCover } from '../../lib/trackCover';

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
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
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
    renameTrackGroup,
    setTrackGroupCover,
    setTrackGroupFavorite,
    updateMusicTrack,
    updateMusicProject,
    deleteMusicTrack,
    notify,
  } = useApp();
  const player = useAudioPlayer();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [openSection, setOpenSection] = useState<'versions' | 'projects' | 'rename' | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 12, top: 12 });

  useEffect(() => {
    setOpenSection(menu?.initialSection ?? null);
    setRenameDraft(menu?.group.baseTitle || '');
    if (typeof window !== 'undefined') {
      setIsMobileViewport(window.innerWidth < 640);
    }
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onResize = () => setIsMobileViewport(window.innerWidth < 640);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [menu, onClose]);

  // Dynamically measure actual rendered menu size and clamp strictly inside viewport (even when submenus expand!)
  useLayoutEffect(() => {
    if (!menu || isMobileViewport) return;
    const el = menuRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    const rect = el?.getBoundingClientRect();
    const w = rect?.width || 256;
    const h = rect?.height || 420;
    const left = Math.max(pad, Math.min(menu.x, vw - w - pad));
    const top = Math.max(pad, Math.min(menu.y, vh - h - pad));
    setPos({ left, top });
  }, [menu, openSection, isMobileViewport]);

  if (!menu) return null;

  const { group, activeTrackId } = menu;
  const activeEntry =
    group.versions.find((v) => v.track.id === activeTrackId) || group.versions[0];
  if (!activeEntry) return null;
  const track = activeEntry.track;

  const isCurrent = player.currentTrack?.id === track.id;
  const isPlaying = isCurrent && player.isPlaying;
  const isCurrentProd = Boolean(group.prodTrack && player.currentTrack?.id === group.prodTrack.id);
  const isPlayingProd = isCurrentProd && player.isPlaying;
  const allIds = group.allTrackIds.length > 0 ? group.allTrackIds : group.versions.map((v) => v.track.id);
  const todos = track.todos || [];
  const todoDone = todos.filter((t) => t.done).length;

  const handleAssignProject = (projectId: string) => {
    const groupIdSet = new Set(allIds);
    const targetProj = state.musicProjects.find((p) => p.id === projectId);
    const isAlreadyInTarget = Boolean(
      targetProj &&
        (targetProj.trackIds.some((id) => groupIdSet.has(id)) ||
          allIds.some((id) => state.musicTracks.find((t) => t.id === id)?.linkedProjectId === projectId))
    );

    if (isAlreadyInTarget && targetProj) {
      const nextPins = { ...(targetProj.pinnedVersionByGroup || {}) };
      delete nextPins[group.groupKey];
      updateMusicProject(targetProj.id, {
        trackIds: targetProj.trackIds.filter((id) => !groupIdSet.has(id)),
        benchTrackIds: (targetProj.benchTrackIds || []).filter((id) => !groupIdSet.has(id)),
        pinnedVersionByGroup: Object.keys(nextPins).length > 0 ? nextPins : undefined,
      });
      for (const id of allIds) {
        const t = state.musicTracks.find((x) => x.id === id);
        if (t?.linkedProjectId === projectId) {
          updateMusicTrack(id, { linkedProjectId: undefined });
        }
      }
      notify('Retiré du projet');
      onClose();
      return;
    }

    if (targetProj) {
      const isSpecificOlderVersion = track.id !== group.latestTrack.id;
      const nextPins = { ...(targetProj.pinnedVersionByGroup || {}) };
      if (isSpecificOlderVersion) nextPins[group.groupKey] = track.id;
      else delete nextPins[group.groupKey];
      updateMusicProject(targetProj.id, {
        trackIds: [...targetProj.trackIds.filter((id) => !groupIdSet.has(id)), track.id],
        benchTrackIds: (targetProj.benchTrackIds || []).filter((id) => !groupIdSet.has(id)),
        pinnedVersionByGroup: Object.keys(nextPins).length > 0 ? nextPins : undefined,
      });
      updateMusicTrack(track.id, { linkedProjectId: projectId });
      notify(`Ajouté à « ${targetProj.title || 'Projet'} » ✓`);
    }
    onClose();
  };

  return (
    <div
      className={`fixed inset-0 z-[70] ${
        isMobileViewport ? 'bg-slate-950/45 dark:bg-black/65 backdrop-blur-[2px]' : ''
      }`}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        onClick={(e) => e.stopPropagation()}
        style={isMobileViewport ? undefined : { left: pos.left, top: pos.top }}
        className={
          isMobileViewport
            ? 'fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[80dvh] overflow-y-auto rounded-3xl bg-white/98 dark:bg-[#16161a]/98 backdrop-blur-xl border border-slate-200/90 dark:border-zinc-800 shadow-2xl py-2 text-xs'
            : 'fixed w-64 max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl bg-white/98 dark:bg-[#16161a]/98 backdrop-blur-xl border border-slate-200/90 dark:border-zinc-800 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_70px_-10px_rgba(0,0,0,0.85)] py-1.5 text-xs'
        }
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

          {/* Play Linked Prod (when a *_prod file exists for this song!) */}
          {group.prodTrack && group.prodTrack.id !== track.id && (
            <button
              type="button"
              onClick={() => {
                if (isCurrentProd) player.togglePlay();
                else void player.playTrack(group.prodTrack!, 0, [track, group.prodTrack!]);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition cursor-pointer"
            >
              {isPlayingProd ? (
                <Pause size={14} className="shrink-0" />
              ) : (
                <Music2 size={14} className="shrink-0" />
              )}
              <span className="font-semibold">
                {isPlayingProd ? 'Pause (Prod)' : 'Lancer la prod (instru)'}
              </span>
            </button>
          )}

          {/* Rename Song (without touching version names!) */}
          <div>
            <button
              type="button"
              onClick={() =>
                setOpenSection((s) => (s === 'rename' ? null : 'rename'))
              }
              className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
            >
              <Edit3 size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
              <span className="font-medium">Renommer le son</span>
            </button>
            {openSection === 'rename' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = renameDraft.trim();
                  if (!clean) return;
                  renameTrackGroup(allIds, clean);
                  notify(`Son renommé en « ${clean} » (versions conservées) ✓`);
                  onClose();
                }}
                className="mt-0.5 mb-1 mx-1 flex items-center gap-1 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 p-1"
              >
                <input
                  autoFocus
                  type="text"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  placeholder="Nouveau nom du son…"
                  className="flex-1 min-w-0 bg-transparent px-2 py-1 text-xs text-slate-900 dark:text-zinc-100 outline-none"
                />
                <button
                  type="submit"
                  className="h-6 px-2 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-[10px] font-semibold cursor-pointer shrink-0"
                >
                  OK
                </button>
              </form>
            )}
          </div>

          {/* Change Song Cover (applies cleanly to all versions of the song!) */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const coverUrl = await prepareAndUploadHdCover(file, state.preferences.firebaseConfig);
                setTrackGroupCover(allIds, { coverDataUrl: coverUrl });
                notify(`Pochette HD de « ${group.baseTitle} » mise à jour ✓`);
                onClose();
              } catch {
                notify('Impossible de lire cette image');
              }
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
          >
            <ImagePlus size={14} className="text-fuchsia-500 shrink-0" />
            <span className="font-medium">Changer la pochette</span>
          </button>

          {/* Public Share Link (zero login for recipient!) */}
          <button
            type="button"
            onClick={async () => {
              onClose();
              if (!track.googleDriveFileId && !track.cloudAudioUrl) {
                notify('Ce son est uniquement local — synchronise-le via Google Drive pour le partager par lien.');
                return;
              }
              try {
                const res = await shareOrCopyPublicLink({
                  kind: 'track',
                  id: track.id,
                  title: group.baseTitle,
                  firebaseConfig: state.preferences.firebaseConfig,
                });
                notify(
                  res.method === 'native'
                    ? `Lien public partagé ✓`
                    : `Lien public copié ✓ (écoute sans compte)`
                );
              } catch (err) {
                notify(`Partage : ${(err as Error).message}`);
              }
            }}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
          >
            <Share2 size={14} className="text-emerald-500 shrink-0" />
            <span className="font-medium">Partager le lien public</span>
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

          {/* Open exact file directly in Google Drive */}
          {track.googleDriveFileId && (
            <a
              href={`https://drive.google.com/file/d/${encodeURIComponent(track.googleDriveFileId)}/view`}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
              className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer"
            >
              <ExternalLink size={14} className="text-sky-500 shrink-0" />
              <span className="font-medium truncate">Ouvrir sur Google Drive</span>
            </a>
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
              {track.linkedLyricsId ? 'Ouvrir le texte' : 'Créer un texte'}
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
                      track.linkedProjectId === proj.id ||
                      proj.trackIds.some((id) => allIds.includes(id));
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
