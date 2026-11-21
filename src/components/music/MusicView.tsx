import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarPlus,
  Disc3,
  Edit3,
  FileAudio,
  FileText,
  FolderKanban,
  HardDrive,
  ImagePlus,
  Music2,
  Pause,
  Play,
  Plus,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { MusicTrack, ProjectKind, TrackStatus } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { getMediaObjectUrl } from '../../lib/mediaDb';
import { formatShortDateFR, todayISO, uid } from '../../utils/dates';
import { TRACK_STATUS_META } from '../../utils/theme';
import { CheckCircle } from '../ui/CheckCircle';
import { LyricsStudio } from './LyricsStudio';
import { GoogleDrivePickerModal } from './GoogleDrivePickerModal';
import type { QuickAddContext } from '../QuickAddModal';

interface MusicViewProps {
  onOpenQuickAdd: (ctx?: QuickAddContext) => void;
}

type MusicSubTab = 'dashboard' | 'library' | 'lyrics';

function fmt(sec: number) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Deterministic decorative minimalist waveform bars for any track */
function TrackWaveform({
  track,
  isCurrent,
  progressPct,
  onSeekPct,
}: {
  track: MusicTrack;
  isCurrent: boolean;
  progressPct: number;
  onSeekPct: (pct: number) => void;
}) {
  const bars = useMemo(() => {
    let seed = track.id.split('').reduce((a, c) => a + c.charCodeAt(0), 17);
    return Array.from({ length: 40 }, () => {
      seed = (seed * 9301 + 49297) % 233280;
      return 22 + Math.round((seed / 233280) * 78);
    });
  }, [track.id]);

  return (
    <div
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onSeekPct(ratio);
      }}
      className="flex items-end gap-[2.5px] h-9 cursor-pointer select-none py-1"
      title="Cliquer pour avancer dans le morceau"
    >
      {bars.map((h, i) => {
        const barPct = ((i + 0.5) / bars.length) * 100;
        const active = isCurrent && barPct <= progressPct;
        return (
          <div
            key={i}
            style={{ height: `${h}%` }}
            className={`flex-1 rounded-full transition-colors ${
              active
                ? 'bg-fuchsia-600 dark:bg-fuchsia-400'
                : 'bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700'
            }`}
          />
        );
      })}
    </div>
  );
}

function CoverArt({ track, size = 48 }: { track: MusicTrack; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    if (track.coverMediaId) {
      getMediaObjectUrl(track.coverMediaId).then((u) => mounted && setUrl(u));
    } else if (track.cloudCoverUrl) {
      setUrl(track.cloudCoverUrl);
    } else {
      setUrl(null);
    }
    return () => {
      mounted = false;
    };
  }, [track.coverMediaId, track.cloudCoverUrl]);

  if (url) {
    return (
      <img
        src={url}
        alt={track.title}
        style={{ width: size, height: size }}
        className="rounded-xl object-cover shrink-0 border border-slate-200/70 dark:border-zinc-800"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-xl bg-gradient-to-br from-slate-900 via-fuchsia-950 to-violet-900 text-white flex items-center justify-center shrink-0"
    >
      <Disc3 size={Math.round(size * 0.44)} className="opacity-85" />
    </div>
  );
}

