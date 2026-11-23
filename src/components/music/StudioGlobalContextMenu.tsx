import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Circle,
  Copy,
  Disc3,
  FileText,
  FolderOpen,
  HardDrive,
  Home,
  ListMusic,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  Shuffle,
  Sun,
  Trash2,
} from 'lucide-react';
import type { LyricsDoc, MusicProject } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { shareOrCopyPublicLink } from '../../lib/publicShare';
import type { MusicSubTab } from './MusicView';

export type StudioContextMenuTarget =
  | { kind: 'page'; x: number; y: number }
  | { kind: 'project'; project: MusicProject; x: number; y: number }
  | { kind: 'lyrics'; doc: LyricsDoc; x: number; y: number };

interface StudioGlobalContextMenuProps {
  menu: StudioContextMenuTarget | null;
  onClose: () => void;
  onNavigateTab: (tab: MusicSubTab) => void;
  onOpenSettings?: () => void;
  onOpenDocs?: () => void;
  onOpenProject: (projectId: string) => void;
  onCreateProject: () => void;
  onOpenLyricsDoc: (docId: string) => void;
  onCreateLyricsDoc: () => void;
  onOpenDriveManager: () => void;
  onSyncDrives: () => void;
}

export function StudioGlobalContextMenu({
  menu,
  onClose,
  onNavigateTab,
  onOpenSettings,
  onOpenDocs,
  onOpenProject,
  onCreateProject,
  onOpenLyricsDoc,
  onCreateLyricsDoc,
  onOpenDriveManager,
  onSyncDrives,
}: StudioGlobalContextMenuProps) {
  const {
    state,
    toggleTheme,
    updateLyricsDoc,
    addLyricsDoc,
    softDeleteLyricsDoc,
    deleteMusicProject,
    notify,
  } = useApp();
  const player = useAudioPlayer();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 12, top: 12 });

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, onClose]);

  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    const rect = el?.getBoundingClientRect();
    const w = rect?.width || 248;
    const h = rect?.height || 340;
    const left = Math.max(pad, Math.min(menu.x, vw - w - pad));
    const top = Math.max(pad, Math.min(menu.y, vh - h - pad));
    setPos({ left, top });
  }, [menu]);

  if (!menu) return null;

  const itemCls =
    'w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/90 transition cursor-pointer';

  return (
    <div
      className="fixed inset-0 z-[72]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        onClick={(e) => e.stopPropagation()}
        style={{ left: pos.left, top: pos.top }}
        className="fixed w-64 max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl bg-white/98 dark:bg-[#16161a]/98 backdrop-blur-xl border border-slate-200/90 dark:border-zinc-800 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_70px_-10px_rgba(0,0,0,0.85)] py-1.5 text-xs select-none"
      >
        {/* ================= MODE 1: PROJECT CONTEXT MENU ================= */}
        {menu.kind === 'project' && (() => {
          const proj = menu.project;
          const linkedTracks = state.musicTracks.filter(
            (t) => t.linkedProjectId === proj.id || proj.trackIds.includes(t.id)
          );
          const isPlayingProj =
            player.isPlaying && linkedTracks.some((t) => t.id === player.currentTrack?.id);

          return (
            <>
              <div className="px-3 py-2 border-b border-slate-100 dark:border-zinc-800/80 flex items-center gap-2">
                <Disc3 size={14} className="text-[#8C271E] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-zinc-100 truncate">
                    {proj.title}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 uppercase truncate">
                    {proj.kind} · {linkedTracks.length} son{linkedTracks.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <div className="p-1 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onOpenProject(proj.id);
                    onClose();
                  }}
                  className={itemCls}
                >
                  <FolderOpen size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span>Ouvrir le projet</span>
                </button>

                {linkedTracks.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (isPlayingProj) player.togglePlay();
                        else void player.playTrack(linkedTracks[0], 0, linkedTracks);
                        onClose();
                      }}
                      className={itemCls}
                    >
                      {isPlayingProj ? (
                        <Pause size={14} className="text-[#8C271E] shrink-0" />
                      ) : (
                        <Play size={14} className="text-[#8C271E] shrink-0" />
                      )}
                      <span>{isPlayingProj ? 'Mettre en pause' : 'Lire le projet'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void player.playShuffled(linkedTracks);
                        onClose();
                      }}
                      className={itemCls}
                    >
                      <Shuffle size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                      <span>Lecture aléatoire</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={async () => {
                    onClose();
                    try {
                      const res = await shareOrCopyPublicLink({
                        kind: 'project',
                        id: proj.id,
                        title: proj.title,
                        firebaseConfig: state.preferences.firebaseConfig,
                      });
                      notify(
                        res.method === 'native'
                          ? `Projet « ${proj.title} » partagé ✓`
                          : 'Lien public du projet copié ✓'
                      );
                    } catch (err) {
                      notify(`Partage : ${(err as Error).message}`);
                    }
                  }}
                  className={itemCls}
                >
                  <Share2 size={14} className="text-emerald-500 shrink-0" />
                  <span>Partager le lien public</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onCreateProject();
                    onClose();
                  }}
                  className={itemCls}
                >
                  <Plus size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span>Nouveau projet…</span>
                </button>

                <div className="my-1 border-t border-slate-100 dark:border-zinc-800/80" />

                <button
                  type="button"
                  onClick={() => {
                    deleteMusicProject(proj.id);
                    notify(`Projet « ${proj.title} » supprimé`);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                >
                  <Trash2 size={14} className="shrink-0" />
                  <span>Supprimer ce projet</span>
                </button>
              </div>
            </>
          );
        })()}

        {/* ================= MODE 2: LYRICS / TEXTE CONTEXT MENU ================= */}
        {menu.kind === 'lyrics' && (() => {
          const doc = menu.doc;
          const words = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;
          const linkedTrack = doc.linkedTrackId
            ? state.musicTracks.find((t) => t.id === doc.linkedTrackId)
            : null;

          return (
            <>
              <div className="px-3 py-2 border-b border-slate-100 dark:border-zinc-800/80 flex items-center gap-2">
                <FileText size={14} className="text-[#8C271E] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-zinc-100 truncate">
                    {doc.title || 'Sans titre'}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 truncate">
                    {words} mots
                  </p>
                </div>
              </div>

              <div className="p-1 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onOpenLyricsDoc(doc.id);
                    onClose();
                  }}
                  className={itemCls}
                >
                  <FolderOpen size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span>Ouvrir le texte</span>
                </button>

                {linkedTrack && (
                  <button
                    type="button"
                    onClick={() => {
                      if (player.currentTrack?.id === linkedTrack.id) player.togglePlay();
                      else void player.playTrack(linkedTrack);
                      onClose();
                    }}
                    className={itemCls}
                  >
                    <Play size={14} className="text-[#8C271E] shrink-0" />
                    <span className="truncate">
                      Écouter « {linkedTrack.manualGroupTitle || linkedTrack.title} »
                    </span>
                  </button>
                )}

                {/* Quick Status Selector */}
                <div className="px-2.5 py-1.5 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Statut du texte
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        [1, 'Brouillon', 'text-slate-400'],
                        [2, 'En cours', 'text-amber-500'],
                        [3, 'Terminé', 'text-emerald-500'],
                      ] as const
                    ).map(([stVal, label, dotCls]) => {
                      const active = (doc.status || 1) === stVal;
                      return (
                        <button
                          key={stVal}
                          type="button"
                          onClick={() => {
                            updateLyricsDoc(doc.id, { status: stVal });
                            onClose();
                          }}
                          className={`inline-flex items-center justify-center gap-1 rounded-lg py-1 text-[10px] font-semibold transition cursor-pointer ${
                            active
                              ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                              : 'bg-slate-100 dark:bg-zinc-800/80 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
                          }`}
                        >
                          <Circle size={5} className={`${dotCls} fill-current`} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(doc.content || '');
                      notify('Paroles copiées dans le presse-papiers ✓');
                    } catch {
                      // ignore
                    }
                    onClose();
                  }}
                  className={itemCls}
                >
                  <Copy size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span>Copier les paroles</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const copyId = addLyricsDoc({
                      title: `${doc.title || 'Sans titre'} (copie)`,
                      content: doc.content,
                      folderId: doc.folderId,
                      status: doc.status,
                      linkedTrackId: doc.linkedTrackId,
                    });
                    notify('Texte dupliqué ✓');
                    onOpenLyricsDoc(copyId);
                    onClose();
                  }}
                  className={itemCls}
                >
                  <Plus size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span>Dupliquer ce texte</span>
                </button>

                <div className="my-1 border-t border-slate-100 dark:border-zinc-800/80" />

                <button
                  type="button"
                  onClick={() => {
                    softDeleteLyricsDoc(doc.id);
                    notify('Texte déplacé dans la corbeille');
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                >
                  <Trash2 size={14} className="shrink-0" />
                  <span>Mettre à la corbeille</span>
                </button>
              </div>
            </>
          );
        })()}

        {/* ================= MODE 3: GLOBAL PAGE CONTEXT MENU ================= */}
        {menu.kind === 'page' && (
          <>
            <div className="px-3 py-2 border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#8C271E]" />
                <span className="font-semibold text-slate-900 dark:text-zinc-100">
                  Rowav Studio
                </span>
              </div>
              <span className="font-mono text-[10px] text-slate-400">
                {state.musicTracks.length} MP3
              </span>
            </div>

            <div className="p-1 space-y-0.5">
              {/* Quick Creations */}
              <button
                type="button"
                onClick={() => {
                  onCreateProject();
                  onClose();
                }}
                className={itemCls}
              >
                <Plus size={14} className="text-[#8C271E] shrink-0" />
                <span>Nouveau projet…</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onCreateLyricsDoc();
                  onClose();
                }}
                className={itemCls}
              >
                <FileText size={14} className="text-[#8C271E] shrink-0" />
                <span>Nouveau texte…</span>
              </button>

              {/* Playback Actions */}
              {player.currentTrack && (
                <button
                  type="button"
                  onClick={() => {
                    player.togglePlay();
                    onClose();
                  }}
                  className={itemCls}
                >
                  {player.isPlaying ? (
                    <Pause size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  ) : (
                    <Play size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  )}
                  <span className="truncate">
                    {player.isPlaying ? 'Mettre en pause' : 'Reprendre'} «{' '}
                    {player.currentTrack.manualGroupTitle || player.currentTrack.title} »
                  </span>
                </button>
              )}

              {state.musicTracks.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    void player.playShuffled(state.musicTracks);
                    onClose();
                  }}
                  className={itemCls}
                >
                  <Shuffle size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span>Lecture aléatoire des sons</span>
                </button>
              )}

              <div className="my-1 border-t border-slate-100 dark:border-zinc-800/80" />

              {/* Quick Navigation */}
              <div className="px-2 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Navigation rapide
                </span>
                <div className="grid grid-cols-4 gap-1 mt-1">
                  {(
                    [
                      ['dashboard', 'Accueil', Home],
                      ['library', 'Sons', ListMusic],
                      ['projects', 'Projets', Disc3],
                      ['lyrics', 'Textes', FileText],
                    ] as const
                  ).map(([tabId, label, Icon]) => (
                    <button
                      key={tabId}
                      type="button"
                      onClick={() => {
                        onNavigateTab(tabId);
                        onClose();
                      }}
                      className="flex flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                    >
                      <Icon size={13} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="my-1 border-t border-slate-100 dark:border-zinc-800/80" />

              {/* Drive Sync & Settings */}
              <button
                type="button"
                onClick={() => {
                  onSyncDrives();
                  onClose();
                }}
                className={itemCls}
              >
                <RefreshCw size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                <span>Synchroniser Google Drive</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onOpenDriveManager();
                  onClose();
                }}
                className={itemCls}
              >
                <HardDrive size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                <span>Gérer les Drives connectés…</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  toggleTheme();
                  onClose();
                }}
                className={itemCls}
              >
                {state.preferences.theme === 'dark' ? (
                  <Sun size={14} className="text-amber-400 shrink-0" />
                ) : (
                  <Moon size={14} className="text-slate-500 shrink-0" />
                )}
                <span>
                  {state.preferences.theme === 'dark'
                    ? 'Passer en mode clair'
                    : 'Passer en mode sombre'}
                </span>
              </button>

              {onOpenDocs && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenDocs();
                    onClose();
                  }}
                  className={itemCls}
                >
                  <BookOpen size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span>Guide & Documentation</span>
                </button>
              )}

              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenSettings();
                    onClose();
                  }}
                  className={itemCls}
                >
                  <Settings size={14} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                  <span>Paramètres & Profil</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
