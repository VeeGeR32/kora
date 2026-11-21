import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Disc3,
  FileText,
  FolderKanban,
  GitBranch,
  Link2,
  ListChecks,
  Pause,
  Play,
  Plus,
  Star,
  Tag,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import type { MusicTrack, TrackStatus } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { getMediaObjectUrl } from '../../lib/mediaDb';
import type { TrackGroup } from '../../lib/musicVersioning';
import { getDeterministicGradientId } from '../../lib/musicVersioning';
import { TRACK_STATUS_META } from '../../utils/theme';
import { CheckCircle } from '../ui/CheckCircle';
import { getGradientClass, PROJECT_GRADIENTS } from './MiniAudioPlayer';

interface TrackDetailModalProps {
  group: TrackGroup | null;
  selectedTrackId: string | null;
  onSelectVersion: (trackId: string) => void;
  onOpenLyrics: (track: MusicTrack) => void;
  onRequestPullVersion: (group: TrackGroup, trackId: string) => void;
  onRequestAttachToOther: (group: TrackGroup, trackId: string) => void;
  onDetachVersion: (trackId: string) => void;
  onClose: () => void;
}

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });
}

async function resizeTrackCover(file: File, maxSize = 360): Promise<string> {
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

export function TrackDetailModal({
  group,
  selectedTrackId,
  onSelectVersion,
  onOpenLyrics,
  onRequestPullVersion,
  onRequestAttachToOther,
  onDetachVersion,
  onClose,
}: TrackDetailModalProps) {
  const {
    state,
    updateMusicTrack,
    setTrackGroupFavorite,
    addMusicTrackTodo,
    toggleMusicTrackTodo,
    deleteMusicTrackTodo,
    addTrackMarker,
    deleteTrackMarker,
    deleteMusicTrack,
    updateMusicProject,
    notify,
  } = useApp();
  const player = useAudioPlayer();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const [todoInput, setTodoInput] = useState('');
  const [markerLabel, setMarkerLabel] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const activeEntry = useMemo(() => {
    if (!group) return null;
    if (selectedTrackId) {
      const found = group.versions.find((v) => v.track.id === selectedTrackId);
      if (found) return found;
    }
    return group.versions[0] || null;
  }, [group, selectedTrackId]);

  const track = activeEntry?.track || null;

  useEffect(() => {
    let alive = true;
    if (!track) {
      setCoverUrl(null);
      return;
    }
    if (track.coverDataUrl) {
      setCoverUrl(track.coverDataUrl);
    } else if (track.coverMediaId) {
      getMediaObjectUrl(track.coverMediaId).then((u) => alive && setCoverUrl(u));
    } else if (track.cloudCoverUrl) {
      setCoverUrl(track.cloudCoverUrl);
    } else {
      setCoverUrl(null);
    }
    return () => {
      alive = false;
    };
  }, [track?.id, track?.coverDataUrl, track?.coverMediaId, track?.cloudCoverUrl]);

  if (!group || !activeEntry || !track) return null;

  const isCurrent = player.currentTrack?.id === track.id;
  const isPlaying = isCurrent && player.isPlaying;
  const todos = track.todos || [];
  const doneTodos = todos.filter((td) => td.done).length;
  const todoPct = todos.length > 0 ? Math.round((doneTodos / todos.length) * 100) : 0;
  const gradCls = getGradientClass(
    track.coverGradient || getDeterministicGradientId(group.groupKey)
  );
  const allGroupTrackIds = group.versions.map((v) => v.track.id);

  const handleUploadCover = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await resizeTrackCover(file);
      updateMusicTrack(track.id, { coverDataUrl: dataUrl });
      notify('Pochette du son mise à jour ✓');
    } catch {
      notify('Impossible de lire cette image');
    }
  };

  const handleAssignProject = (projectId: string) => {
    const prevProjectId = track.linkedProjectId;
    updateMusicTrack(track.id, { linkedProjectId: projectId || undefined });
    if (prevProjectId && prevProjectId !== projectId) {
      const oldProj = state.musicProjects.find((p) => p.id === prevProjectId);
      if (oldProj) {
        updateMusicProject(oldProj.id, {
          trackIds: oldProj.trackIds.filter((id) => id !== track.id),
        });
      }
    }
    if (projectId) {
      const targetProj = state.musicProjects.find((p) => p.id === projectId);
      if (targetProj && !targetProj.trackIds.includes(track.id)) {
        updateMusicProject(targetProj.id, {
          trackIds: [...targetProj.trackIds, track.id],
        });
      }
      notify(`Ajouté au projet « ${targetProj?.title || ''} » ✓`);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/45 dark:bg-black/75 backdrop-blur-xs"
        />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 390, damping: 32 }}
          className="relative z-10 w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#111114] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        >
          {/* Top Bar */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-zinc-800/80 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-zinc-200">
                <GitBranch size={11} />
                {activeEntry.versionLabel}
              </span>
              {activeEntry.isLatest && group.hasMultipleVersions && (
                <span className="rounded-full bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400 px-2 py-0.5 text-[10px] font-semibold">
                  Dernière version
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setTrackGroupFavorite(allGroupTrackIds, !group.isFavorite);
                  notify(
                    !group.isFavorite
                      ? `« ${group.baseTitle} » ajouté aux favoris ★`
                      : `« ${group.baseTitle} » retiré des favoris`
                  );
                }}
                title={group.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition cursor-pointer ${
                  group.isFavorite
                    ? 'text-amber-400 bg-amber-400/12'
                    : 'text-slate-400 hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Star size={16} fill={group.isFavorite ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Scrollable Body */}
          <div className="p-5 overflow-y-auto space-y-6 flex-1">
            {/* Hero Cover + Title + Play */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
              <div className="relative group shrink-0">
                <div className="h-32 w-32 rounded-[22px] overflow-hidden shadow-lg border border-slate-200/70 dark:border-zinc-800">
                  {coverUrl ? (
                    <img src={coverUrl} alt={track.title} className="h-full w-full object-cover" />
                  ) : (
                    <div
                      className={`h-full w-full bg-gradient-to-br ${gradCls} flex items-center justify-center`}
                    >
                      <Disc3 size={34} className="text-white/85" />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  title="Changer la pochette"
                  className="absolute inset-0 rounded-[22px] bg-black/45 opacity-0 group-hover:opacity-100 text-white flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition cursor-pointer"
                >
                  <Camera size={16} />
                  Pochette
                </button>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleUploadCover(e.target.files?.[0])}
                  className="hidden"
                />
              </div>

              <div className="flex-1 min-w-0 w-full space-y-2.5 text-center sm:text-left">
                <div>
                  <input
                    type="text"
                    value={track.title}
                    onChange={(e) => updateMusicTrack(track.id, { title: e.target.value })}
                    className="w-full bg-transparent text-lg font-bold tracking-tight text-slate-900 dark:text-zinc-50 outline-none border-b border-transparent focus:border-slate-300 dark:focus:border-zinc-700 pb-0.5 text-center sm:text-left"
                  />
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 truncate">
                    {group.baseTitle}
                    {track.durationSec ? ` · ${fmt(track.durationSec)}` : ''}
                    {track.modifiedAt || track.addedAt
                      ? ` · ${fmtDate(track.modifiedAt || track.addedAt)}`
                      : ''}
                  </p>
                </div>

                {/* Quick Gradient Swatches */}
                <div className="flex items-center justify-center sm:justify-start gap-1.5">
                  {PROJECT_GRADIENTS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() =>
                        updateMusicTrack(track.id, {
                          coverGradient: g.id,
                          coverDataUrl: undefined,
                        })
                      }
                      title={g.label}
                      className={`h-4 w-4 rounded-full bg-gradient-to-br ${g.css} transition cursor-pointer ${
                        (track.coverGradient || getDeterministicGradientId(group.groupKey)) === g.id &&
                        !coverUrl
                          ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-zinc-950 scale-110'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>

                {/* Action Pills */}
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      isCurrent
                        ? player.togglePlay()
                        : void player.playTrack(
                            track,
                            0,
                            group.versions.map((v) => v.track)
                          )
                    }
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold hover:opacity-92 active:scale-95 transition cursor-pointer"
                  >
                    {isPlaying ? (
                      <>
                        <Pause size={13} fill="currentColor" /> Pause
                      </>
                    ) : (
                      <>
                        <Play size={13} fill="currentColor" className="ml-0.5" /> Écouter
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onOpenLyrics(track);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-zinc-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 transition cursor-pointer"
                  >
                    <FileText size={13} className="text-fuchsia-500" />
                    {track.linkedLyricsId ? 'Ouvrir texte' : '+ Texte LexCore'}
                  </button>
                </div>
              </div>
            </div>

            {/* Versions Switcher + Manual Linking / Detaching */}
            <section className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <GitBranch size={12} /> Versions de {group.baseTitle} ({group.versions.length})
                </h3>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRequestPullVersion(group, track.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-fuchsia-500/12 hover:bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-400 px-2 py-1 text-[11px] font-semibold transition cursor-pointer"
                  >
                    <Plus size={11} /> Ajouter une version
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestAttachToOther(group, track.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300 px-2 py-1 text-[11px] font-medium transition cursor-pointer"
                  >
                    <Link2 size={11} /> Rattacher à…
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {group.versions.map((v) => {
                  const selected = v.track.id === track.id;
                  const playingThis =
                    player.currentTrack?.id === v.track.id && player.isPlaying;
                  return (
                    <div
                      key={v.track.id}
                      className={`inline-flex items-center rounded-xl border transition overflow-hidden ${
                        selected
                          ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border-slate-900 dark:border-zinc-100 shadow-xs'
                          : 'bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-slate-200/80 dark:border-zinc-800 hover:border-slate-400 dark:hover:border-zinc-600'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectVersion(v.track.id);
                          void player.playTrack(
                            v.track,
                            0,
                            group.versions.map((x) => x.track)
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer"
                      >
                        <span className="font-mono font-semibold">{v.versionLabel}</span>
                        {v.isLatest && (
                          <span
                            className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                              selected
                                ? 'bg-white/20 text-white dark:bg-black/15 dark:text-zinc-950'
                                : 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400'
                            }`}
                          >
                            Actuelle
                          </span>
                        )}
                        {playingThis && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                      </button>

                      {group.hasMultipleVersions && (
                        <button
                          type="button"
                          title="Détacher cette version en son indépendant"
                          onClick={() => onDetachVersion(v.track.id)}
                          className={`pr-2 pl-1 py-1.5 opacity-60 hover:opacity-100 transition cursor-pointer ${
                            selected ? 'hover:text-rose-300 dark:hover:text-rose-600' : 'hover:text-rose-500'
                          }`}
                        >
                          <Unlink size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Description (like a Project!) */}
            <section className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Description & direction artistique
              </label>
              <textarea
                rows={3}
                value={track.description || ''}
                onChange={(e) => updateMusicTrack(track.id, { description: e.target.value })}
                placeholder="Ambiance, idées de couplet, retours de mix, effets à tester..."
                className="w-full rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 px-3.5 py-2.5 text-xs text-slate-800 dark:text-zinc-100 placeholder:text-slate-400 outline-none focus:border-slate-400 dark:focus:border-zinc-600 resize-none leading-relaxed"
              />
            </section>

            {/* TODO Checklist (just like a Project!) */}
            <section className="space-y-3 rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/35 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ListChecks size={14} className="text-fuchsia-500" />
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                    TODO du son
                  </h3>
                  {todos.length > 0 && (
                    <span className="font-mono text-[11px] text-slate-400">
                      {doneTodos}/{todos.length}
                    </span>
                  )}
                </div>
                {todos.length > 0 && (
                  <span className="font-mono text-[11px] font-semibold text-fuchsia-600 dark:text-fuchsia-400">
                    {todoPct}%
                  </span>
                )}
              </div>

              {todos.length > 0 && (
                <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden">
                  <div
                    style={{ width: `${todoPct}%` }}
                    className="h-full rounded-full bg-fuchsia-500 transition-all duration-300"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                {todos.length === 0 ? (
                  <p className="text-[11px] text-slate-400 py-1">
                    Aucune tâche pour ce son — ajoute tes prochaines modifs (ex. « Revoir la 808 », « Enregistrer refrain »).
                  </p>
                ) : (
                  todos.map((td) => (
                    <div
                      key={td.id}
                      className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 hover:bg-white/80 dark:hover:bg-zinc-800/60 transition group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <CheckCircle
                          checked={td.done}
                          onToggle={() => toggleMusicTrackTodo(track.id, td.id)}
                          accent="violet"
                        />
                        <button
                          type="button"
                          onClick={() => toggleMusicTrackTodo(track.id, td.id)}
                          className={`text-xs truncate text-left flex-1 cursor-pointer ${
                            td.done
                              ? 'line-through text-slate-400 dark:text-zinc-500'
                              : 'text-slate-800 dark:text-zinc-100'
                          }`}
                        >
                          {td.label}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteMusicTrackTodo(track.id, td.id)}
                        className="opacity-60 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!todoInput.trim()) return;
                  addMusicTrackTodo(track.id, todoInput);
                  setTodoInput('');
                }}
                className="flex items-center gap-2 pt-1"
              >
                <input
                  type="text"
                  value={todoInput}
                  onChange={(e) => setTodoInput(e.target.value)}
                  placeholder="+ Ajouter une tâche sur ce son…"
                  className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs outline-none focus:border-fuchsia-400"
                />
                <button
                  type="submit"
                  className="h-8 px-3 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={13} /> Ajouter
                </button>
              </form>
            </section>

            {/* Metadata Grid: Status, BPM, Key, Project */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Statut
                </label>
                <select
                  value={track.status}
                  onChange={(e) =>
                    updateMusicTrack(track.id, { status: e.target.value as TrackStatus })
                  }
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 text-xs outline-none"
                >
                  {(Object.keys(TRACK_STATUS_META) as TrackStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {TRACK_STATUS_META[st].label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  BPM
                </label>
                <input
                  type="number"
                  value={track.bpm || ''}
                  onChange={(e) =>
                    updateMusicTrack(track.id, {
                      bpm: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  placeholder="140"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 font-mono text-xs outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Tonalité
                </label>
                <input
                  type="text"
                  value={track.musicalKey || ''}
                  onChange={(e) =>
                    updateMusicTrack(track.id, { musicalKey: e.target.value || undefined })
                  }
                  placeholder="F#m"
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 text-xs outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <FolderKanban size={10} /> Projet
                </label>
                <select
                  value={track.linkedProjectId || ''}
                  onChange={(e) => handleAssignProject(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 text-xs outline-none"
                >
                  <option value="">Aucun</option>
                  {state.musicProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {/* Timestamped Markers */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Marqueurs horodatés
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                {track.markers.map((mk) => (
                  <span
                    key={mk.id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800 pl-2.5 pr-1.5 py-1 text-[11px] font-medium text-slate-700 dark:text-zinc-200"
                  >
                    <button
                      type="button"
                      onClick={() => void player.playTrack(track, mk.timeSec)}
                      className="inline-flex items-center gap-1 hover:text-fuchsia-600 dark:hover:text-fuchsia-400 cursor-pointer"
                    >
                      <Tag size={10} className="text-fuchsia-500" />
                      {mk.label}
                      <span className="font-mono text-[10px] text-slate-400">
                        {fmt(mk.timeSec)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTrackMarker(track.id, mk.id)}
                      className="text-slate-400 hover:text-rose-500 cursor-pointer ml-0.5"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!markerLabel.trim()) return;
                    const timeSec = isCurrent ? Math.round(player.currentTime) : 0;
                    addTrackMarker(track.id, { label: markerLabel.trim(), timeSec });
                    setMarkerLabel('');
                  }}
                  className="inline-flex items-center gap-1"
                >
                  <input
                    type="text"
                    value={markerLabel}
                    onChange={(e) => setMarkerLabel(e.target.value)}
                    placeholder={`+ Marqueur (${isCurrent ? fmt(player.currentTime) : '0:00'})`}
                    className="w-40 rounded-full border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] outline-none focus:border-fuchsia-400"
                  />
                </form>
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-between bg-slate-50/60 dark:bg-zinc-950/40 shrink-0">
            <button
              type="button"
              onClick={() => {
                deleteMusicTrack(track.id);
                if (group.versions.length <= 1) onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
            >
              <Trash2 size={13} />
              Supprimer {group.hasMultipleVersions ? activeEntry.versionLabel : 'ce son'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-1.5 text-xs font-semibold cursor-pointer"
            >
              Fermer
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
