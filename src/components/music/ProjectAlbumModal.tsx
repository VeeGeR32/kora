import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Link2,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { MusicProject, ProjectKind } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { CheckCircle } from '../ui/CheckCircle';
import { PROJECT_GRADIENTS } from './MiniAudioPlayer';
import { shareOrCopyPublicLink } from '../../lib/publicShare';
import {
  findLinkedLyricsForTrack,
  getProjectTrackIndividualCovers,
  LYRICS_STATUS_META,
} from '../../lib/trackCover';
import { groupMusicTracks } from '../../lib/musicVersioning';
import { ProjectCoverArtwork } from './ProjectCoverArtwork';

interface ProjectAlbumModalProps {
  projectId: string | null;
  onClose: () => void;
  onOpenTrackDetails?: (trackId: string) => void;
}

function fmtTotalDuration(sec: number): string {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function fmtAddedDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function resizeProjectCover(file: File, maxSize = 320): Promise<string> {
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
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProjectAlbumModal({ projectId, onClose, onOpenTrackDetails }: ProjectAlbumModalProps) {
  const {
    state,
    updateMusicProject,
    toggleMusicProjectStep,
    addMusicProjectStep,
    deleteMusicProjectStep,
    deleteMusicProject,
    updateMusicTrack,
    renameTrackGroup,
    notify,
  } = useApp();
  const player = useAudioPlayer();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const todoSectionRef = useRef<HTMLDivElement>(null);
  const [todoInput, setTodoInput] = useState('');
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [showEditMeta, setShowEditMeta] = useState(false);
  const [openTrackMenuId, setOpenTrackMenuId] = useState<string | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [sharing, setSharing] = useState(false);

  const project: MusicProject | null = useMemo(
    () => (projectId ? state.musicProjects.find((p) => p.id === projectId) || null : null),
    [projectId, state.musicProjects]
  );

  const { registerFullscreenOverlay } = player;
  useEffect(() => {
    if (!project) return;
    return registerFullscreenOverlay();
  }, [Boolean(project), registerFullscreenOverlay]);

  const allGroups = useMemo(
    () => groupMusicTracks(state.musicTracks),
    [state.musicTracks]
  );

  const projectTracks = useMemo(() => {
    if (!project) return [];
    const byId = new Map(state.musicTracks.map((t) => [t.id, t]));
    const ordered: typeof state.musicTracks = [];
    const seen = new Set<string>();

    for (const tid of project.trackIds) {
      const found = byId.get(tid);
      if (found && !seen.has(found.id)) {
        ordered.push(found);
        seen.add(found.id);
      }
    }
    for (const t of state.musicTracks) {
      if (t.linkedProjectId === project.id && !seen.has(t.id)) {
        ordered.push(t);
        seen.add(t.id);
      }
    }
    return ordered;
  }, [project, state.musicTracks]);

  const availableTracks = useMemo(() => {
    const inProj = new Set(projectTracks.map((t) => t.id));
    return state.musicTracks.filter((t) => !inProj.has(t.id));
  }, [state.musicTracks, projectTracks]);

  if (!project) return null;

  const totalSec = projectTracks.reduce((acc, t) => acc + (t.durationSec || 0), 0);
  const doneSteps = project.steps.filter((s) => s.done).length;
  const totalSteps = project.steps.length;
  const todoPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const isPlayingThisProject =
    player.isPlaying && projectTracks.some((t) => t.id === player.currentTrack?.id);

  const handleCoverUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await resizeProjectCover(file);
      updateMusicProject(project.id, { coverDataUrl: dataUrl });
      notify('Pochette du projet mise à jour ✓');
    } catch {
      notify('Impossible de lire cette image');
    }
  };

  const handlePlayAlbum = () => {
    if (projectTracks.length === 0) {
      setShowAddTrack(true);
      return;
    }
    if (isPlayingThisProject) {
      player.togglePlay();
    } else {
      void player.playTrack(projectTracks[0], 0, projectTracks);
    }
  };

  const handleAddTrackToProject = (trackId: string) => {
    const nextIds = Array.from(new Set([...projectTracks.map((t) => t.id), trackId]));
    updateMusicProject(project.id, { trackIds: nextIds });
    updateMusicTrack(trackId, { linkedProjectId: project.id });
    notify('Son ajouté au projet ✓');
  };

  const handleRemoveTrackFromProject = (trackId: string) => {
    const nextIds = projectTracks.map((t) => t.id).filter((id) => id !== trackId);
    updateMusicProject(project.id, { trackIds: nextIds });
    updateMusicTrack(trackId, { linkedProjectId: undefined });
    setOpenTrackMenuId(null);
  };

  const handleMoveTrack = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= projectTracks.length) return;
    const ids = projectTracks.map((t) => t.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(target, 0, moved);
    updateMusicProject(project.id, { trackIds: ids });
  };

  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!todoInput.trim()) return;
    addMusicProjectStep(project.id, todoInput.trim());
    setTodoInput('');
  };

  const artistName = (state.preferences.name || 'MOI').toUpperCase();

  return (
    <AnimatePresence>
      {/* Full-Screen Editorial [untitled] Project Page (sits cleanly below MiniAudioPlayer z-50!) */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 18 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="fixed inset-0 z-40 bg-white dark:bg-[#0c0c0f] text-slate-900 dark:text-zinc-100 flex flex-col overflow-hidden"
      >
        {/* Top Minimalist Circular-Pill Header Bar (exact [untitled] reference!) */}
        <header className="shrink-0 pt-[calc(env(safe-area-inset-top)+10px)] pb-2.5 px-4 sm:px-6 bg-white dark:bg-[#0c0c0f]">
          <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Retour"
              className="h-10 w-10 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 flex items-center justify-center hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer"
            >
              <ChevronLeft size={19} />
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={sharing}
                onClick={async () => {
                  setSharing(true);
                  try {
                    const res = await shareOrCopyPublicLink({
                      kind: 'project',
                      id: project.id,
                      title: project.title,
                      firebaseConfig: state.preferences.firebaseConfig,
                    });
                    notify(
                      res.method === 'native'
                        ? `Projet « ${project.title} » partagé ✓`
                        : `Lien public du projet copié ✓ (écoute sans compte)`
                    );
                  } catch (err) {
                    notify(`Partage : ${(err as Error).message}`);
                  } finally {
                    setSharing(false);
                  }
                }}
                title="Partager ce projet (lien d’écoute publique sans compte)"
                className="h-10 w-10 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 flex items-center justify-center hover:bg-slate-200/80 dark:hover:bg-zinc-800 disabled:opacity-50 transition cursor-pointer"
              >
                {sharing ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={16} />}
              </button>
              <button
                type="button"
                onClick={() => todoSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}
                title="Voir la TODO"
                className="h-10 px-3.5 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 inline-flex items-center gap-1.5 text-xs font-semibold hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                <ListChecks size={15} />
                <span className="font-mono text-[11px]">
                  {doneSteps}/{totalSteps}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowEditMeta((v) => !v)}
                title="Modifier pochette & détails"
                className={`h-10 w-10 rounded-full flex items-center justify-center transition cursor-pointer ${
                  showEditMeta
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                    : 'bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 hover:bg-slate-200/80 dark:hover:bg-zinc-800'
                }`}
              >
                <SlidersHorizontal size={15} />
              </button>
            </div>
          </div>
        </header>

        {/* Scrollable Editorial Album Content */}
        <div
          className={`flex-1 overflow-y-auto px-5 sm:px-6 ${
            player.currentTrack ? 'pb-44' : 'pb-16'
          }`}
        >
          <div className="max-w-lg mx-auto space-y-5 pt-2">
            {/* Centered Large Square Album Cover (exact [untitled] reference!) */}
            <div className="flex justify-center">
              <div
                onClick={() => coverInputRef.current?.click()}
                className="relative group w-full max-w-[300px] aspect-square rounded-[22px] overflow-hidden shadow-[0_18px_50px_-14px_rgba(15,23,42,0.28)] dark:shadow-[0_24px_60px_-14px_rgba(0,0,0,0.85)] border border-slate-200/60 dark:border-zinc-800 cursor-pointer"
              >
                <ProjectCoverArtwork
                  title={project.title}
                  projectCoverUrl={project.coverDataUrl}
                  trackCoverUrls={getProjectTrackIndividualCovers(projectTracks)}
                  gradientId={project.coverGradient}
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 text-white flex flex-col items-center justify-center gap-1.5 text-xs font-medium transition">
                  <Camera size={20} />
                  Changer la pochette
                </div>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleCoverUpload(e.target.files?.[0])}
                  className="hidden"
                />
              </div>
            </div>

            {/* Collapsible Cover Gradients & Project Metadata Drawer */}
            <AnimatePresence>
              {showEditMeta && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/60 p-4 space-y-3 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {PROJECT_GRADIENTS.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          title={g.label}
                          onClick={() =>
                            updateMusicProject(project.id, {
                              coverGradient: g.id,
                              coverDataUrl: undefined,
                            })
                          }
                          className={`h-5 w-5 rounded-full bg-gradient-to-br ${g.css} cursor-pointer transition ${
                            !project.coverDataUrl && (project.coverGradient || 'pink') === g.id
                              ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-zinc-100 dark:ring-offset-zinc-900'
                              : 'opacity-75 hover:opacity-100'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2.5">
                      {project.coverDataUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            updateMusicProject(project.id, { coverDataUrl: undefined });
                            notify('Pochette du projet retirée (pochettes individuelles des sons actives)');
                          }}
                          className="text-xs font-medium text-rose-500 hover:underline cursor-pointer"
                        >
                          Retirer pochette
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="text-xs font-semibold text-slate-700 dark:text-zinc-200 underline cursor-pointer"
                      >
                        Importer photo
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={project.kind}
                      onChange={(e) =>
                        updateMusicProject(project.id, { kind: e.target.value as ProjectKind })
                      }
                      className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs font-medium"
                    >
                      <option value="single">Single</option>
                      <option value="ep">EP</option>
                      <option value="album">Album</option>
                      <option value="mixtape">Mixtape</option>
                    </select>
                    <select
                      value={project.status}
                      onChange={(e) =>
                        updateMusicProject(project.id, {
                          status: e.target.value as MusicProject['status'],
                        })
                      }
                      className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs font-medium"
                    >
                      <option value="en-cours">En cours</option>
                      <option value="mix">Mix / Master</option>
                      <option value="pret">Prêt</option>
                      <option value="sorti">Sorti</option>
                    </select>
                    <input
                      type="date"
                      value={project.targetReleaseDate || ''}
                      onChange={(e) =>
                        updateMusicProject(project.id, {
                          targetReleaseDate: e.target.value || undefined,
                        })
                      }
                      className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-2 font-mono text-[11px]"
                    />
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        deleteMusicProject(project.id);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline cursor-pointer"
                    >
                      <Trash2 size={12} /> Supprimer ce projet
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Editorial Title + Dark Rounded-Square Play Button Row (exact [untitled] reference!) */}
            <div className="flex items-start justify-between gap-4 pt-1">
              <div className="min-w-0 flex-1 space-y-1">
                <input
                  type="text"
                  value={project.title}
                  onChange={(e) => updateMusicProject(project.id, { title: e.target.value })}
                  placeholder="NOM DU PROJET"
                  className="w-full text-2xl sm:text-[26px] font-bold tracking-tight leading-tight uppercase bg-transparent text-slate-950 dark:text-zinc-50 outline-none"
                />
                <p className="text-xs font-medium tracking-wide text-slate-400 dark:text-zinc-500">
                  {artistName} · {projectTracks.length} {projectTracks.length > 1 ? 'titres' : 'titre'}
                  {totalSec > 0 ? ` · ${fmtTotalDuration(totalSec)}` : ''}
                </p>
              </div>

              <button
                type="button"
                onClick={handlePlayAlbum}
                aria-label="Lire le projet"
                className="h-12 w-12 rounded-2xl bg-slate-950 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-md shrink-0 cursor-pointer mt-0.5"
              >
                {isPlayingThisProject ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" className="ml-0.5" />
                )}
              </button>
            </div>

            {/* Full-Width Soft Action Pill (matches "Save to library" pill in [untitled]!) */}
            <button
              type="button"
              onClick={() => setShowAddTrack((v) => !v)}
              className="w-full rounded-2xl bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800/90 py-3 px-4 flex items-center justify-center gap-2 text-xs font-semibold text-slate-900 dark:text-zinc-100 transition cursor-pointer"
            >
              <Plus size={15} />
              <span>Ajouter un son à ce projet</span>
            </button>

            {/* Collapsible Library Track Picker */}
            <AnimatePresence>
              {showAddTrack && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-3.5 space-y-2 overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                      Tes MP3 disponibles ({availableTracks.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddTrack(false)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {availableTracks.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">
                      Tous tes MP3 sont déjà dans ce projet. Importe-en d’autres dans « MP3 & Prods ».
                    </p>
                  ) : (
                    <div className="max-h-44 overflow-y-auto space-y-1">
                      {availableTracks.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleAddTrackToProject(t.id)}
                          className="w-full flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 px-3 py-2 text-left hover:border-slate-400 dark:hover:border-zinc-600 transition cursor-pointer"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Music2 size={13} className="text-fuchsia-500 shrink-0" />
                            <span className="text-xs font-medium truncate">
                              {t.manualGroupTitle || t.title}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300 shrink-0">
                            <Plus size={12} /> Ajouter
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Airy Minimalist Numbered Tracklist (exact [untitled] reference!) */}
            <div className="divide-y divide-slate-100 dark:divide-zinc-900">
              {projectTracks.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  Aucun titre dans ce projet — clique sur « Ajouter un son » ci-dessus.
                </p>
              ) : (
                projectTracks.map((trk, idx) => {
                  const isCur = player.currentTrack?.id === trk.id;
                  const playing = isCur && player.isPlaying;
                  const menuOpen = openTrackMenuId === trk.id;
                  const trkGroup = allGroups.find((g) => g.allTrackIds.includes(trk.id));
                  const linkedLyrics = findLinkedLyricsForTrack(
                    trk,
                    state.lyricsDocs,
                    trkGroup?.allTrackIds,
                    trkGroup?.versions.map((v) => v.track)
                  );
                  const lyricsMeta = linkedLyrics ? LYRICS_STATUS_META[linkedLyrics.status || 1] : null;
                  const trkOwnCover =
                    trk.coverDataUrl ||
                    trk.cloudCoverUrl ||
                    trkGroup?.versions.find((v) => Boolean(v.track.coverDataUrl))?.track
                      .coverDataUrl ||
                    trkGroup?.versions.find((v) => Boolean(v.track.cloudCoverUrl))?.track
                      .cloudCoverUrl ||
                    null;
                  const rowThumb = project.coverDataUrl || trkOwnCover;
                  return (
                    <div key={trk.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const sameQueue =
                              player.queue.length === projectTracks.length &&
                              player.queue.every((q, i) => q.id === projectTracks[i].id);
                            if (isCur && sameQueue) {
                              player.togglePlay();
                            } else {
                              void player.playTrack(trk, 0, projectTracks);
                            }
                          }}
                          className="flex items-center gap-4 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="w-5 text-center font-mono text-xs text-slate-400 dark:text-zinc-500 shrink-0">
                            {playing ? (
                              <Pause
                                size={13}
                                className="mx-auto text-slate-950 dark:text-white"
                                fill="currentColor"
                              />
                            ) : (
                              idx + 1
                            )}
                          </span>
                          {/* Track Cover Thumbnail: project cover if set, otherwise each track's individual cover */}
                          {rowThumb && (
                            <img
                              src={rowThumb}
                              alt={trk.manualGroupTitle || trk.title}
                              className="h-9 w-9 rounded-lg object-cover border border-slate-200/70 dark:border-zinc-800 shrink-0"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-semibold truncate ${
                                isCur
                                  ? 'text-fuchsia-600 dark:text-fuchsia-400'
                                  : 'text-slate-900 dark:text-zinc-100'
                              }`}
                            >
                              {trk.manualGroupTitle || trk.title}
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              <p className="text-xs text-slate-400 dark:text-zinc-500">
                                {fmtAddedDate(trk.modifiedAt || trk.addedAt) ||
                                  state.preferences.name ||
                                  trk.artist}
                                {trk.bpm ? ` · ${trk.bpm} BPM` : ''}
                              </p>
                              {lyricsMeta && (
                                <span
                                  title={`Texte lié : ${linkedLyrics?.title || ''} (${lyricsMeta.label})`}
                                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${lyricsMeta.badge}`}
                                >
                                  <FileText size={9} className="shrink-0 opacity-80" />
                                  <span>{lyricsMeta.label}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-0.5 shrink-0">
                          {onOpenTrackDetails && (
                            <button
                              type="button"
                              onClick={() => onOpenTrackDetails(trk.id)}
                              title="Ouvrir la page du son"
                              aria-label="Ouvrir la page du son"
                              className="p-2 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-900 cursor-pointer"
                            >
                              <ChevronRight size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setOpenTrackMenuId(menuOpen ? null : trk.id)}
                            className="p-2 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-900 cursor-pointer"
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        </div>
                      </div>

                      {menuOpen && (
                        <div className="mt-2 ml-9 space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {onOpenTrackDetails && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenTrackMenuId(null);
                                  onOpenTrackDetails(trk.id);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                              >
                                Page du son
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (renamingTrackId === trk.id) {
                                  setRenamingTrackId(null);
                                } else {
                                  setRenamingTrackId(trk.id);
                                  setRenameDraft(trk.manualGroupTitle || trk.title);
                                }
                              }}
                              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium cursor-pointer transition ${
                                renamingTrackId === trk.id
                                  ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                                  : 'bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300'
                              }`}
                            >
                              <Pencil size={11} /> Renommer
                            </button>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveTrack(idx, -1)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 disabled:opacity-30 cursor-pointer"
                            >
                              <ChevronUp size={12} /> Monter
                            </button>
                            <button
                              type="button"
                              disabled={idx === projectTracks.length - 1}
                              onClick={() => handleMoveTrack(idx, 1)}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 disabled:opacity-30 cursor-pointer"
                            >
                              <ChevronDown size={12} /> Descendre
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTrackFromProject(trk.id)}
                              className="inline-flex items-center gap-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 cursor-pointer"
                            >
                              <X size={12} /> Retirer
                            </button>
                          </div>

                          {renamingTrackId === trk.id && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const clean = renameDraft.trim();
                                if (!clean) return;
                                const allGroups = groupMusicTracks(state.musicTracks);
                                const grp = allGroups.find((g) => g.allTrackIds.includes(trk.id));
                                const ids =
                                  grp && grp.allTrackIds.length > 0 ? grp.allTrackIds : [trk.id];
                                renameTrackGroup(ids, clean);
                                notify(`Morceau renommé en « ${clean} » ✓`);
                                setRenamingTrackId(null);
                                setOpenTrackMenuId(null);
                              }}
                              className="flex items-center gap-1.5 max-w-sm"
                            >
                              <input
                                autoFocus
                                type="text"
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                placeholder="Nouveau nom du morceau…"
                                className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-zinc-100 outline-none focus:border-slate-400"
                              />
                              <button
                                type="submit"
                                className="rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1.5 text-xs font-semibold cursor-pointer shrink-0"
                              >
                                OK
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingTrackId(null)}
                                className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer shrink-0"
                              >
                                <X size={13} />
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Integrated Project TODO Checklist */}
            <section
              ref={todoSectionRef}
              className="pt-4 border-t border-slate-100 dark:border-zinc-900 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <ListChecks size={14} /> TODO du projet
                </h3>
                <span className="font-mono text-xs font-semibold text-slate-700 dark:text-zinc-300">
                  {doneSteps}/{totalSteps} ({todoPct}%)
                </span>
              </div>

              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 overflow-hidden">
                <div
                  className="h-full bg-slate-900 dark:bg-zinc-100 rounded-full transition-all duration-300"
                  style={{ width: `${todoPct}%` }}
                />
              </div>

              <div className="space-y-1">
                {project.steps.map((step) => (
                  <div
                    key={step.id}
                    className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-zinc-900/60"
                  >
                    <CheckCircle
                      checked={step.done}
                      onToggle={() => toggleMusicProjectStep(project.id, step.id)}
                      accent="violet"
                      size="sm"
                    />
                    <span
                      className={`flex-1 text-sm ${
                        step.done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-zinc-200'
                      }`}
                    >
                      {step.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteMusicProjectStep(project.id, step.id)}
                      className="opacity-60 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddTodo} className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={todoInput}
                  onChange={(e) => setTodoInput(e.target.value)}
                  placeholder="+ Ajouter une tâche TODO…"
                  className="flex-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-slate-900/15 dark:focus:ring-zinc-100/20"
                />
                {todoInput.trim() && (
                  <button
                    type="submit"
                    className="rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2.5 text-xs font-semibold cursor-pointer"
                  >
                    Ajouter
                  </button>
                )}
              </form>
            </section>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
