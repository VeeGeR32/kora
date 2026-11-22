import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  Camera,
  Check,
  ChevronLeft,
  Disc3,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { MusicProject, ProjectKind } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { groupMusicTracks } from '../../lib/musicVersioning';
import {
  getProjectTrackIndividualCovers,
  prepareAndUploadHdCover,
  resolveTrackRatings,
  resolveTrackWorkflow,
} from '../../lib/trackCover';
import { TRACK_STATUS_META } from '../../utils/theme';
import { uid } from '../../utils/dates';
import { PROJECT_GRADIENTS } from './MiniAudioPlayer';
import { ProjectCoverArtwork } from './ProjectCoverArtwork';

interface ProjectCreationModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (newProjectId: string) => void;
}

const FORMAT_OPTIONS: { id: ProjectKind; label: string; hint: string }[] = [
  { id: 'single', label: 'Single', hint: '1 à 3 titres' },
  { id: 'ep', label: 'EP', hint: '4 à 7 titres' },
  { id: 'album', label: 'Album', hint: '8+ titres' },
  { id: 'mixtape', label: 'Mixtape', hint: 'Format libre' },
];

const STATUS_OPTIONS: { id: MusicProject['status']; label: string }[] = [
  { id: 'en-cours', label: 'En cours' },
  { id: 'mix', label: 'Mix / Master' },
  { id: 'pret', label: 'Prêt' },
  { id: 'sorti', label: 'Sorti' },
];

const DEFAULT_STEPS = [
  'Sélection des prods / MP3',
  'Écriture des textes',
  'Enregistrement voix',
  'Mix / Master & Pochette',
];

function fmtDuration(sec?: number): string {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTotalDuration(totalSec: number): string {
  if (!totalSec || totalSec <= 0) return '';
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const rem = mins % 60;
    return `${h} h ${rem} min`;
  }
  return `${mins} min ${String(secs).padStart(2, '0')} s`;
}