export function MusicView({ onOpenQuickAdd }: MusicViewProps) {
  const {
    state,
    addMusicTrack,
    updateMusicTrack,
    addTrackMarker,
    deleteTrackMarker,
    deleteMusicTrack,
    addMusicProject,
    toggleMusicProjectStep,
    addMusicProjectStep,
    deleteMusicProjectStep,
    deleteMusicProject,
    addLyricsDoc,
    saveAndOptionallySyncMedia,
    notify,
  } = useApp();

  const player = useAudioPlayer();
  const [subTab, setSubTab] = useState<MusicSubTab>('dashboard');
  const [selectedLyricsId, setSelectedLyricsId] = useState<string | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [markerLabel, setMarkerLabel] = useState('');
  const [stepInputs, setStepInputs] = useState<Record<string, string>>({});

  // New project quick modal inline
  const [showNewProj, setShowNewProj] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjKind, setNewProjKind] = useState<ProjectKind>('ep');
  const [newProjDate, setNewProjDate] = useState('');
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);

  const handleUploadAudioFiles = async (files: FileList | null, targetTrackId?: string) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const mediaId = uid('aud');
      const saved = await saveAndOptionallySyncMedia(mediaId, file, file.name);
      // Read duration cleanly
      const objectUrl = URL.createObjectURL(file);
      const durationSec = await new Promise<number>((resolve) => {
        const a = new Audio(objectUrl);
        a.onloadedmetadata = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(isFinite(a.duration) ? Math.round(a.duration) : 0);
        };
        a.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(0);
        };
      });

      if (targetTrackId) {
        updateMusicTrack(targetTrackId, {
          mediaId: saved.mediaId,
          cloudAudioUrl: saved.cloudUrl,
          durationSec: durationSec || undefined,
        });
        notify('Fichier audio associé');
      } else {
        const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
        addMusicTrack({
          title: cleanTitle,
          artist: state.preferences.name || 'Moi',
          mediaId: saved.mediaId,
          cloudAudioUrl: saved.cloudUrl,
          durationSec: durationSec || undefined,
          status: 'demo',
          tags: [],
          markers: [],
          addedAt: new Date().toISOString(),
        });
      }
    }
  };

  const handleUploadCover = async (trackId: string, file: File | undefined) => {
    if (!file) return;
    const coverId = uid('cov');
    const saved = await saveAndOptionallySyncMedia(coverId, file, file.name);
    updateMusicTrack(trackId, { coverMediaId: saved.mediaId, cloudCoverUrl: saved.cloudUrl });
    notify('Pochette mise à jour');
  };

  const openLinkedLyrics = (track: MusicTrack) => {
    if (track.linkedLyricsId) {
      setSelectedLyricsId(track.linkedLyricsId);
      setSubTab('lyrics');
      return;
    }
    const newDocId = addLyricsDoc({
      title: track.title,
      linkedTrackId: track.id,
      linkedProjectId: track.linkedProjectId,
    });
    updateMusicTrack(track.id, { linkedLyricsId: newDocId });
    setSelectedLyricsId(newDocId);
    setSubTab('lyrics');
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjTitle.trim()) return;
    addMusicProject({
      title: newProjTitle.trim(),
      kind: newProjKind,
      targetReleaseDate: newProjDate || undefined,
      status: 'en-cours',
      trackIds: [],
      steps: [
        { id: uid('ps'), label: 'Sélection des prods / MP3', done: false },
        { id: uid('ps'), label: 'Écriture des textes (LexCore)', done: false },
        { id: uid('ps'), label: 'Enregistrement voix', done: false },
        { id: uid('ps'), label: 'Mix / Master & Pochette', done: false },
      ],
    });
    setNewProjTitle('');
    setNewProjDate('');
    setShowNewProj(false);
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of state.musicTracks) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  }, [state.musicTracks]);

  return (
    <div className="space-y-5 pb-10">
      {/* Header + Sub-tabs */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Music
          </h1>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
            MP3 & marqueurs, écriture LexCore & projets musicaux
          </p>
        </div>

        <div className="inline-flex items-center rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 self-start sm:self-auto overflow-x-auto max-w-full">
          {(
            [
              ['dashboard', 'Dashboard', FolderKanban],
              ['library', 'MP3 & Prods', Disc3],
              ['lyrics', 'LexCore · Textes', FileText],
            ] as const
          ).map(([id, label, Icon]) => {
            const active = subTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSubTab(id)}
                className={`relative flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                  active
                    ? 'text-white dark:text-zinc-950'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="musicSubTabPill"
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-slate-900 dark:bg-zinc-100"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <Icon size={13} />
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= TAB 1: DASHBOARD & PROJETS ================= */}
      {subTab === 'dashboard' && (
        <div className="space-y-5">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Morceaux</p>
              <p className="font-mono text-2xl font-semibold tabular-nums mt-1">
                {state.musicTracks.length}
              </p>
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Textes LexCore</p>
              <p className="font-mono text-2xl font-semibold tabular-nums mt-1">
                {state.lyricsDocs.filter((d) => !d.deletedAt).length}
              </p>
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">En écriture / Mix</p>
              <p className="font-mono text-2xl font-semibold tabular-nums text-fuchsia-600 dark:text-fuchsia-400 mt-1">
                {(statusCounts.ecriture || 0) + (statusCounts.mix || 0) + (statusCounts.enregistrement || 0)}
              </p>
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Projets actifs</p>
              <p className="font-mono text-2xl font-semibold tabular-nums mt-1">
                {state.musicProjects.length}
              </p>
            </div>
          </div>

          {/* Visual Creations Shelf */}
          <section className="tempo-card rounded-3xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                Mes créations récentes
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenQuickAdd({ mode: 'music', date: todayISO() })}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <CalendarPlus size={13} />
                  Planifier session
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('library')}
                  className="text-xs font-medium text-fuchsia-600 dark:text-fuchsia-400 hover:underline cursor-pointer"
                >
                  Bibliothèque →
                </button>
              </div>
            </div>

            {state.musicTracks.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                Importe ton premier MP3 dans « MP3 & Prods ».
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {state.musicTracks.slice(0, 6).map((trk) => {
                  const active = player.currentTrack?.id === trk.id && player.isPlaying;
                  return (
                    <div
                      key={trk.id}
                      className="rounded-2xl border border-slate-100 dark:border-zinc-800/80 bg-slate-50/60 dark:bg-zinc-900/45 p-3.5 flex items-center gap-3 hover:border-fuchsia-300 dark:hover:border-fuchsia-800 transition"
                    >
                      <div className="relative group shrink-0">
                        <CoverArt track={trk} size={52} />
                        <button
                          type="button"
                          onClick={() =>
                            player.currentTrack?.id === trk.id
                              ? player.togglePlay()
                              : void player.playTrack(trk)
                          }
                          className="absolute inset-0 rounded-xl bg-black/45 opacity-90 sm:opacity-0 group-hover:opacity-100 text-white flex items-center justify-center transition cursor-pointer"
                        >
                          {active ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                          {trk.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TRACK_STATUS_META[trk.status].badge}`}>
                            {TRACK_STATUS_META[trk.status].label}
                          </span>
                          {trk.bpm && (
                            <span className="font-mono text-[10px] text-slate-400">
                              {trk.bpm} BPM
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => openLinkedLyrics(trk)}
                          className="mt-1.5 text-[11px] font-medium text-fuchsia-600 dark:text-fuchsia-400 hover:underline cursor-pointer"
                        >
                          {trk.linkedLyricsId ? 'Ouvrir texte LexCore →' : '+ Créer texte'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Projects & Goals */}
          <section className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                Projets & Objectifs (EP, Singles, Albums)
              </h2>
              <button
                type="button"
                onClick={() => setShowNewProj((v) => !v)}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-1.5 text-xs font-semibold cursor-pointer"
              >
                <Plus size={13} /> Nouveau projet
              </button>
            </div>

            {showNewProj && (
              <form
                onSubmit={handleCreateProject}
                className="tempo-card rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-2.5"
              >
                <input
                  autoFocus
                  type="text"
                  required
                  value={newProjTitle}
                  onChange={(e) => setNewProjTitle(e.target.value)}
                  placeholder="Nom du projet (ex. EP Minuit)"
                  className="sm:col-span-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                />
                <select
                  value={newProjKind}
                  onChange={(e) => setNewProjKind(e.target.value as ProjectKind)}
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                >
                  <option value="single">Single</option>
                  <option value="ep">EP</option>
                  <option value="album">Album</option>
                  <option value="mixtape">Mixtape</option>
                </select>
                <div className="flex gap-1.5">
                  <input
                    type="date"
                    value={newProjDate}
                    onChange={(e) => setNewProjDate(e.target.value)}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2 py-2 font-mono text-xs"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-fuchsia-600 text-white px-3 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Créer
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {state.musicProjects.map((proj) => {
                const done = proj.steps.filter((s) => s.done).length;
                const total = proj.steps.length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const linkedTracks = state.musicTracks.filter(
                  (t) => t.linkedProjectId === proj.id || proj.trackIds.includes(t.id)
                );

                return (
                  <div key={proj.id} className="tempo-card rounded-3xl p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300 px-2.5 py-0.5 text-[10px] font-semibold uppercase">
                            {proj.kind}
                          </span>
                          {proj.targetReleaseDate && (
                            <span className="font-mono text-[11px] text-slate-400">
                              Sortie visée : {formatShortDateFR(proj.targetReleaseDate)}
                            </span>
                          )}
                        </div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-zinc-100 mt-1.5">
                          {proj.title}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteMusicProject(proj.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Progress */}
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                        <span>Avancement</span>
                        <span className="font-mono font-semibold text-fuchsia-600 dark:text-fuchsia-400">
                          {done}/{total} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-fuchsia-600 rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Linked tracks pills */}
                    {linkedTracks.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {linkedTracks.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => void player.playTrack(t)}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-zinc-200 hover:bg-fuchsia-500/15 cursor-pointer"
                          >
                            <Music2 size={11} className="text-fuchsia-500" />
                            {t.title}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Steps Checklist */}
                    <div className="space-y-1.5">
                      {proj.steps.map((step) => (
                        <div
                          key={step.id}
                          className="group flex items-center gap-2.5 rounded-lg py-1 px-1 hover:bg-slate-50 dark:hover:bg-zinc-900/60"
                        >
                          <CheckCircle
                            checked={step.done}
                            onToggle={() => toggleMusicProjectStep(proj.id, step.id)}
                            accent="violet"
                            size="sm"
                          />
                          <span
                            className={`flex-1 text-xs ${
                              step.done
                                ? 'line-through text-slate-400'
                                : 'text-slate-700 dark:text-zinc-200'
                            }`}
                          >
                            {step.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteMusicProjectStep(proj.id, step.id)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const val = (stepInputs[proj.id] || '').trim();
                        if (!val) return;
                        addMusicProjectStep(proj.id, val);
                        setStepInputs((prev) => ({ ...prev, [proj.id]: '' }));
                      }}
                      className="flex gap-1.5"
                    >
                      <input
                        type="text"
                        value={stepInputs[proj.id] || ''}
                        onChange={(e) =>
                          setStepInputs((prev) => ({ ...prev, [proj.id]: e.target.value }))
                        }
                        placeholder="+ Ajouter une étape / objectif…"
                        className="flex-1 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 text-xs outline-none focus:border-fuchsia-400"
                      />
                      {(stepInputs[proj.id] || '').trim() && (
                        <button
                          type="submit"
                          className="rounded-xl bg-fuchsia-600 text-white px-3 py-1.5 text-xs font-semibold cursor-pointer"
                        >
                          OK
                        </button>
                      )}
                    </form>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ================= TAB 2: BIBLIOTHÈQUE MP3 & MARQUEURS ================= */}
      {subTab === 'library' && (
        <div className="space-y-4">
          {/* Import Audio: Local Drag & Drop + Google Drive */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleUploadAudioFiles(e.dataTransfer.files);
              }}
              onClick={() => audioInputRef.current?.click()}
              className="tempo-card rounded-3xl border-dashed border-2 border-slate-200 dark:border-zinc-800 p-5 text-center cursor-pointer hover:border-fuchsia-400 dark:hover:border-fuchsia-600 transition"
            >
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a"
                multiple
                onChange={(e) => void handleUploadAudioFiles(e.target.files)}
                className="hidden"
              />
              <div className="mx-auto h-9 w-9 rounded-2xl bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400 flex items-center justify-center mb-2">
                <Upload size={16} />
              </div>
              <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                Importer des MP3 / WAV / M4A
              </p>
              <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5">
                Glisse tes fichiers locaux ou clique ici
              </p>
            </div>

            <button
              type="button"
              onClick={() => setDrivePickerOpen(true)}
              className="tempo-card rounded-3xl border border-slate-200/80 dark:border-zinc-800 p-5 text-center cursor-pointer hover:border-slate-400 dark:hover:border-zinc-600 transition"
            >
              <div className="mx-auto h-9 w-9 rounded-2xl bg-slate-900/8 dark:bg-zinc-100/10 text-slate-800 dark:text-zinc-100 flex items-center justify-center mb-2">
                <HardDrive size={16} />
              </div>
              <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                Importer depuis Google Drive
              </p>
              <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5">
                Parcourir tes MP3 Drive & synchroniser multi-appareils
              </p>
            </button>
          </div>

          <GoogleDrivePickerModal open={drivePickerOpen} onClose={() => setDrivePickerOpen(false)} />

          {/* Tracks List */}
          <div className="space-y-3">
            {state.musicTracks.map((track) => {
              const isCurrent = player.currentTrack?.id === track.id;
              const isPlaying = isCurrent && player.isPlaying;
              const progressPct =
                isCurrent && player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;
              const isEditing = editingTrackId === track.id;

              return (
                <div key={track.id} className="tempo-card rounded-3xl p-4 sm:p-5 space-y-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="relative shrink-0">
                        <CoverArt track={track} size={56} />
                        <button
                          type="button"
                          onClick={() =>
                            isCurrent ? player.togglePlay() : void player.playTrack(track)
                          }
                          className="absolute inset-0 rounded-xl bg-black/40 text-white flex items-center justify-center hover:bg-black/55 transition cursor-pointer"
                        >
                          {isPlaying ? (
                            <Pause size={20} fill="currentColor" />
                          ) : (
                            <Play size={20} fill="currentColor" className="ml-0.5" />
                          )}
                        </button>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {track.title}
                          </h3>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              TRACK_STATUS_META[track.status].badge
                            }`}
                          >
                            {TRACK_STATUS_META[track.status].label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                          {track.artist}
                          {track.feat ? ` feat. ${track.feat}` : ''}
                          {track.bpm ? ` · ${track.bpm} BPM` : ''}
                          {track.musicalKey ? ` · ${track.musicalKey}` : ''}
                          {track.durationSec ? ` · ${fmt(track.durationSec)}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openLinkedLyrics(track)}
                        title="Ouvrir le texte dans LexCore"
                        className="rounded-xl px-2.5 py-1.5 text-xs font-medium bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-500/20 transition cursor-pointer"
                      >
                        Texte
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTrackId(isEditing ? null : track.id)}
                        title="Modifier métadonnées & pochette"
                        className="p-2 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMusicTrack(track.id)}
                        className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Interactive Waveform */}
                  <TrackWaveform
                    track={track}
                    isCurrent={isCurrent}
                    progressPct={progressPct}
                    onSeekPct={(ratio) => {
                      const dur = isCurrent ? player.duration : track.durationSec || 180;
                      const targetSec = ratio * dur;
                      if (isCurrent) player.seek(targetSec);
                      else void player.playTrack(track, targetSec);
                    }}
                  />

                  {/* Timestamped Markers */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {track.markers.map((mk) => (
                      <span
                        key={mk.id}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-800/90 pl-2.5 pr-1.5 py-1 text-[11px] font-medium text-slate-700 dark:text-zinc-200"
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
                        className="w-36 rounded-full border border-slate-200/80 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] outline-none focus:border-fuchsia-400"
                      />
                    </form>
                  </div>

                  {/* Metadata & Cover Editor Drawer */}
                  {isEditing && (
                    <div className="pt-3 border-t border-slate-100 dark:border-zinc-800/80 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input
                        type="text"
                        value={track.title}
                        onChange={(e) => updateMusicTrack(track.id, { title: e.target.value })}
                        placeholder="Titre"
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                      />
                      <input
                        type="text"
                        value={track.artist}
                        onChange={(e) => updateMusicTrack(track.id, { artist: e.target.value })}
                        placeholder="Artiste"
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                      />
                      <input
                        type="text"
                        value={track.feat || ''}
                        onChange={(e) => updateMusicTrack(track.id, { feat: e.target.value })}
                        placeholder="Featuring (optionnel)"
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                      />
                      <input
                        type="number"
                        value={track.bpm || ''}
                        onChange={(e) =>
                          updateMusicTrack(track.id, { bpm: Number(e.target.value) || undefined })
                        }
                        placeholder="BPM (ex. 132)"
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-xs"
                      />
                      <input
                        type="text"
                        value={track.musicalKey || ''}
                        onChange={(e) => updateMusicTrack(track.id, { musicalKey: e.target.value })}
                        placeholder="Tonalité (ex. F# min)"
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                      />
                      <select
                        value={track.status}
                        onChange={(e) =>
                          updateMusicTrack(track.id, { status: e.target.value as TrackStatus })
                        }
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                      >
                        {Object.entries(TRACK_STATUS_META).map(([k, m]) => (
                          <option key={k} value={k}>
                            Statut : {m.label}
                          </option>
                        ))}
                      </select>

                      <select
                        value={track.linkedProjectId || ''}
                        onChange={(e) =>
                          updateMusicTrack(track.id, { linkedProjectId: e.target.value || undefined })
                        }
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                      >
                        <option value="">Projet associé…</option>
                        {state.musicProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>

                      <label className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-medium cursor-pointer hover:border-fuchsia-400">
                        <ImagePlus size={14} className="text-fuchsia-500" />
                        Changer pochette
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => void handleUploadCover(track.id, e.target.files?.[0])}
                          className="hidden"
                        />
                      </label>

                      <label className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-medium cursor-pointer hover:border-fuchsia-400">
                        <FileAudio size={14} className="text-fuchsia-500" />
                        Remplacer MP3
                        <input
                          type="file"
                          accept="audio/*,.mp3,.wav,.m4a"
                          onChange={(e) => void handleUploadAudioFiles(e.target.files, track.id)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= TAB 3: LEXCORE STUDIO ÉCRITURE ================= */}
      {subTab === 'lyrics' && <LyricsStudio initialDocId={selectedLyricsId} />}
    </div>
  );
}
