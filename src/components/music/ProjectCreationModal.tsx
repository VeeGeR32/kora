import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  Camera,
  Check,
  ChevronLeft,
  Disc3,
  Heart,
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
import { socialTrackToMusicTrack } from '../../lib/socialApi';
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

type CreationFormat = ProjectKind | 'playlist';

interface ProjectCreationModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (newProjectId: string) => void;
  onCreatedPlaylist?: (newPlaylistId: string) => void;
}

const FORMAT_OPTIONS: { id: CreationFormat; label: string; hint: string }[] = [
  { id: 'single', label: 'Single', hint: '1 à 3 titres' },
  { id: 'ep', label: 'EP', hint: '4 à 7 titres' },
  { id: 'album', label: 'Album', hint: '8+ titres' },
  { id: 'mixtape', label: 'Mixtape', hint: 'Format libre' },
  { id: 'playlist', label: 'Playlist', hint: 'Mes sons + likés' },
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

export function ProjectCreationModal({
  open,
  onClose,
  onCreated,
  onCreatedPlaylist,
}: ProjectCreationModalProps) {
  const { state, likedSocialTracks, addMusicProject, createPlaylist, updateMusicTrack, notify } =
    useApp();
  const player = useAudioPlayer();
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<CreationFormat>('ep');
  const [status, setStatus] = useState<MusicProject['status']>('en-cours');
  const [targetReleaseDate, setTargetReleaseDate] = useState('');
  const [coverGradient, setCoverGradient] = useState<string>('pink');
  const [coverDataUrl, setCoverDataUrl] = useState<string | undefined>(undefined);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Track selection state (own tracks + liked community tracks when format === 'playlist')
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [selectedSocialIds, setSelectedSocialIds] = useState<string[]>([]);
  const [pickerSource, setPickerSource] = useState<'own' | 'social'>('own');
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
    setDescription('');
    setKind('ep');
    setStatus('en-cours');
    setTargetReleaseDate('');
    setCoverGradient(defaultGrad);
    setCoverDataUrl(undefined);
    setSelectedTrackIds([]);
    setSelectedSocialIds([]);
    setPickerSource('own');
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

  const isPlaylistMode = kind === 'playlist';

  const filteredSocialTracks = useMemo(() => {
    const q = trackSearch.trim().toLowerCase();
    if (!q) return likedSocialTracks;
    return likedSocialTracks.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.artist || s.ownerName || '').toLowerCase().includes(q)
    );
  }, [likedSocialTracks, trackSearch]);

  const totalSelectedCount =
    selectedTrackIds.length + (isPlaylistMode ? selectedSocialIds.length : 0);

  const totalDurationSec = useMemo(() => {
    const ownDur = selectedTracks.reduce((acc, t) => acc + (t.durationSec || 0), 0);
    if (!isPlaylistMode) return ownDur;
    const socDur = selectedSocialIds.reduce((acc, sid) => {
      const s = likedSocialTracks.find((x) => x.id === sid);
      return acc + (s?.durationSec || 0);
    }, 0);
    return ownDur + socDur;
  }, [selectedTracks, isPlaylistMode, selectedSocialIds, likedSocialTracks]);

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

  const toggleSocialSelection = (socialId: string) => {
    setSelectedSocialIds((prev) =>
      prev.includes(socialId) ? prev.filter((id) => id !== socialId) : [...prev, socialId]
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
      notify(isPlaylistMode ? 'Donne un titre à ta playlist' : 'Donne un titre à ton projet');
      return;
    }

    if (isPlaylistMode) {
      const newPlId = createPlaylist({
        title: cleanTitle,
        description: description.trim() || undefined,
        coverGradient,
        coverDataUrl,
        ownTrackIds: selectedTrackIds,
        socialTrackIds: selectedSocialIds,
      });
      if (onCreatedPlaylist) onCreatedPlaylist(newPlId);
      else onClose();
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="w-full tempo-card rounded-3xl text-[var(--text)] overflow-hidden"
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
                  {isPlaylistMode ? 'Nouvelle playlist' : 'Nouveau projet'}
                </p>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500">
                  {FORMAT_OPTIONS.find((f) => f.id === kind)?.label} · {totalSelectedCount}{' '}
                  {totalSelectedCount > 1 ? 'titres' : 'titre'}
                </p>
              </div>

              <button
                type="button"
                disabled={!title.trim() || uploadingCover}
                onClick={() => handleCreate()}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-1.5 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 disabled:opacity-30 transition cursor-pointer"
              >
                <span>Créer</span>
              </button>
            </div>
          </header>

          {/* In-App Studio Creation Body (Full Width, Unified Rowav Aesthetic) */}
          <div className="p-4 sm:p-6 space-y-6">
            {/* Cover Preview + Gradient / Photo Picker */}
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 pb-2 border-b border-[var(--border)]">
              <div
                onClick={() => coverInputRef.current?.click()}
                className="relative group w-36 sm:w-40 aspect-square rounded-2xl overflow-hidden shadow-lg border border-black/10 dark:border-white/12 cursor-pointer transition-transform hover:scale-[1.015] active:scale-[0.985] shrink-0"
              >
                <ProjectCoverArtwork
                  title={title.trim() || (isPlaylistMode ? 'Nouvelle playlist' : 'Nouveau projet')}
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
                  className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-[#8C271E]/90 text-white flex items-center justify-center backdrop-blur-md shadow-md cursor-pointer"
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

              <div className="flex-1 min-w-0 w-full space-y-3 text-center sm:text-left">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 dark:text-zinc-500">
                    {isPlaylistMode ? 'Nom de la playlist' : 'Titre du projet'}
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
                    placeholder={
                      isPlaylistMode
                        ? 'Ex. Session nuit, Bangers 2026, Mix studio…'
                        : 'Ex. FULLMETAL vol.2, Minuit EP…'
                    }
                    className="w-full bg-transparent text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-white placeholder:text-slate-300 dark:placeholder:text-zinc-700 outline-none mt-0.5"
                  />
                  <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5">
                    Par <strong className="text-slate-700 dark:text-zinc-300">{artistName}</strong>
                  </p>
                </div>

                {/* Gradient Swatches & Remove Cover */}
                <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
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
                            ? 'ring-2 ring-offset-2 ring-[#8C271E] dark:ring-offset-[#141010] scale-110'
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

            {/* Full-Width Grouped Form Sections */}
            <div className="w-full space-y-6">
              {/* SECTION 1: FORMAT & OPTIONS */}
              <section className="space-y-2">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                  Format & Configuration
                </p>

                <div className="tempo-card rounded-2xl divide-y divide-slate-100 dark:divide-zinc-800/80 overflow-hidden">
                  {/* Segmented Control: Format (Single · EP · Album · Mixtape · Playlist) */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                        Format
                      </span>
                      <span className="text-[11px] text-[#8C271E] dark:text-[#E56B5F] font-medium">
                        {FORMAT_OPTIONS.find((f) => f.id === kind)?.hint}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 rounded-xl bg-slate-100 dark:bg-zinc-900 p-1">
                      {FORMAT_OPTIONS.map((opt) => {
                        const active = kind === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setKind(opt.id)}
                            className={`relative rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
                              active
                                ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
                                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {isPlaylistMode ? (
                    <div className="p-4 space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-800 dark:text-zinc-200">
                        Description (optionnelle)
                      </label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ambiance, inspirations ou contexte de cette playlist…"
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs text-slate-900 dark:text-zinc-100 outline-none focus:border-[#8C271E]/50"
                      />
                    </div>
                  ) : (
                    <>
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
                                    ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25'
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
                            <Calendar size={13} className="text-[#8C271E] dark:text-[#E56B5F]" />
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
                          className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-xs text-slate-900 dark:text-zinc-100 outline-none focus:border-[#8C271E]/50"
                        />
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* SECTION 2: SÉLECTION DE LA TRACKLIST INITIALE */}
              <section className="space-y-2">
                <div className="px-1 flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                    Tracklist initiale ({totalSelectedCount} sélectionné
                    {totalSelectedCount > 1 ? 's' : ''}
                    {totalDurationSec > 0 ? ` · ${fmtTotalDuration(totalDurationSec)}` : ''})
                  </p>
                  {totalSelectedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrackIds([]);
                        setSelectedSocialIds([]);
                      }}
                      className="text-[11px] font-medium text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      Tout désélectionner
                    </button>
                  )}
                </div>

                <div className="tempo-card rounded-2xl p-3.5 space-y-3">
                  {/* Source Tabs when Playlist format is chosen (Mes sons + Sons likés Communauté) */}
                  {isPlaylistMode && (
                    <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-zinc-900 p-1">
                      <button
                        type="button"
                        onClick={() => setPickerSource('own')}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                          pickerSource === 'own'
                            ? 'bg-[#8C271E] text-white shadow-xs'
                            : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        Mes sons ({allGroups.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickerSource('social')}
                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                          pickerSource === 'social'
                            ? 'bg-[#8C271E] text-white shadow-xs'
                            : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        <Heart size={11} /> Sons likés · Social ({likedSocialTracks.length})
                      </button>
                    </div>
                  )}

                  {/* Search & Analytical Sort Bar */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1 flex items-center gap-2 rounded-xl bg-slate-100/80 dark:bg-zinc-900 px-3 py-2">
                      <Search size={13} className="text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={trackSearch}
                        onChange={(e) => setTrackSearch(e.target.value)}
                        placeholder={
                          isPlaylistMode && pickerSource === 'social'
                            ? 'Rechercher un son liké de la communauté…'
                            : 'Rechercher un son à inclure…'
                        }
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

                    {(!isPlaylistMode || pickerSource === 'own') && (
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
                                ? 'bg-[#8C271E] text-white shadow-2xs'
                                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                            }`}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {isPlaylistMode && pickerSource === 'social' ? (
                    filteredSocialTracks.length === 0 ? (
                      <p className="py-8 text-center text-xs text-slate-400">
                        {likedSocialTracks.length === 0
                          ? 'Aucun son liké dans Rowav Social pour le moment — tu pourras en ajouter plus tard.'
                          : 'Aucun son liké ne correspond à cette recherche.'}
                      </p>
                    ) : (
                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/70 -mx-1 px-1">
                        {filteredSocialTracks.map((soc) => {
                          const selectedIndex = selectedSocialIds.indexOf(soc.id);
                          const isSelected = selectedIndex !== -1;
                          const playable = socialTrackToMusicTrack(soc);
                          const isPlayingThis =
                            player.currentTrack?.id === playable.id && player.isPlaying;
                          return (
                            <div
                              key={soc.id}
                              onClick={() => toggleSocialSelection(soc.id)}
                              className={`py-2.5 px-2 rounded-xl flex items-center justify-between gap-2.5 cursor-pointer transition ${
                                isSelected
                                  ? 'bg-[#8C271E]/8 dark:bg-[#8C271E]/18'
                                  : 'hover:bg-slate-50 dark:hover:bg-zinc-900/50'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div
                                  className={`h-6 w-6 rounded-full flex items-center justify-center font-mono text-[11px] font-bold shrink-0 transition ${
                                    isSelected
                                      ? 'bg-[#8C271E] text-white shadow-xs'
                                      : 'border border-slate-300 dark:border-zinc-700 text-transparent'
                                  }`}
                                >
                                  {isSelected ? selectedTrackIds.length + selectedIndex + 1 : <Check size={11} />}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (player.currentTrack?.id === playable.id) player.togglePlay();
                                    else void player.playTrack(playable, 0, [playable]);
                                  }}
                                  className="relative h-9 w-9 rounded-lg overflow-hidden bg-slate-200 dark:bg-zinc-800 shrink-0 flex items-center justify-center cursor-pointer"
                                >
                                  {soc.coverUrl ? (
                                    <img
                                      src={soc.coverUrl}
                                      alt={soc.title}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <Disc3 size={15} className="text-slate-400" />
                                  )}
                                  <span
                                    className={`absolute inset-0 bg-[#8C271E]/65 text-white flex items-center justify-center transition ${
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
                                    {soc.title}
                                  </p>
                                  <p className="text-[11px] text-slate-400 truncate">
                                    {soc.artist || soc.ownerName}
                                  </p>
                                </div>
                              </div>
                              {soc.durationSec ? (
                                <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                                  {fmtDuration(soc.durationSec)}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : sortedGroups.length === 0 ? (
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
                                    ? 'bg-[#8C271E] text-white shadow-xs'
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
                                        <span className="text-[#8C271E] ml-0.5">
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

              {/* SECTION 3: JALONS & CHECKLIST DE PRODUCTION (Projets uniquement) */}
              {!isPlaylistMode && (
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
                      className="rounded-xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/25 px-3 py-2 text-xs font-semibold disabled:opacity-35 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Plus size={12} /> Ajouter
                    </button>
                  </form>
                </div>
              </section>
              )}

              {/* Primary Bottom Create CTA */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={!title.trim() || uploadingCover}
                  onClick={() => handleCreate()}
                  className="w-full rounded-2xl bg-[#8C271E] hover:bg-[#A32E24] text-white py-3.5 text-sm font-semibold active:scale-[0.99] disabled:opacity-35 transition shadow-lg shadow-[#8C271E]/25 cursor-pointer"
                >
                  {isPlaylistMode ? 'Créer la playlist' : 'Créer le projet'}
                  {title.trim() ? ` « ${title.trim()} »` : ''}
                  {totalSelectedCount > 0
                    ? ` (${totalSelectedCount} titre${totalSelectedCount > 1 ? 's' : ''})`
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