export function ProjectCreationModal({ open, onClose, onCreated }: ProjectCreationModalProps) {
  const { state, addMusicProject, updateMusicTrack, notify } = useApp();
  const player = useAudioPlayer();
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ProjectKind>('ep');
  const [status, setStatus] = useState<MusicProject['status']>('en-cours');
  const [targetReleaseDate, setTargetReleaseDate] = useState('');
  const [coverGradient, setCoverGradient] = useState<string>('pink');
  const [coverDataUrl, setCoverDataUrl] = useState<string | undefined>(undefined);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Track selection state
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [trackSearch, setTrackSearch] = useState('');
  const [trackSort, setTrackSort] = useState<'potential' | 'gap' | 'recent'>('recent');

  // Production checklist state
  const [steps, setSteps] = useState<{ id: string; label: string; done: boolean }[]>(() =>
    DEFAULT_STEPS.map((label) => ({ id: uid('ps'), label, done: false }))
  );
  const [newStepText, setNewStepText] = useState('');

  // Reset form cleanly whenever opened
  useEffect(() => {
    if (!open) return;
    const defaultGrad =
      PROJECT_GRADIENTS[state.musicProjects.length % PROJECT_GRADIENTS.length]?.id || 'pink';
    setTitle('');
    setKind('ep');
    setStatus('en-cours');
    setTargetReleaseDate('');
    setCoverGradient(defaultGrad);
    setCoverDataUrl(undefined);
    setSelectedTrackIds([]);
    setTrackSearch('');
    setTrackSort('recent');
    setSteps(DEFAULT_STEPS.map((label) => ({ id: uid('ps'), label, done: false })));
    setNewStepText('');
  }, [open, state.musicProjects.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const allGroups = useMemo(() => groupMusicTracks(state.musicTracks), [state.musicTracks]);

  const sortedGroups = useMemo(() => {
    const q = trackSearch.trim().toLowerCase();
    const filtered = allGroups.filter((g) => {
      if (!q) return true;
      return (
        g.baseTitle.toLowerCase().includes(q) ||
        g.versions.some((v) => v.track.title.toLowerCase().includes(q))
      );
    });

    return [...filtered].sort((a, b) => {
      const ra = resolveTrackRatings(a.latestTrack, a.versions.map((v) => v.track));
      const rb = resolveTrackRatings(b.latestTrack, b.versions.map((v) => v.track));
      if (trackSort === 'potential') {
        const pa = ra.potential ?? -1;
        const pb = rb.potential ?? -1;
        if (pb !== pa) return pb - pa;
      } else if (trackSort === 'gap') {
        const ga = ra.potential !== null && ra.current !== null ? ra.potential - ra.current : -99;
        const gb = rb.potential !== null && rb.current !== null ? rb.potential - rb.current : -99;
        if (gb !== ga) return gb - ga;
      }
      return b.latestTimestampMs - a.latestTimestampMs;
    });
  }, [allGroups, trackSearch, trackSort]);

  const selectedTracks = useMemo(() => {
    const byId = new Map(state.musicTracks.map((t) => [t.id, t]));
    return selectedTrackIds.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t));
  }, [selectedTrackIds, state.musicTracks]);

  const totalDurationSec = useMemo(
    () => selectedTracks.reduce((acc, t) => acc + (t.durationSec || 0), 0),
    [selectedTracks]
  );

  const handleCoverUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadingCover(true);
    try {
      const uploadedUrl = await prepareAndUploadHdCover(file, state.preferences.firebaseConfig);
      setCoverDataUrl(uploadedUrl);
      notify('Pochette HD prête ✓');
    } catch {
      notify('Impossible de charger cette image');
    } finally {
      setUploadingCover(false);
    }
  };

  const toggleTrackSelection = (trackId: string) => {
    setSelectedTrackIds((prev) =>
      prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]
    );
  };

  const applyDatePreset = (monthsAhead: number | null) => {
    if (monthsAhead === null) {
      setTargetReleaseDate('');
      return;
    }
    const d = new Date();
    d.setMonth(d.getMonth() + monthsAhead);
    setTargetReleaseDate(d.toISOString().slice(0, 10));
  };

  const handleAddStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStepText.trim()) return;
    setSteps((prev) => [...prev, { id: uid('ps'), label: newStepText.trim(), done: false }]);
    setNewStepText('');
  };

  const handleCreate = (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      notify('Donne un titre à ton projet');
      return;
    }

    const newId = addMusicProject({
      title: cleanTitle,
      kind,
      coverGradient,
      coverDataUrl,
      targetReleaseDate: targetReleaseDate || undefined,
      status,
      trackIds: selectedTrackIds,
      steps: steps.length > 0 ? steps : DEFAULT_STEPS.map((label) => ({ id: uid('ps'), label, done: false })),
    });

    for (const tid of selectedTrackIds) {
      updateMusicTrack(tid, { linkedProjectId: newId });
    }

    notify(`Projet « ${cleanTitle} » créé ✓`);
    onCreated(newId);
  };

  const artistName = state.preferences.name || 'Moi';
  const heroGradientCls =
    PROJECT_GRADIENTS.find((g) => g.id === coverGradient)?.css || PROJECT_GRADIENTS[0].css;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="max-w-3xl mx-auto tempo-card rounded-3xl text-[var(--text)] overflow-hidden"
        >
          {/* Apple-Style Top Navigation Bar */}
          <header className="px-4 sm:px-6 py-3.5 border-b border-[var(--border)]">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                <ChevronLeft size={16} />
                <span>Annuler</span>
              </button>

              <div className="text-center">
                <p className="text-xs font-semibold tracking-tight text-slate-950 dark:text-white">
                  Nouveau projet
                </p>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500">
                  {FORMAT_OPTIONS.find((f) => f.id === kind)?.label} · {selectedTrackIds.length}{' '}
                  {selectedTrackIds.length > 1 ? 'titres' : 'titre'}
                </p>
              </div>

              <button
                type="button"
                disabled={!title.trim() || uploadingCover}
                onClick={() => handleCreate()}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 dark:bg-white text-white dark:text-zinc-950 px-4 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-30 transition cursor-pointer"
              >
                <span>Créer</span>
              </button>
            </div>
          </header>

          {/* In-App Editorial Creation Body */}
          <div className="pb-8">
            {/* Subtle Ambient Hero Wash */}
            <div className="relative overflow-hidden pt-6 pb-4 px-4 sm:px-6">
              <div className="pointer-events-none absolute top-0 inset-x-0 h-64 overflow-hidden">
                {coverDataUrl ? (
                  <img
                    src={coverDataUrl}
                    alt=""
                    aria-hidden="true"
                    className="w-full h-full object-cover scale-125 blur-3xl opacity-35 dark:opacity-45"
                  />
                ) : (
                  <div
                    className={`w-full h-full bg-gradient-to-b ${heroGradientCls} opacity-25 dark:opacity-35 blur-2xl`}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--surface)]/70 to-[var(--surface)]" />
              </div>

              {/* Live Album Cover Preview + Gradient / Photo Picker */}
              <div className="relative z-10 max-w-2xl mx-auto flex flex-col items-center space-y-4">
                <div
                  onClick={() => coverInputRef.current?.click()}
                  className="relative group w-44 sm:w-52 aspect-square rounded-2xl overflow-hidden shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)] border border-black/10 dark:border-white/12 cursor-pointer transition-transform hover:scale-[1.015] active:scale-[0.985]"
                >
                  <ProjectCoverArtwork
                    title={title.trim() || 'Nouveau projet'}
                    projectCoverUrl={coverDataUrl}
                    trackCoverUrls={getProjectTrackIndividualCovers(selectedTracks)}
                    gradientId={coverGradient}
                  />
                  <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 text-white flex flex-col items-center justify-center gap-1.5 text-xs font-semibold transition">
                    {uploadingCover ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <>
                        <Camera size={20} />
                        <span>Importer une pochette</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      coverInputRef.current?.click();
                    }}
                    className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-full bg-black/65 text-white flex items-center justify-center backdrop-blur-md shadow-md cursor-pointer"
                    title="Importer une pochette HD"
                  >
                    {uploadingCover ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Camera size={14} />
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

                {/* Gradient Swatches & Remove Cover */}
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {PROJECT_GRADIENTS.map((g) => {
                    const active = !coverDataUrl && coverGradient === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          setCoverGradient(g.id);
                          setCoverDataUrl(undefined);
                        }}
                        title={g.label}
                        className={`h-6 w-6 rounded-full bg-gradient-to-br ${g.css} transition cursor-pointer ${
                          active
                            ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-[#09090b] scale-110'
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      />
                    );
                  })}
                  {coverDataUrl && (
                    <button
                      type="button"
                      onClick={() => setCoverDataUrl(undefined)}
                      className="ml-1 inline-flex items-center gap-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                    >
                      <Trash2 size={11} /> Retirer photo
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Apple Inset Grouped Form Sections */}
            <div className="max-w-2xl mx-auto px-4 sm:px-6 space-y-6">
              {/* SECTION 1: IDENTITÉ & FORMAT */}
              <section className="space-y-2">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                  Identité & Format
                </p>

                <div className="tempo-card rounded-2xl divide-y divide-slate-100 dark:divide-zinc-800/80 overflow-hidden">
                  {/* Title Input Row */}
                  <div className="p-4 space-y-1">
                    <label className="block text-[11px] font-medium text-slate-400 dark:text-zinc-500">
                      Titre du projet
                    </label>
                    <input
                      autoFocus
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && title.trim()) {
                          e.preventDefault();
                        }
                      }}
                      placeholder="Ex. FULLMETAL vol.2, Minuit EP…"
                      className="w-full bg-transparent text-lg sm:text-xl font-bold tracking-tight text-slate-950 dark:text-white placeholder:text-slate-300 dark:placeholder:text-zinc-700 outline-none"
                    />
                    <p className="text-[11px] text-slate-400 dark:text-zinc-500">
                      Par <strong className="text-slate-700 dark:text-zinc-300">{artistName}</strong>
                    </p>
                  </div>

                  {/* Apple Segmented Control: Format */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                        Format
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {FORMAT_OPTIONS.find((f) => f.id === kind)?.hint}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 dark:bg-zinc-900 p-1">
                      {FORMAT_OPTIONS.map((opt) => {
                        const active = kind === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setKind(opt.id)}
                            className={`relative rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
                              active
                                ? 'bg-white dark:bg-zinc-800 text-slate-950 dark:text-white shadow-2xs'
                                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Apple Segmented Control: Statut */}
                  <div className="p-4 space-y-2">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-zinc-200">
                      Phase actuelle
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl bg-slate-100 dark:bg-zinc-900 p-1">
                      {STATUS_OPTIONS.map((opt) => {
                        const active = status === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setStatus(opt.id)}
                            className={`rounded-lg py-1.5 text-xs font-semibold transition cursor-pointer ${
                              active
                                ? 'bg-white dark:bg-zinc-800 text-slate-950 dark:text-white shadow-2xs'
                                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Target Release Date Row with Quick Presets */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                        <Calendar size={13} className="text-slate-400" />
                        Date de sortie cible
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {[
                          { label: 'Dans 1 mois', months: 1 },
                          { label: 'Dans 3 mois', months: 3 },
                          { label: 'Non définie', months: null },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => applyDatePreset(preset.months)}
                            className="rounded-full bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200/80 dark:hover:bg-zinc-800 px-2.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-zinc-300 transition cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <input
                      type="date"
                      value={targetReleaseDate}
                      onChange={(e) => setTargetReleaseDate(e.target.value)}
                      className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-xs text-slate-900 dark:text-zinc-100 outline-none focus:border-slate-400"
                    />
                  </div>
                </div>
              </section>

              {/* SECTION 2: SÉLECTION DE LA TRACKLIST INITIALE */}
              <section className="space-y-2">
                <div className="px-1 flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                    Tracklist initiale ({selectedTrackIds.length} sélectionné
                    {selectedTrackIds.length > 1 ? 's' : ''}
                    {totalDurationSec > 0 ? ` · ${fmtTotalDuration(totalDurationSec)}` : ''})
                  </p>
                  {selectedTrackIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTrackIds([])}
                      className="text-[11px] font-medium text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      Tout désélectionner
                    </button>
                  )}
                </div>

                <div className="tempo-card rounded-2xl p-3.5 space-y-3">
                  {/* Search & Analytical Sort Bar */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1 flex items-center gap-2 rounded-xl bg-slate-100/80 dark:bg-zinc-900 px-3 py-2">
                      <Search size={13} className="text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={trackSearch}
                        onChange={(e) => setTrackSearch(e.target.value)}
                        placeholder="Rechercher un son à inclure dans ce projet…"
                        className="w-full bg-transparent text-xs outline-none text-slate-900 dark:text-zinc-100 placeholder:text-slate-400"
                      />
                      {trackSearch && (
                        <button
                          type="button"
                          onClick={() => setTrackSearch('')}
                          className="text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 dark:bg-zinc-900 p-1 shrink-0">
                      {(
                        [
                          ['recent', 'Récents'],
                          ['potential', '↗ Potentiel'],
                          ['gap', 'Δ Écart'],
                        ] as const
                      ).map(([id, lbl]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setTrackSort(id)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                            trackSort === id
                              ? 'bg-white dark:bg-zinc-800 text-slate-950 dark:text-white shadow-2xs'
                              : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {sortedGroups.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-400">
                      {state.musicTracks.length === 0
                        ? 'Aucun son dans ta bibliothèque — tu pourras en ajouter après la création.'
                        : 'Aucun morceau ne correspond à cette recherche.'}
                    </p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/70 -mx-1 px-1">
                      {sortedGroups.map((g) => {
                        const trk = g.latestTrack;
                        const selectedIndex = selectedTrackIds.indexOf(trk.id);
                        const isSelected = selectedIndex !== -1;
                        const isPlayingThis =
                          player.currentTrack?.id === trk.id && player.isPlaying;
                        const ratings = resolveTrackRatings(
                          trk,
                          g.versions.map((v) => v.track)
                        );
                        const wf = resolveTrackWorkflow(
                          trk,
                          g.versions.map((v) => v.track)
                        );
                        const stMeta = TRACK_STATUS_META[wf.status];
                        const cover =
                          trk.coverDataUrl ||
                          trk.cloudCoverUrl ||
                          g.versions.find((v) => Boolean(v.track.coverDataUrl))?.track
                            .coverDataUrl ||
                          null;

                        return (
                          <div
                            key={g.groupKey}
                            onClick={() => toggleTrackSelection(trk.id)}
                            className={`py-2.5 px-2 rounded-xl flex items-center justify-between gap-2.5 cursor-pointer transition ${
                              isSelected
                                ? 'bg-slate-900/5 dark:bg-white/6'
                                : 'hover:bg-slate-50 dark:hover:bg-zinc-900/50'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {/* Selection Number / Check Circle */}
                              <div
                                className={`h-6 w-6 rounded-full flex items-center justify-center font-mono text-[11px] font-bold shrink-0 transition ${
                                  isSelected
                                    ? 'bg-[#FF5500] text-white shadow-xs'
                                    : 'border border-slate-300 dark:border-zinc-700 text-transparent'
                                }`}
                              >
                                {isSelected ? selectedIndex + 1 : <Check size={11} />}
                              </div>

                              {/* Play Preview Thumbnail */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (player.currentTrack?.id === trk.id) player.togglePlay();
                                  else void player.playTrack(trk, 0, [trk]);
                                }}
                                title={isPlayingThis ? 'Pause' : 'Écouter un extrait'}
                                className="relative h-9 w-9 rounded-lg overflow-hidden bg-slate-200 dark:bg-zinc-800 shrink-0 flex items-center justify-center cursor-pointer"
                              >
                                {cover ? (
                                  <img
                                    src={cover}
                                    alt={g.baseTitle}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <Disc3 size={15} className="text-slate-400" />
                                )}
                                <span
                                  className={`absolute inset-0 bg-black/40 text-white flex items-center justify-center transition ${
                                    isPlayingThis ? 'opacity-100' : 'opacity-0 hover:opacity-100'
                                  }`}
                                >
                                  {isPlayingThis ? (
                                    <Pause size={12} fill="currentColor" />
                                  ) : (
                                    <Play size={12} fill="currentColor" className="ml-0.5" />
                                  )}
                                </span>
                              </button>

                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                                  {g.baseTitle}
                                </p>
                                <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden whitespace-nowrap mt-0.5">
                                  <span
                                    className={`rounded-full px-1.5 py-0.2 text-[9px] font-medium ${stMeta.badge}`}
                                  >
                                    {stMeta.shortLabel}
                                  </span>
                                  {g.hasMultipleVersions && (
                                    <span className="font-mono text-[10px] text-slate-400">
                                      {g.latestVersionLabel}
                                    </span>
                                  )}
                                  {(ratings.current !== null || ratings.potential !== null) && (
                                    <span className="font-mono text-[10px] text-slate-400">
                                      {ratings.current ?? '—'}
                                      {ratings.potential !== null && (
                                        <span className="text-[#FF5500] ml-0.5">
                                          ↗{ratings.potential}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {trk.durationSec ? (
                              <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                                {fmtDuration(trk.durationSec)}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              {/* SECTION 3: JALONS & CHECKLIST DE PRODUCTION */}
              <section className="space-y-2">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500 flex items-center gap-1.5">
                  <ListChecks size={12} /> Jalons de production ({steps.length})
                </p>

                <div className="tempo-card rounded-2xl p-4 space-y-2.5">
                  <div className="space-y-1.5">
                    {steps.map((st, idx) => (
                      <div
                        key={st.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-slate-50/80 dark:bg-zinc-900/60 px-3 py-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono text-[10px] text-slate-400 w-4">
                            {idx + 1}.
                          </span>
                          <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 truncate">
                            {st.label}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSteps((prev) => prev.filter((item) => item.id !== st.id))
                          }
                          className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleAddStep} className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newStepText}
                      onChange={(e) => setNewStepText(e.target.value)}
                      placeholder="+ Ajouter une étape personnalisée (ex. Shooting cover, Clip…)"
                      className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs outline-none focus:border-slate-400"
                    />
                    <button
                      type="submit"
                      disabled={!newStepText.trim()}
                      className="rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-2 text-xs font-semibold disabled:opacity-35 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Plus size={12} /> Ajouter
                    </button>
                  </form>
                </div>
              </section>

              {/* Primary Bottom Create CTA */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={!title.trim() || uploadingCover}
                  onClick={() => handleCreate()}
                  className="w-full rounded-2xl bg-slate-950 dark:bg-white text-white dark:text-zinc-950 py-3.5 text-sm font-semibold hover:opacity-92 active:scale-[0.99] disabled:opacity-35 transition shadow-lg cursor-pointer"
                >
                  Créer le projet{title.trim() ? ` « ${title.trim()} »` : ''}
                  {selectedTrackIds.length > 0
                    ? ` (${selectedTrackIds.length} titre${selectedTrackIds.length > 1 ? 's' : ''})`
                    : ''}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
