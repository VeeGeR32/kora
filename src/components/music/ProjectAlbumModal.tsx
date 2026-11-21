import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Music2,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { MusicProject, ProjectKind } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { CheckCircle } from '../ui/CheckCircle';
import { getGradientClass, PROJECT_GRADIENTS } from './MiniAudioPlayer';

interface ProjectAlbumModalProps {
  projectId: string | null;
  onClose: () => void;
}

function fmtSec(sec?: number) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function resizeProjectCover(file: File, maxSize = 420): Promise<string> {
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
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProjectAlbumModal({ projectId, onClose }: ProjectAlbumModalProps) {
  const {
    state,
    updateMusicProject,
    toggleMusicProjectStep,
    addMusicProjectStep,
    deleteMusicProjectStep,
    deleteMusicProject,
    updateMusicTrack,
    notify,
  } = useApp();
  const player = useAudioPlayer();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const [todoInput, setTodoInput] = useState('');
  const [showAddTrack, setShowAddTrack] = useState(false);

  const project: MusicProject | null = useMemo(
    () => (projectId ? state.musicProjects.find((p) => p.id === projectId) || null : null),
    [projectId, state.musicProjects]
  );

  // Ordered tracklist for this album/EP
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
      notify('Ajoute au moins un son à ce projet pour lancer l’écoute');
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

  const gradCls = getGradientClass(project.coverGradient);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/45 dark:bg-black/75 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          className="relative z-10 w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#111114] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col"
        >
          {/* Top Bar */}
          <div className="px-5 py-3.5 border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Aperçu {project.kind.toUpperCase()}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  deleteMusicProject(project.id);
                  onClose();
                }}
                title="Supprimer ce projet"
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-zinc-100 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="p-5 overflow-y-auto space-y-6">
            {/* Album Hero Section ([untitled] style) */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              {/* Square Album Cover + Upload + Gradient Swatches */}
              <div className="space-y-2.5 shrink-0 flex flex-col items-center">
                <div className="relative group h-44 w-44 rounded-3xl overflow-hidden shadow-lg border border-slate-200/70 dark:border-zinc-800">
                  {project.coverDataUrl ? (
                    <img
                      src={project.coverDataUrl}
                      alt={project.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className={`h-full w-full bg-gradient-to-br ${gradCls}`} />
                  )}

                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 text-white flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition cursor-pointer"
                  >
                    <Camera size={18} />
                    Pochette
                  </button>

                  {/* Floating Bottom-Right Play Button ([untitled] signature!) */}
                  <button
                    type="button"
                    onClick={handlePlayAlbum}
                    aria-label="Lire le projet"
                    className="absolute bottom-3 right-3 h-11 w-11 rounded-2xl bg-slate-950/85 text-white flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg backdrop-blur-xs cursor-pointer"
                  >
                    {isPlayingThisProject ? (
                      <Pause size={17} fill="currentColor" />
                    ) : (
                      <Play size={17} fill="currentColor" className="ml-0.5" />
                    )}
                  </button>

                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => void handleCoverUpload(e.target.files?.[0])}
                    className="hidden"
                  />
                </div>

                {/* Gradient Swatches + Photo Upload Link */}
                <div className="flex items-center gap-1.5">
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
                      className={`h-4 w-4 rounded-full bg-gradient-to-br ${g.css} cursor-pointer transition ${
                        !project.coverDataUrl && (project.coverGradient || 'pink') === g.id
                          ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-zinc-100 dark:ring-offset-[#111114]'
                          : 'opacity-75 hover:opacity-100'
                      }`}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    className="ml-1 text-[10px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 underline cursor-pointer"
                  >
                    Image
                  </button>
                </div>
              </div>

              {/* Album Metadata Editor */}
              <div className="flex-1 min-w-0 w-full space-y-3 text-center sm:text-left">
                <input
                  type="text"
                  value={project.title}
                  onChange={(e) => updateMusicProject(project.id, { title: e.target.value })}
                  placeholder="Titre du projet"
                  className="w-full text-xl font-bold tracking-tight bg-transparent text-slate-900 dark:text-zinc-50 outline-none border-b border-transparent focus:border-slate-300 dark:focus:border-zinc-700 pb-0.5 text-center sm:text-left"
                />

                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {state.preferences.name || 'Moi'} · {projectTracks.length} son
                  {projectTracks.length > 1 ? 's' : ''}
                  {totalSec > 0 ? ` · ${fmtSec(totalSec)}` : ''}
                </p>

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <select
                    value={project.kind}
                    onChange={(e) =>
                      updateMusicProject(project.id, { kind: e.target.value as ProjectKind })
                    }
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-medium cursor-pointer"
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
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1.5 text-xs font-medium cursor-pointer"
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
                    className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>

                <div className="pt-1 flex items-center justify-center sm:justify-start gap-2">
                  <button
                    type="button"
                    onClick={handlePlayAlbum}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold hover:opacity-90 cursor-pointer"
                  >
                    {isPlayingThisProject ? (
                      <>
                        <Pause size={13} fill="currentColor" /> Pause
                      </>
                    ) : (
                      <>
                        <Play size={13} fill="currentColor" /> Lire ({projectTracks.length})
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddTrack((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Plus size={13} /> Ajouter un son
                  </button>
                </div>
              </div>
            </div>

            {/* Add Track Picker Dropdown */}
            <AnimatePresence>
              {showAddTrack && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 p-3.5 space-y-2 overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-zinc-200">
                      Ajouter depuis ta bibliothèque MP3
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddTrack(false)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {availableTracks.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">
                      Tous tes MP3 sont déjà dans ce projet (importe-en d’autres dans « MP3 & Prods »).
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {availableTracks.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleAddTrackToProject(t.id)}
                          className="w-full flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 px-3 py-2 text-left hover:border-slate-400 dark:hover:border-zinc-600 transition cursor-pointer"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Music2 size={13} className="text-fuchsia-500 shrink-0" />
                            <span className="text-xs font-medium truncate">{t.title}</span>
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

            {/* Tracklist Section */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Tracklist ({projectTracks.length})
                </h3>
              </div>

              {projectTracks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800 py-6 text-center space-y-1.5">
                  <p className="text-xs text-slate-400">Aucun son dans ce projet pour l’instant.</p>
                  <button
                    type="button"
                    onClick={() => setShowAddTrack(true)}
                    className="text-xs font-semibold text-fuchsia-600 dark:text-fuchsia-400 hover:underline cursor-pointer"
                  >
                    + Ajouter des sons depuis ma bibliothèque
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-zinc-800/80 rounded-2xl border border-slate-200/70 dark:border-zinc-800/80 overflow-hidden">
                  {projectTracks.map((trk, idx) => {
                    const isCur = player.currentTrack?.id === trk.id;
                    const playing = isCur && player.isPlaying;
                    return (
                      <div
                        key={trk.id}
                        className={`flex items-center justify-between gap-2 px-3.5 py-2.5 transition ${
                          isCur
                            ? 'bg-fuchsia-500/8 dark:bg-fuchsia-500/12'
                            : 'hover:bg-slate-50 dark:hover:bg-zinc-900/60'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            isCur
                              ? player.togglePlay()
                              : void player.playTrack(trk, 0, projectTracks)
                          }
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="font-mono text-[11px] text-slate-400 w-5 text-center shrink-0">
                            {playing ? (
                              <Pause size={12} className="mx-auto text-fuchsia-600 dark:text-fuchsia-400" fill="currentColor" />
                            ) : (
                              String(idx + 1).padStart(2, '0')
                            )}
                          </span>
                          <div className="min-w-0">
                            <p
                              className={`text-xs font-semibold truncate ${
                                isCur
                                  ? 'text-fuchsia-700 dark:text-fuchsia-300'
                                  : 'text-slate-900 dark:text-zinc-100'
                              }`}
                            >
                              {trk.title}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono">
                              {trk.artist}
                              {trk.bpm ? ` · ${trk.bpm} BPM` : ''}
                              {trk.durationSec ? ` · ${fmtSec(trk.durationSec)}` : ''}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveTrack(idx, -1)}
                            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 disabled:opacity-20 cursor-pointer"
                            title="Monter"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === projectTracks.length - 1}
                            onClick={() => handleMoveTrack(idx, 1)}
                            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 disabled:opacity-20 cursor-pointer"
                            title="Descendre"
                          >
                            <ChevronDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveTrackFromProject(trk.id)}
                            className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                            title="Retirer du projet"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Integrated Project TODO List */}
            <section className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <ListChecks size={14} className="text-fuchsia-500" />
                  TODO du projet
                </h3>
                <span className="font-mono text-[11px] font-semibold text-fuchsia-600 dark:text-fuchsia-400">
                  {doneSteps}/{totalSteps} ({todoPct}%)
                </span>
              </div>

              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-fuchsia-600 rounded-full transition-all duration-300"
                  style={{ width: `${todoPct}%` }}
                />
              </div>

              <div className="space-y-1">
                {project.steps.map((step) => (
                  <div
                    key={step.id}
                    className="group flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-zinc-900/60"
                  >
                    <CheckCircle
                      checked={step.done}
                      onToggle={() => toggleMusicProjectStep(project.id, step.id)}
                      accent="violet"
                      size="sm"
                    />
                    <span
                      className={`flex-1 text-xs ${
                        step.done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-zinc-200'
                      }`}
                    >
                      {step.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteMusicProjectStep(project.id, step.id)}
                      className="opacity-60 sm:opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddTodo} className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={todoInput}
                  onChange={(e) => setTodoInput(e.target.value)}
                  placeholder="+ Ajouter une tâche TODO (mix, cover, clip, distrib…)"
                  className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-fuchsia-500"
                />
                {todoInput.trim() && (
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Ajouter
                  </button>
                )}
              </form>
            </section>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
