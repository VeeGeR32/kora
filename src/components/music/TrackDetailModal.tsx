import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftRight,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  Disc3,
  Download,
  ExternalLink,
  FileText,
  FolderKanban,
  GitBranch,
  Layers,
  Link2,
  ListChecks,
  ListPlus,
  Loader2,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Search,
  Share2,
  Sparkles,
  Star,
  Tag,
  Trash2,
  TrendingUp,
  Unlink,
  X,
} from 'lucide-react';
import type { MusicTrack, TrackStatus } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { formatBytes, getMediaObjectUrl } from '../../lib/mediaDb';
import { isTrackAnalyzed } from '../../lib/audioAnalyzer';
import { triggerHapticTick } from '../../lib/haptics';
import { ShareOptionsModal } from './ShareOptionsModal';
import {
  countLyricsFixTags,
  findLinkedLyricsForTrack,
  findLinkedProjectForTrack,
  LYRICS_STATUS_META,
  prepareAndUploadHdCover,
  resolveEffectiveTrackCover,
  resolveTrackRatings,
  resolveTrackWorkflow,
} from '../../lib/trackCover';
import type { TrackGroup } from '../../lib/musicVersioning';
import {
  extractTrackRoutingPrefix,
  getDeterministicGradientId,
  normalizeGroupKey,
} from '../../lib/musicVersioning';
import {
  TRACK_PIPELINE_ORDER,
  TRACK_STATUS_META,
} from '../../utils/theme';
import { AppleConfirmDialog } from '../ui/AppleConfirmDialog';
import { CheckCircle } from '../ui/CheckCircle';
import { getGradientClass, PROJECT_GRADIENTS } from './MiniAudioPlayer';
import { QuickNotesPanel } from './QuickNotesPanel';

interface TrackDetailModalProps {
  group: TrackGroup | null;
  selectedTrackId: string | null;
  activeProjectId?: string | null;
  onSelectVersion: (trackId: string) => void;
  onOpenLyrics: (track: MusicTrack) => void;
  onRequestPullVersion: (group: TrackGroup, trackId: string, variantLabel?: string) => void;
  onRequestPullProd?: (group: TrackGroup, trackId: string, variantLabel?: string) => void;
  onRequestCreateVariant?: (group: TrackGroup, trackId: string) => void;
  onRequestAttachToOther: (group: TrackGroup, trackId: string) => void;
  onDetachVersion: (trackId: string) => void;
  onOpenContextMenu?: (
    e: React.MouseEvent,
    group: TrackGroup,
    trackId: string,
    initialSection?: 'versions' | 'projects' | null
  ) => void;
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
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TrackDetailModal({
  group,
  selectedTrackId,
  onSelectVersion,
  onOpenLyrics,
  onRequestPullVersion,
  onRequestPullProd,
  onRequestCreateVariant,
  onRequestAttachToOther,
  onDetachVersion,
  onOpenContextMenu,
  onClose,
}: TrackDetailModalProps) {
  const {
    state,
    updateMusicTrack,
    renameTrackGroup,
    setTrackGroupCover,
    setTrackGroupFavorite,
    setTrackGroupRatings,
    setTrackGroupWorkflow,
    selectGroupPreferredVersion,
    renameTrackVariant,
    moveTracksToVariant,
    detachTrackVariant,
    addMusicTrackTodo,
    updateMusicTrackTodo,
    toggleMusicTrackTodo,
    deleteMusicTrackTodo,
    addMusicTrackNote,
    updateMusicTrackNote,
    deleteMusicTrackNote,
    promoteMusicTrackNoteToTodo,
    addTrackMarker,
    deleteTrackMarker,
    deleteMusicTrack,
    updateMusicProject,
    updateLyricsDoc,
    notify,
  } = useApp();
  const player = useAudioPlayer();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const [todoInput, setTodoInput] = useState('');
  const [todoCardTab, setTodoCardTab] = useState<'todo' | 'notes'>('todo');
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoDraft, setEditingTodoDraft] = useState('');
  const [markerLabel, setMarkerLabel] = useState('');
  const [blobCoverUrl, setBlobCoverUrl] = useState<string | null>(null);
  const [songTitleDraft, setSongTitleDraft] = useState('');
  const [lyricsPickerOpen, setLyricsPickerOpen] = useState(false);
  const [lyricsSearch, setLyricsSearch] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editingProdId, setEditingProdId] = useState<string | null>(null);
  const [editingProdDraft, setEditingProdDraft] = useState('');
  const [showRatings, setShowRatings] = useState(false);
  const [abSyncTimecode, setAbSyncTimecode] = useState(true);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [viewedVariantId, setViewedVariantId] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editingVariantDraft, setEditingVariantDraft] = useState('');
  const [assignBranchTrackId, setAssignBranchTrackId] = useState<string | null>(null);
  const [assignBranchDraft, setAssignBranchDraft] = useState('');
  const [assignIncludeSiblings, setAssignIncludeSiblings] = useState(true);
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dragOverVariantId, setDragOverVariantId] = useState<string | null>(null);
  const [confirmDetachBranch, setConfirmDetachBranch] = useState<{
    ids: string[];
    label: string;
  } | null>(null);

  useEffect(() => {
    setSongTitleDraft(group?.baseTitle || '');
  }, [group?.groupKey, group?.baseTitle]);

  useEffect(() => {
    if (!group) return;
    const ownerBranch =
      (selectedTrackId && group.variants.find((b) => b.allTrackIds.includes(selectedTrackId))) ||
      group.variants.find((b) => b.hasActiveSelection) ||
      group.variants[0];
    setViewedVariantId(ownerBranch?.id || null);
    setEditingVariantId(null);
    setAssignBranchTrackId(null);
  }, [group?.groupKey, selectedTrackId]);

  const activeEntry = useMemo(() => {
    if (!group) return null;
    if (selectedTrackId) {
      const found = group.versions.find((v) => v.track.id === selectedTrackId);
      if (found) return found;
    }
    return group.versions[0] || null;
  }, [group, selectedTrackId]);

  const track = activeEntry?.track || null;

  const effectiveCover = useMemo(
    () =>
      track && group
        ? resolveEffectiveTrackCover(
            track,
            state.musicProjects,
            group.groupKey,
            group.versions.map((v) => v.track),
            { preferIndividual: true }
          )
        : null,
    [track, group, state.musicProjects]
  );

  useEffect(() => {
    let alive = true;
    if (effectiveCover && !effectiveCover.coverDataUrl && effectiveCover.coverMediaId) {
      getMediaObjectUrl(effectiveCover.coverMediaId).then((u) => alive && setBlobCoverUrl(u));
    } else {
      setBlobCoverUrl(null);
    }
    return () => {
      alive = false;
    };
  }, [effectiveCover?.coverDataUrl, effectiveCover?.coverMediaId]);

  const coverUrl =
    effectiveCover?.coverDataUrl || blobCoverUrl || effectiveCover?.cloudCoverUrl || null;

  // 60fps Spotify-style linear progress bar refs & state
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const progressThumbRef = useRef<HTMLDivElement | null>(null);
  const timeCurrentRef = useRef<HTMLSpanElement | null>(null);
  const timeTotalRef = useRef<HTMLSpanElement | null>(null);
  const scrubbingRef = useRef(false);
  const scrubTimeRef = useRef(0);
  const [scrubbing, setScrubbing] = useState(false);
  const dragRef = useRef<{ pointerId: number } | null>(null);

  const isCurrentTrack = Boolean(track && player.currentTrack?.id === track.id);
  const isPlayingTrack = isCurrentTrack && player.isPlaying;

  // Automatically detect BPM, Key & 4-bar structure when opening an unanalyzed track page
  useEffect(() => {
    if (!track || isTrackAnalyzed(track)) return;
    if (!track.mediaId && !track.googleDriveFileId && !track.cloudAudioUrl) return;
    void player.analyzeTrackAudio(track);
  }, [track?.id, track?.audioAnalyzedAt, player.analyzeTrackAudio]);
  const effectiveDurationVal =
    (isCurrentTrack && player.duration > 0 ? player.duration : track?.durationSec) || 0;

  const applyVisualFrame = (t: number, dur: number) => {
    const r = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
    const pct = r * 100;
    if (progressFillRef.current) {
      progressFillRef.current.style.transform = `scaleX(${r.toFixed(5)})`;
    }
    if (progressThumbRef.current) {
      progressThumbRef.current.style.left = `${pct.toFixed(3)}%`;
    }

    const curLabel = fmt(t);
    const totalLabel = dur > 0 ? fmt(dur) : '—';
    if (timeCurrentRef.current && timeCurrentRef.current.textContent !== curLabel) {
      timeCurrentRef.current.textContent = curLabel;
    }
    if (timeTotalRef.current && timeTotalRef.current.textContent !== totalLabel) {
      timeTotalRef.current.textContent = totalLabel;
    }
  };

  useLayoutEffect(() => {
    if (!track) return;
    const liveT = isCurrentTrack ? player.getLiveTime() : 0;
    applyVisualFrame(scrubbingRef.current ? scrubTimeRef.current : liveT, effectiveDurationVal);
  }, [track?.id, isCurrentTrack, isPlayingTrack, effectiveDurationVal, player]);

  useEffect(() => {
    if (!track || !isCurrentTrack || !isPlayingTrack) return;
    let rafId = 0;
    const tick = () => {
      if (!scrubbingRef.current) {
        applyVisualFrame(player.getLiveTime(), effectiveDurationVal);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [track?.id, isCurrentTrack, isPlayingTrack, effectiveDurationVal, player]);

  const isDetailOpen = Boolean(group && activeEntry && track);
  useEffect(() => {
    if (!isDetailOpen) return;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [isDetailOpen, track?.id]);

  const linkedLyrics = useMemo(
    () =>
      track && group
        ? findLinkedLyricsForTrack(
            track,
            state.lyricsDocs,
            group.allTrackIds,
            group.versions.map((v) => v.track)
          )
        : null,
    [track, group, state.lyricsDocs]
  );
  const linkedLyricsMeta = linkedLyrics ? LYRICS_STATUS_META[linkedLyrics.status || 1] : null;
  const fixTagCount = useMemo(
    () => (linkedLyrics ? countLyricsFixTags(linkedLyrics.content) : 0),
    [linkedLyrics]
  );
  const workflow = useMemo(
    () =>
      track && group
        ? resolveTrackWorkflow(
            track,
            group.versions.map((v) => v.track)
          )
        : { status: 'maquette' as TrackStatus, mood: null },
    [track, group]
  );
  const currentStepIdx = TRACK_PIPELINE_ORDER.indexOf(workflow.status);
  const ratings = useMemo(
    () =>
      track && group
        ? resolveTrackRatings(
            track,
            group.versions.map((v) => v.track)
          )
        : { current: null, potential: null },
    [track, group]
  );

  if (!group || !activeEntry || !track) return null;

  const isCurrent = player.currentTrack?.id === track.id;
  const isPlaying = isCurrent && player.isPlaying;
  const effectiveDuration = (isCurrent && player.duration > 0 ? player.duration : track.durationSec) || 0;
  const todos = track.todos || [];
  const doneTodos = todos.filter((td) => td.done).length;
  const todoPct = todos.length > 0 ? Math.round((doneTodos / todos.length) * 100) : 0;
  const gradCls = getGradientClass(
    effectiveCover?.gradientId || track.coverGradient || getDeterministicGradientId(group.groupKey)
  );
  const allGroupTrackIds =
    group.allTrackIds.length > 0 ? group.allTrackIds : group.versions.map((v) => v.track.id);
  const activeBranch =
    group.variants.find((b) => b.id === viewedVariantId) ||
    group.variants.find((b) => b.hasActiveSelection) ||
    group.variants[0] ||
    null;
  const displayedVersions =
    group.hasMultipleVariants && activeBranch ? activeBranch.versions : group.versions;
  const displayedProds =
    group.hasMultipleVariants && activeBranch ? activeBranch.prodTracks : group.prodTracks;
  const activeBranchRawLabel =
    group.hasMultipleVariants && activeBranch?.rawLabel ? activeBranch.rawLabel : undefined;
  const selectedProdTrack = group.prodTrack;
  const activeProdEntry =
    (selectedProdTrack &&
      group.prodTracks.find((p) => p.track.id === selectedProdTrack.id)) ||
    group.prodTracks[0] ||
    null;
  const activeProdTrack = selectedProdTrack;
  const isCurrentProd = Boolean(
    activeProdTrack && player.currentTrack?.id === activeProdTrack.id
  );
  const isPlayingProd = isCurrentProd && player.isPlaying;
  const isGroupLoadedInPlayer = Boolean(
    player.currentTrack && allGroupTrackIds.includes(player.currentTrack.id)
  );
  const getCompareStartSec = () => {
    if (!abSyncTimecode || !isGroupLoadedInPlayer) return 0;
    const live = player.getLiveTime();
    return Number.isFinite(live) && live > 0.3 ? live : 0;
  };
  const offlineBytes = player.offlineTrackSizes[track.id];
  const isTrackOffline = offlineBytes !== undefined;
  const isDownloadingOffline = player.downloadingOfflineIds.has(track.id);
  const canDownloadOffline = Boolean(track.mediaId || track.googleDriveFileId || track.cloudAudioUrl);

  const handleCycleAbLoop = () => {
    if (!isCurrent) {
      void player.playTrack(track, 0);
      player.setAbLoop({ start: 0, end: null });
      notify('Point A fixé à 0:00 — clique à nouveau pour poser B');
      return;
    }
    const liveT = player.getLiveTime();
    const { start, end } = player.abLoop;
    if (start === null) {
      player.setAbLoop({ start: liveT, end: null });
      notify(`Point A fixé à ${fmt(liveT)} — clique à nouveau pour poser B`);
    } else if (end === null) {
      let a = start;
      let b = liveT;
      if (Math.abs(b - a) < 0.6) {
        b = Math.min(effectiveDuration || a + 8, a + 8);
      } else if (b < a) {
        [a, b] = [b, a];
      }
      player.setAbLoop({ start: a, end: b });
      player.seek(a);
      applyVisualFrame(a, effectiveDuration);
      notify(`Boucle A–B active (${fmt(a)} → ${fmt(b)})`);
    } else {
      player.setAbLoop({ start: null, end: null });
      notify('Boucle A–B désactivée');
    }
    triggerHapticTick(8);
  };

  const handleUploadCover = async (file: File | undefined) => {
    if (!file) return;
    try {
      const coverUrl = await prepareAndUploadHdCover(file, state.preferences.firebaseConfig);
      setTrackGroupCover(allGroupTrackIds, { coverDataUrl: coverUrl });
      notify('Pochette HD mise à jour ✓');
    } catch {
      notify('Impossible de lire cette image');
    }
  };

  const siblingTracks = group.versions.map((v) => v.track);
  const linkedProject = findLinkedProjectForTrack(track, state.musicProjects, siblingTracks);

  const handleAssignProject = (projectId: string) => {
    const prevProjectId = linkedProject?.id || track.linkedProjectId;
    const groupIdSet = new Set(allGroupTrackIds);

    if (prevProjectId && prevProjectId !== projectId) {
      const oldProj = state.musicProjects.find((p) => p.id === prevProjectId);
      if (oldProj) {
        const nextPins = { ...(oldProj.pinnedVersionByGroup || {}) };
        delete nextPins[group.groupKey];
        updateMusicProject(oldProj.id, {
          trackIds: oldProj.trackIds.filter((id) => !groupIdSet.has(id)),
          benchTrackIds: (oldProj.benchTrackIds || []).filter((id) => !groupIdSet.has(id)),
          pinnedVersionByGroup: Object.keys(nextPins).length > 0 ? nextPins : undefined,
        });
      }
      for (const id of allGroupTrackIds) {
        const t = state.musicTracks.find((x) => x.id === id);
        if (t?.linkedProjectId === prevProjectId) {
          updateMusicTrack(id, { linkedProjectId: undefined });
        }
      }
    }

    if (projectId) {
      const targetProj = state.musicProjects.find((p) => p.id === projectId);
      const isSpecificOlderVersion = track.id !== group.latestTrack.id;
      if (targetProj) {
        const alreadyInProj = targetProj.trackIds.some((id) => groupIdSet.has(id));
        const nextTrackIds = alreadyInProj
          ? targetProj.trackIds.map((id) => (groupIdSet.has(id) ? track.id : id))
          : [...targetProj.trackIds, track.id];
        const nextPins = { ...(targetProj.pinnedVersionByGroup || {}) };
        if (isSpecificOlderVersion) nextPins[group.groupKey] = track.id;
        else delete nextPins[group.groupKey];
        updateMusicProject(targetProj.id, {
          trackIds: Array.from(new Set(nextTrackIds)),
          benchTrackIds: (targetProj.benchTrackIds || []).filter((id) => !groupIdSet.has(id)),
          pinnedVersionByGroup: Object.keys(nextPins).length > 0 ? nextPins : undefined,
        });
      }
      updateMusicTrack(track.id, { linkedProjectId: projectId });
      notify(`Ajouté au projet « ${targetProj?.title || ''} » ✓`);
    } else if (prevProjectId) {
      notify('Retiré du projet');
    }
  };

  return (
    <AnimatePresence>
      {/* In-App Editorial Song Page (rendered directly inside <main> alongside sidebar & navbars!) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement | null;
          if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
          if (!onOpenContextMenu) return;
          e.preventDefault();
          e.stopPropagation();
          onOpenContextMenu(e, group, track.id, null);
        }}
        className="w-full tempo-card rounded-3xl text-slate-900 dark:text-zinc-100 overflow-hidden"
      >
        {/* Minimalist In-App Top Bar */}
        <header className="px-4 sm:px-6 py-3.5 border-b border-slate-100 dark:border-zinc-800/80">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={onClose}
                aria-label="Retour"
                className="h-9 px-3 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 inline-flex items-center gap-1 text-xs font-semibold hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0"
              >
                <ChevronLeft size={16} /> Retour
              </button>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-zinc-900 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-700 dark:text-zinc-200 truncate">
                <GitBranch size={11} className="text-[#8C271E] shrink-0" />
                {group.hasMultipleVariants && track.variantLabel?.trim()
                  ? `${track.variantLabel.trim()} · ${activeEntry.versionLabel}`
                  : activeEntry.versionLabel}
              </span>
              {group.yearFolder && (
                <span className="hidden sm:inline-flex rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 px-2.5 py-1 font-mono text-[10px] font-semibold shrink-0">
                  {group.yearFolder}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
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
                className={`h-9 w-9 rounded-full flex items-center justify-center transition cursor-pointer ${
                  group.isFavorite
                    ? 'text-amber-400 bg-amber-400/14'
                    : 'bg-slate-100 dark:bg-zinc-900 text-slate-500 hover:text-amber-400'
                }`}
              >
                <Star size={16} fill={group.isFavorite ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                title={`Supprimer ${group.hasMultipleVersions ? activeEntry.versionLabel : 'ce son'}`}
                className="h-9 w-9 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center transition cursor-pointer"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </header>

        {/* In-App Song Page Body */}
        <div className="px-4 sm:px-7 py-6">
          <div className="space-y-6">
            {/* Hero Cover + Title + Play */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="relative group shrink-0">
                <div className="h-40 w-40 sm:h-36 sm:w-36 rounded-[24px] overflow-hidden shadow-xl border border-slate-200/70 dark:border-zinc-800">
                  {coverUrl ? (
                    <img src={coverUrl} alt={group.baseTitle} className="h-full w-full object-cover" />
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
                  title="Changer la pochette individuelle du son"
                  className="absolute inset-0 rounded-[22px] bg-black/45 opacity-0 group-hover:opacity-100 text-white flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition cursor-pointer"
                >
                  <Camera size={16} />
                  Pochette
                </button>
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  aria-label="Changer la pochette"
                  className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-full bg-black/65 text-white flex items-center justify-center shadow-md backdrop-blur-xs cursor-pointer sm:opacity-85 hover:scale-105 transition"
                >
                  <Camera size={13} />
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
                    value={songTitleDraft}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSongTitleDraft(val);
                      renameTrackGroup(allGroupTrackIds, val);
                    }}
                    placeholder="Nom du son…"
                    title="Renomme le son sans modifier le nom de ses versions"
                    className="w-full bg-transparent text-lg font-bold tracking-tight text-slate-900 dark:text-zinc-50 outline-none border-b border-transparent focus:border-slate-300 dark:focus:border-zinc-700 pb-0.5 text-center sm:text-left"
                  />
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 flex flex-wrap items-center justify-center sm:justify-start gap-x-1.5 gap-y-0.5">
                    <span>
                      Version :{' '}
                      <span className="font-mono text-slate-600 dark:text-zinc-300">
                        {activeEntry.versionLabel}
                      </span>
                    </span>
                    {track.sourceFilename && (
                      <span className="font-mono text-[11px] text-slate-500 dark:text-zinc-400">
                        · {track.sourceFilename}
                      </span>
                    )}
                    {track.googleDriveFileId && (
                      <a
                        href={`https://drive.google.com/file/d/${encodeURIComponent(
                          track.googleDriveFileId
                        )}/view`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400 hover:underline font-medium"
                      >
                        · Drive <ExternalLink size={10} />
                      </a>
                    )}
                    {track.durationSec ? <span>· {fmt(track.durationSec)}</span> : null}
                    {track.modifiedAt || track.addedAt ? (
                      <span>· {fmtDate(track.modifiedAt || track.addedAt)}</span>
                    ) : null}
                  </p>
                </div>

                {/* Quick Gradient Swatches + Remove Custom Cover */}
                <div className="flex items-center justify-center sm:justify-start gap-1.5 flex-wrap">
                  {PROJECT_GRADIENTS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() =>
                        setTrackGroupCover(allGroupTrackIds, {
                          coverGradient: g.id,
                          coverDataUrl: null,
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
                  {effectiveCover?.inheritedFromProject && (
                    <span className="text-[10px] text-slate-500 dark:text-zinc-400 font-medium ml-1">
                      Pochette du projet active
                    </span>
                  )}
                </div>

                {/* Action Pills */}
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      isCurrent
                        ? player.togglePlay()
                        : void player.playTrack(track, 0)
                    }
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#8C271E] hover:bg-[#A32E24] text-white px-4 py-2 text-xs font-semibold shadow-xs shadow-[#8C271E]/25 active:scale-95 transition cursor-pointer"
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

                  {activeProdTrack && activeProdTrack.id !== track.id && (
                    <button
                      type="button"
                      onClick={() =>
                        isCurrentProd
                          ? player.togglePlay()
                          : void player.playTrack(
                              activeProdTrack,
                              getCompareStartSec(),
                              [activeProdTrack]
                            )
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                        isPlayingProd
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-emerald-500/14 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/24'
                      }`}
                    >
                      {isPlayingProd ? (
                        <>
                          <Pause size={13} fill="currentColor" />
                          <span>Pause Prod</span>
                        </>
                      ) : (
                        <>
                          <Music2 size={13} />
                          <span>
                            {activeProdEntry && group.prodTracks.length > 1
                              ? `Prod (${activeProdEntry.versionLabel})`
                              : 'Lancer la prod'}
                          </span>
                        </>
                      )}
                    </button>
                  )}

                  {canDownloadOffline && (
                    <button
                      type="button"
                      disabled={isDownloadingOffline}
                      onClick={() => {
                        if (isTrackOffline) {
                          void player.removeTrackOffline(track.id);
                        } else {
                          void player.downloadTrackOffline(track);
                        }
                      }}
                      title={
                        isTrackOffline
                          ? 'Stocké hors-ligne — cliquer pour libérer le cache'
                          : 'Télécharger ce son pour l’écouter sans connexion'
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition cursor-pointer disabled:opacity-60 ${
                        isTrackOffline
                          ? 'bg-emerald-500/14 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/22'
                          : 'border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {isDownloadingOffline ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : isTrackOffline ? (
                        <Check size={13} />
                      ) : (
                        <Download size={13} className="text-slate-500 dark:text-zinc-400" />
                      )}
                      <span>
                        {isDownloadingOffline
                          ? 'Téléch…'
                          : isTrackOffline
                          ? `Hors-ligne${offlineBytes > 0 ? ` · ${formatBytes(offlineBytes)}` : ''}`
                          : 'Hors-ligne'}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => player.addToQueue(track, 'end')}
                    title="Ajouter ce morceau à la file d’attente"
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-zinc-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 transition cursor-pointer"
                  >
                    <ListPlus size={13} className="text-slate-500 dark:text-zinc-400" />
                    <span>+ File</span>
                  </button>

                  {linkedLyrics ? (
                    <div className="inline-flex items-center rounded-full border border-slate-200 dark:border-zinc-800 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenLyrics(track);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1.5 pl-3.5 pr-2.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 transition cursor-pointer"
                      >
                        <FileText size={13} className="text-slate-500 dark:text-zinc-400" />
                        <span>Texte</span>
                        {linkedLyricsMeta && (
                          <>
                            <span className={`h-1.5 w-1.5 rounded-full ${linkedLyricsMeta.dot}`} />
                            <span className="opacity-75">{linkedLyricsMeta.label}</span>
                          </>
                        )}
                        {fixTagCount > 0 && (
                          <span className="rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 font-mono text-[9px] font-bold">
                            [FIX] ×{fixTagCount}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLyricsSearch('');
                          setLyricsPickerOpen(true);
                        }}
                        title="Changer ou dissocier le texte lié"
                        aria-label="Changer le texte lié"
                        className="px-2.5 py-2 border-l border-slate-200 dark:border-zinc-800 text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-900 transition cursor-pointer"
                      >
                        <Link2 size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setLyricsSearch('');
                        setLyricsPickerOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-zinc-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 transition cursor-pointer"
                    >
                      <FileText size={13} className="text-slate-500 dark:text-zinc-400" />
                      <span>+ Lier / Créer texte</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (!track.googleDriveFileId && !track.cloudAudioUrl) {
                        notify('Ce son est local uniquement — importe-le depuis Drive pour le partager.');
                        return;
                      }
                      setShareModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-zinc-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 transition cursor-pointer"
                  >
                    <Share2 size={13} className="text-emerald-500" />
                    Partager
                  </button>
                </div>
              </div>
            </div>

            {/* Sleek Spotify-Style Linear Progress Bar + Fast A–B Loop */}
            <section className="w-full py-1 space-y-2">
              <div
                onPointerDown={(e) => {
                  const dur = effectiveDuration || 180;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = rect.width ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
                  const nextSec = ratio * dur;
                  dragRef.current = { pointerId: e.pointerId };
                  scrubTimeRef.current = nextSec;
                  scrubbingRef.current = true;
                  setScrubbing(true);
                  applyVisualFrame(nextSec, dur);
                  triggerHapticTick(8);
                }}
                onPointerMove={(e) => {
                  const drag = dragRef.current;
                  const dur = effectiveDuration || 180;
                  if (!drag || drag.pointerId !== e.pointerId) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = rect.width ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
                  const nextSec = ratio * dur;
                  scrubTimeRef.current = nextSec;
                  applyVisualFrame(nextSec, dur);
                }}
                onPointerUp={(e) => {
                  const drag = dragRef.current;
                  if (!drag || drag.pointerId !== e.pointerId) return;
                  dragRef.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  const targetSec = scrubTimeRef.current;
                  scrubbingRef.current = false;
                  setScrubbing(false);
                  if (isCurrent) {
                    player.seek(targetSec);
                    applyVisualFrame(targetSec, effectiveDuration);
                  } else {
                    void player.playTrack(track, targetSec);
                  }
                  triggerHapticTick(8);
                }}
                onPointerCancel={(e) => {
                  const drag = dragRef.current;
                  if (!drag || drag.pointerId !== e.pointerId) return;
                  dragRef.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  scrubbingRef.current = false;
                  setScrubbing(false);
                }}
                style={{ touchAction: 'none' }}
                className="group/bar relative w-full h-8 flex items-center cursor-pointer select-none"
                title="Cliquer ou glisser pour naviguer dans le son"
              >
                <div
                  className={`relative w-full rounded-full bg-slate-200/90 dark:bg-zinc-800 transition-[height] duration-100 overflow-hidden ${
                    scrubbing ? 'h-2' : 'h-1.5 group-hover/bar:h-2'
                  }`}
                >
                  {isCurrent &&
                    effectiveDuration > 0 &&
                    player.abLoop.start !== null &&
                    player.abLoop.end !== null && (
                      <div
                        style={{
                          left: `${Math.min(100, (player.abLoop.start / effectiveDuration) * 100)}%`,
                          width: `${Math.max(
                            0.5,
                            ((player.abLoop.end - player.abLoop.start) / effectiveDuration) * 100
                          )}%`,
                        }}
                        className="absolute inset-y-0 bg-amber-500/45 dark:bg-amber-400/45 pointer-events-none z-10"
                      />
                    )}
                  <div
                    ref={progressFillRef}
                    style={{ transform: 'scaleX(0)' }}
                    className="h-full w-full origin-left bg-[#8C271E] dark:bg-[#E04F42] will-change-transform"
                  />
                </div>

                {isCurrent && effectiveDuration > 0 && player.abLoop.start !== null && (
                  <div
                    style={{
                      left: `${Math.min(100, (player.abLoop.start / effectiveDuration) * 100)}%`,
                    }}
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-0.5 rounded-full bg-amber-500 z-10"
                  />
                )}
                {isCurrent && effectiveDuration > 0 && player.abLoop.end !== null && (
                  <div
                    style={{
                      left: `${Math.min(100, (player.abLoop.end / effectiveDuration) * 100)}%`,
                    }}
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-0.5 rounded-full bg-amber-500 z-10"
                  />
                )}

                <div
                  ref={progressThumbRef}
                  style={{ left: '0%' }}
                  className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8C271E] dark:bg-white shadow-sm transition-transform duration-100 will-change-[left] z-20 ${
                    scrubbing
                      ? 'h-4 w-4 scale-100'
                      : 'h-3 w-3 scale-90 group-hover/bar:scale-110'
                  }`}
                />
              </div>

              <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-500 dark:text-zinc-400 tabular-nums min-h-[1.25rem]">
                <span ref={timeCurrentRef}>{isCurrent ? fmt(player.currentTime) : '0:00'}</span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCycleAbLoop}
                    title="Boucle A–B rapide : 1er clic = point A · 2e clic = point B · 3e clic = annuler"
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-sans text-[10.5px] font-semibold transition cursor-pointer ${
                      isCurrent && player.abLoop.start !== null
                        ? 'bg-amber-500/16 text-amber-700 dark:text-amber-300 border border-amber-500/35'
                        : 'bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                    }`}
                  >
                    <Repeat size={10} />
                    {isCurrent && player.abLoop.start !== null && player.abLoop.end !== null ? (
                      <span className="font-mono">
                        A {fmt(player.abLoop.start)} – B {fmt(player.abLoop.end)}
                      </span>
                    ) : isCurrent && player.abLoop.start !== null ? (
                      <span className="font-mono">A {fmt(player.abLoop.start)} → B ?</span>
                    ) : (
                      <span>Boucle A–B</span>
                    )}
                  </button>
                  {isCurrent && player.abLoop.start !== null && (
                    <button
                      type="button"
                      onClick={() => player.setAbLoop({ start: null, end: null })}
                      title="Effacer la boucle A–B"
                      aria-label="Effacer la boucle A–B"
                      className="h-5 w-5 rounded-full bg-slate-100 dark:bg-zinc-900 text-slate-400 hover:text-rose-500 inline-flex items-center justify-center cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>

                <span ref={timeTotalRef}>{effectiveDuration > 0 ? fmt(effectiveDuration) : '—'}</span>
              </div>

              {track.markers.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5">
                  {track.markers.map((mk) => (
                    <button
                      key={mk.id}
                      type="button"
                      onClick={() => {
                        if (isCurrent) {
                          player.seek(mk.timeSec);
                          applyVisualFrame(mk.timeSec, effectiveDuration);
                        } else {
                          void player.playTrack(track, mk.timeSec);
                        }
                        triggerHapticTick(8);
                      }}
                      className="rounded-full bg-slate-900/8 dark:bg-white/10 hover:bg-slate-900/14 dark:hover:bg-white/20 px-2.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-zinc-200 transition cursor-pointer"
                    >
                      {fmt(mk.timeSec)} · {mk.label}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Free 1-Click Status Picker (no rigid sequential lock) */}
            <section className="rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/60 dark:bg-zinc-900/40 px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Statut
                </span>
                <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 truncate">
                  {TRACK_STATUS_META[workflow.status].label} · {TRACK_STATUS_META[workflow.status].hint}
                </span>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {TRACK_PIPELINE_ORDER.map((st, idx) => {
                  const meta = TRACK_STATUS_META[st];
                  const active = idx === currentStepIdx;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        if (active) return;
                        if (st === 'rec-final' && fixTagCount > 0) {
                          notify(
                            `Attention : encore ${fixTagCount} balise${fixTagCount > 1 ? 's' : ''} [FIX] dans les paroles`
                          );
                        }
                        setTrackGroupWorkflow(allGroupTrackIds, { status: st });
                        notify(`Statut : ${meta.label} ✓`);
                      }}
                      title={`${meta.label} — ${meta.hint}`}
                      className={`rounded-xl px-2 py-1.5 text-center transition cursor-pointer ${
                        active
                          ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20 font-semibold'
                          : 'bg-white dark:bg-zinc-900/90 border border-slate-200/70 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-[#8C271E]/45 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <span className="block text-[11px] truncate">{meta.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Collapsible Optional Ratings (Note actuelle + Potentiel /10) */}
            <section className="rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/60 dark:bg-zinc-900/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowRatings((v) => !v)}
                className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-100/60 dark:hover:bg-zinc-800/40 transition cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <TrendingUp size={13} className="text-[#8C271E] shrink-0" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                    Notes & Potentiel
                  </span>
                  {ratings.current !== null || ratings.potential !== null ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-slate-700 dark:text-zinc-200">
                      {ratings.current !== null && <span>{ratings.current}/10</span>}
                      {ratings.current !== null && ratings.potential !== null && (
                        <span className="opacity-35">·</span>
                      )}
                      {ratings.potential !== null && (
                        <span className="text-[#8C271E] dark:text-[#E56B5F]">
                          ↗ {ratings.potential}/10
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">Optionnel</span>
                  )}
                </div>
                <ChevronDown
                  size={14}
                  className={`text-slate-400 transition-transform ${showRatings ? 'rotate-180' : ''}`}
                />
              </button>

              {showRatings && (
                <div className="px-4 pb-3.5 pt-1 border-t border-slate-200/60 dark:border-zinc-800/70 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                        Note actuelle
                      </span>
                      <span className="font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-zinc-100">
                        {ratings.current !== null ? `${ratings.current}/10` : '—'}
                      </span>
                    </div>
                    <div className="grid grid-cols-10 gap-1">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => {
                        const active = ratings.current === val;
                        const filled = ratings.current !== null && val <= ratings.current;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() =>
                              setTrackGroupRatings(allGroupTrackIds, {
                                ratingCurrent: active ? null : val,
                              })
                            }
                            className={`h-7 rounded-lg font-mono text-[11px] font-semibold transition cursor-pointer ${
                              active
                                ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20'
                                : filled
                                ? 'bg-[#8C271E]/14 text-[#8C271E] dark:text-[#E56B5F]'
                                : 'bg-white dark:bg-zinc-900/90 border border-slate-200/70 dark:border-zinc-800 text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100'
                            }`}
                          >
                            {val}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-slate-200/60 dark:border-zinc-800/70">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                        <TrendingUp size={12} className="text-[#8C271E]" />
                        Potentiel
                      </span>
                      <span className="font-mono text-xs font-semibold tabular-nums text-[#8C271E]">
                        {ratings.potential !== null ? `${ratings.potential}/10` : '—'}
                      </span>
                    </div>
                    <div className="grid grid-cols-10 gap-1">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => {
                        const active = ratings.potential === val;
                        const filled = ratings.potential !== null && val <= ratings.potential;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() =>
                              setTrackGroupRatings(allGroupTrackIds, {
                                ratingPotential: active ? null : val,
                              })
                            }
                            className={`h-7 rounded-lg font-mono text-[11px] font-semibold transition cursor-pointer ${
                              active
                                ? 'bg-[#8C271E] text-white'
                                : filled
                                ? 'bg-[#8C271E]/18 text-[#8C271E] dark:text-[#E56B5F]'
                                : 'bg-white dark:bg-zinc-900/90 border border-slate-200/70 dark:border-zinc-800 text-slate-400 hover:text-[#8C271E]'
                            }`}
                          >
                            {val}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Branches / Variantes par Prod (visible only when song has 2+ branches) */}
            {group.hasMultipleVariants && activeBranch && (
              <section className="rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/70 dark:bg-zinc-900/45 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <Layers size={12} className="text-[#8C271E]" />
                    Variantes / Prods ({group.variants.length})
                  </h3>
                  <div className="flex items-center gap-1.5">
                    {onRequestCreateVariant && (
                      <button
                        type="button"
                        onClick={() => onRequestCreateVariant(group, track.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20 hover:opacity-90 px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer"
                      >
                        <Plus size={11} /> Variante
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDetachBranch({
                          ids: activeBranch.allTrackIds,
                          label: activeBranch.label,
                        })
                      }
                      title="Séparer toute cette variante en morceau indépendant"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-rose-400 hover:text-rose-500 text-slate-500 dark:text-zinc-400 px-2 py-1 text-[11px] font-medium transition cursor-pointer"
                    >
                      <Unlink size={10} /> Séparer en son
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {group.variants.map((br) => {
                    const isViewing = br.id === activeBranch.id;
                    const isEditingThis = editingVariantId === br.id;
                    const isDropHover = dragOverVariantId === br.id && draggingTrackId !== null;
                    return (
                      <div
                        key={br.id}
                        onDragOver={(e) => {
                          if (!draggingTrackId) return;
                          e.preventDefault();
                          if (dragOverVariantId !== br.id) setDragOverVariantId(br.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverVariantId === br.id) setDragOverVariantId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const droppedId = e.dataTransfer.getData('text/plain') || draggingTrackId;
                          setDragOverVariantId(null);
                          setDraggingTrackId(null);
                          if (!droppedId) return;
                          const movedCount = moveTracksToVariant(
                            allGroupTrackIds,
                            droppedId,
                            br.rawLabel,
                            true
                          );
                          setViewedVariantId(br.id);
                          notify(
                            movedCount > 1
                              ? `${movedCount} versions déplacées dans « ${br.label} » ✓`
                              : `Déplacé dans « ${br.label} » ✓`
                          );
                          triggerHapticTick(8);
                        }}
                        className={`inline-flex items-center rounded-xl border transition overflow-hidden ${
                          isDropHover
                            ? 'bg-[#8C271E] text-white border-[#8C271E] ring-2 ring-[#8C271E]/50 scale-105'
                            : isViewing
                            ? 'bg-slate-900 dark:bg-white text-white dark:text-zinc-950 border-slate-900 dark:border-white shadow-xs'
                            : 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-slate-200/80 dark:border-zinc-800 hover:border-slate-400 dark:hover:border-zinc-600'
                        }`}
                      >
                        {isEditingThis ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const clean = editingVariantDraft.trim();
                              if (clean) {
                                renameTrackVariant(allGroupTrackIds, br.rawLabel, clean);
                                setViewedVariantId(clean.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'default');
                                notify(`Variante renommée en « ${clean} » ✓`);
                              }
                              setEditingVariantId(null);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1"
                          >
                            <input
                              autoFocus
                              type="text"
                              value={editingVariantDraft}
                              onChange={(e) => setEditingVariantDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditingVariantId(null);
                              }}
                              onBlur={() => setEditingVariantId(null)}
                              placeholder="Ex. Prod 276…"
                              className="w-28 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 rounded-md px-1.5 py-0.5 text-xs outline-none"
                            />
                            <button
                              type="submit"
                              onMouseDown={(e) => e.preventDefault()}
                              className="p-0.5 rounded bg-[#8C271E] text-white cursor-pointer"
                            >
                              <Check size={11} />
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setViewedVariantId(br.id);
                                setAssignBranchTrackId(null);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                            >
                              {br.hasActiveSelection && (
                                <span
                                  title="Variante active globalement"
                                  className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                    isViewing ? 'bg-[#E04F42]' : 'bg-[#8C271E]'
                                  }`}
                                />
                              )}
                              <span className="truncate max-w-[140px]">{br.label}</span>
                              <span className="font-mono text-[10px] opacity-65">
                                {br.versions.length}
                                {br.prodTracks.length > 0 ? `+${br.prodTracks.length}p` : ''}
                              </span>
                            </button>
                            <button
                              type="button"
                              title="Renommer cette variante"
                              onClick={() => {
                                setEditingVariantId(br.id);
                                setEditingVariantDraft(br.label);
                              }}
                              className="pr-2 pl-0.5 py-1.5 opacity-55 hover:opacity-100 transition cursor-pointer"
                            >
                              <Pencil size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Versions Switcher + A/B Timecode Comparator */}
            <section className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <GitBranch size={12} />{' '}
                    {group.hasMultipleVariants && activeBranch
                      ? `Versions · ${activeBranch.label} (${displayedVersions.length})`
                      : `Versions de ${group.baseTitle} (${displayedVersions.length})`}
                  </h3>
                  {(group.hasMultipleVersions || group.prodTracks.length > 0) && (
                    <button
                      type="button"
                      onClick={() => setAbSyncTimecode((v) => !v)}
                      title="Comparateur A/B : conserve exactement la seconde de lecture quand tu bascules entre versions ou prods"
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition cursor-pointer ${
                        abSyncTimecode
                          ? 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#E56B5F] border border-[#8C271E]/25'
                          : 'bg-slate-100 dark:bg-zinc-900 text-slate-400'
                      }`}
                    >
                      <ArrowLeftRight size={9} />
                      A/B synchro
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRequestPullVersion(group, track.id, activeBranchRawLabel)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20 hover:opacity-90 px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer"
                  >
                    <Plus size={11} /> Ajouter une version
                  </button>
                  {!group.hasMultipleVariants && onRequestCreateVariant && (
                    <button
                      type="button"
                      onClick={() => onRequestCreateVariant(group, track.id)}
                      title="Ajouter une autre direction / prod (ex. Projet 276) comme variante séparée de ce son"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-zinc-800 hover:border-[#8C271E]/50 hover:text-[#8C271E] dark:hover:text-[#E56B5F] text-slate-600 dark:text-zinc-300 px-2 py-1 text-[11px] font-medium transition cursor-pointer"
                    >
                      <Layers size={11} /> + Variante
                    </button>
                  )}
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
                {displayedVersions.map((v) => {
                  const selected = v.track.id === group.latestTrack.id;
                  const playingThis =
                    player.currentTrack?.id === v.track.id && player.isPlaying;
                  const isPickingBranch = assignBranchTrackId === v.track.id;
                  return (
                    <div
                      key={v.track.id}
                      draggable={group.hasMultipleVariants}
                      onDragStart={(e) => {
                        setDraggingTrackId(v.track.id);
                        e.dataTransfer.setData('text/plain', v.track.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDraggingTrackId(null);
                        setDragOverVariantId(null);
                      }}
                      className={`inline-flex items-center rounded-xl border transition overflow-hidden ${
                        isPickingBranch
                          ? 'ring-2 ring-[#8C271E] border-[#8C271E]'
                          : ''
                      } ${
                        selected
                          ? 'bg-[#8C271E] text-white border-[#8C271E] shadow-xs shadow-[#8C271E]/25'
                          : 'bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border-slate-200/80 dark:border-zinc-800 hover:border-slate-400 dark:hover:border-zinc-600'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          const keepSec = getCompareStartSec();
                          selectGroupPreferredVersion(v.track.id, 'song');
                          onSelectVersion(v.track.id);
                          void player.playTrack(v.track, keepSec);
                          notify(
                            keepSec > 0.3
                              ? `A/B → ${v.versionLabel} (${fmt(keepSec)}) ✓`
                              : `Version « ${v.versionLabel} » sélectionnée partout ✓`
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer"
                      >
                        <span className="font-mono font-semibold">{v.versionLabel}</span>
                        {(v.track.modifiedAt || v.track.addedAt) && (
                          <span
                            className={`font-mono text-[10px] ${
                              selected ? 'opacity-70' : 'text-slate-400 dark:text-zinc-500'
                            }`}
                          >
                            {fmtDate(v.track.modifiedAt || v.track.addedAt)}
                          </span>
                        )}
                        {selected && group.hasMultipleVersions && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/20 text-white">
                            Active
                          </span>
                        )}
                        {playingThis && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                      </button>

                      {group.allTrackIds.length > 1 && (
                        <button
                          type="button"
                          title="Déplacer vers une variante (ou créer une variante)"
                          onClick={() => {
                            if (assignBranchTrackId === v.track.id) {
                              setAssignBranchTrackId(null);
                            } else {
                              setAssignBranchTrackId(v.track.id);
                              setAssignBranchDraft('');
                              setAssignIncludeSiblings(true);
                            }
                          }}
                          className={`px-1 py-1.5 transition cursor-pointer ${
                            isPickingBranch ? 'opacity-100' : 'opacity-55 hover:opacity-100'
                          }`}
                        >
                          <Layers size={10.5} />
                        </button>
                      )}

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

              {/* Quick 1-Click Move-to-Variant Picker (works for both vocal versions & prods!) */}
              {assignBranchTrackId && (() => {
                const targetEntry =
                  group.versions.find((e) => e.track.id === assignBranchTrackId) ||
                  group.prodTracks.find((e) => e.track.id === assignBranchTrackId);
                if (!targetEntry) return null;
                const targetPrefix = extractTrackRoutingPrefix(targetEntry.track);
                const samePrefixCount = targetPrefix
                  ? [...group.versions, ...group.prodTracks].filter(
                      (e) =>
                        e.track.id !== targetEntry.track.id &&
                        extractTrackRoutingPrefix(e.track) === targetPrefix
                    ).length
                  : 0;
                const currentBranchOfTarget = group.variants.find((b) =>
                  b.allTrackIds.includes(targetEntry.track.id)
                );

                const commitMove = (destRawLabel: string | null, destDisplayLabel: string) => {
                  const movedCount = moveTracksToVariant(
                    allGroupTrackIds,
                    targetEntry.track.id,
                    destRawLabel,
                    assignIncludeSiblings
                  );
                  const destId = destRawLabel ? normalizeGroupKey(destRawLabel) || 'default' : 'default';
                  setViewedVariantId(destId);
                  setAssignBranchTrackId(null);
                  setAssignBranchDraft('');
                  notify(
                    movedCount > 1
                      ? `${movedCount} versions déplacées dans « ${destDisplayLabel} » ✓`
                      : `« ${targetEntry.versionLabel} » déplacé dans « ${destDisplayLabel} » ✓`
                  );
                  triggerHapticTick(8);
                };

                return (
                  <div className="rounded-2xl border border-[#8C271E]/30 bg-[#8C271E]/[0.05] dark:bg-[#8C271E]/[0.12] p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-zinc-100 truncate">
                        Déplacer « {targetEntry.versionLabel} » vers une variante :
                      </span>
                      <button
                        type="button"
                        onClick={() => setAssignBranchTrackId(null)}
                        className="p-0.5 text-slate-400 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                      >
                        <X size={13} />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {group.variants.map((br) => {
                        const isSame = currentBranchOfTarget?.id === br.id;
                        return (
                          <button
                            key={br.id}
                            type="button"
                            disabled={isSame}
                            onClick={() => commitMove(br.rawLabel, br.label)}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                              isSame
                                ? 'bg-slate-200/80 dark:bg-zinc-800 text-slate-400 cursor-default'
                                : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-800 dark:text-zinc-100 hover:border-[#8C271E] hover:text-[#8C271E] dark:hover:text-[#F08B82] cursor-pointer'
                            }`}
                          >
                            <span>{br.label}</span>
                            {isSame && <span className="text-[9px] opacity-70">(actuelle)</span>}
                          </button>
                        );
                      })}

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const clean = assignBranchDraft.trim();
                          if (!clean) return;
                          commitMove(clean, clean);
                        }}
                        className="inline-flex items-center gap-1"
                      >
                        <input
                          type="text"
                          value={assignBranchDraft}
                          onChange={(e) => setAssignBranchDraft(e.target.value)}
                          placeholder="+ Nouvelle variante…"
                          className="w-36 rounded-full border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1 text-[11px] text-slate-900 dark:text-zinc-100 outline-none focus:border-[#8C271E]"
                        />
                        {assignBranchDraft.trim() && (
                          <button
                            type="submit"
                            className="rounded-full bg-[#8C271E] text-white px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                          >
                            Créer
                          </button>
                        )}
                      </form>
                    </div>

                    {samePrefixCount > 0 && (
                      <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-zinc-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={assignIncludeSiblings}
                          onChange={(e) => setAssignIncludeSiblings(e.target.checked)}
                          className="h-3.5 w-3.5 accent-[#8C271E] cursor-pointer"
                        />
                        <span>
                          Inclure les {samePrefixCount} autre{samePrefixCount > 1 ? 's' : ''} version
                          {samePrefixCount > 1 ? 's' : ''} du même préfixe
                        </span>
                      </label>
                    )}
                  </div>
                );
              })()}
            </section>

            {/* Multiple Prod / Instrumental Versions Section */}
            <section className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-600/90 dark:text-emerald-400/90 flex items-center gap-1.5">
                  <Music2 size={12} />{' '}
                  {group.hasMultipleVariants && activeBranch
                    ? `Prods · ${activeBranch.label} (${displayedProds.length})`
                    : `Versions de prod (${displayedProds.length})`}
                </h3>
                {onRequestPullProd && (
                  <button
                    type="button"
                    onClick={() => onRequestPullProd(group, track.id, activeBranchRawLabel)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white shadow-xs shadow-emerald-600/20 hover:bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer"
                  >
                    <Plus size={11} /> Ajouter une prod
                  </button>
                )}
              </div>

              {displayedProds.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-zinc-500">
                  {group.hasMultipleVariants && activeBranch
                    ? `Aucune prod liée à « ${activeBranch.label} » pour l’instant.`
                    : 'Aucune prod liée pour l’instant — ajoute une ou plusieurs versions d’instru pour basculer facilement entre elles.'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {displayedProds.map((p) => {
                    const isSelectedProd = p.track.id === group.prodTrack?.id;
                    const isThisProdCurrent = player.currentTrack?.id === p.track.id;
                    const playingThisProd = isThisProdCurrent && player.isPlaying;
                    const isEditingThis = editingProdId === p.track.id;
                    return (
                      <div
                        key={p.track.id}
                        draggable={group.hasMultipleVariants}
                        onDragStart={(e) => {
                          setDraggingTrackId(p.track.id);
                          e.dataTransfer.setData('text/plain', p.track.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggingTrackId(null);
                          setDragOverVariantId(null);
                        }}
                        className={`inline-flex items-center rounded-xl border transition overflow-hidden ${
                          isSelectedProd
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs shadow-emerald-600/25'
                            : 'bg-emerald-500/8 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-emerald-500/25 hover:border-emerald-500/50'
                        }`}
                      >
                        {isEditingThis ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const clean = editingProdDraft.trim();
                              if (clean) {
                                updateMusicTrack(p.track.id, {
                                  manualVersionLabel: clean,
                                  isProdOverride: true,
                                });
                                notify(`Prod renommée en « ${clean} » ✓`);
                              }
                              setEditingProdId(null);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1"
                          >
                            <input
                              autoFocus
                              type="text"
                              value={editingProdDraft}
                              onChange={(e) => setEditingProdDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditingProdId(null);
                              }}
                              onBlur={() => setEditingProdId(null)}
                              placeholder="Ex. Prod v2, Guitare…"
                              className="w-28 bg-white/90 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 rounded-md px-1.5 py-0.5 text-xs outline-none"
                            />
                            <button
                              type="submit"
                              onMouseDown={(e) => e.preventDefault()}
                              className="p-0.5 rounded bg-emerald-600 text-white cursor-pointer"
                            >
                              <Check size={11} />
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const keepSec = getCompareStartSec();
                                selectGroupPreferredVersion(p.track.id, 'prod');
                                if (isThisProdCurrent) {
                                  player.togglePlay();
                                } else {
                                  void player.playTrack(p.track, keepSec, [p.track]);
                                }
                                if (keepSec > 0.3 && !isThisProdCurrent) {
                                  notify(`A/B → ${p.versionLabel} (${fmt(keepSec)}) ✓`);
                                } else if (!isSelectedProd) {
                                  notify(`Prod « ${p.versionLabel} » sélectionnée partout ✓`);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer"
                            >
                              {playingThisProd ? (
                                <Pause size={11} fill="currentColor" />
                              ) : (
                                <Play size={11} fill="currentColor" />
                              )}
                              <span className="font-mono font-semibold">{p.versionLabel}</span>
                              {(p.track.modifiedAt || p.track.addedAt) && (
                                <span
                                  className={`font-mono text-[10px] ${
                                    isSelectedProd ? 'opacity-75' : 'text-emerald-700/60 dark:text-emerald-300/60'
                                  }`}
                                >
                                  {fmtDate(p.track.modifiedAt || p.track.addedAt)}
                                </span>
                              )}
                              {isSelectedProd && group.prodTracks.length > 1 && (
                                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/20 text-white">
                                  Active
                                </span>
                              )}
                              {playingThisProd && (
                                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                              )}
                            </button>

                            <button
                              type="button"
                              title="Renommer cette version de prod"
                              onClick={() => {
                                setEditingProdId(p.track.id);
                                setEditingProdDraft(p.versionLabel);
                              }}
                              className={`px-1 py-1.5 opacity-60 hover:opacity-100 transition cursor-pointer ${
                                isSelectedProd ? 'text-white' : 'text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              <Pencil size={10} />
                            </button>

                            {group.allTrackIds.length > 1 && (
                              <button
                                type="button"
                                title="Déplacer cette prod vers une variante"
                                onClick={() => {
                                  if (assignBranchTrackId === p.track.id) {
                                    setAssignBranchTrackId(null);
                                  } else {
                                    setAssignBranchTrackId(p.track.id);
                                    setAssignBranchDraft('');
                                    setAssignIncludeSiblings(false);
                                  }
                                }}
                                className={`px-1 py-1.5 opacity-60 hover:opacity-100 transition cursor-pointer ${
                                  isSelectedProd ? 'text-white' : 'text-emerald-700 dark:text-emerald-300'
                                }`}
                              >
                                <Layers size={10.5} />
                              </button>
                            )}

                            {group.allTrackIds.length > 1 && (
                              <button
                                type="button"
                                title="Détacher cette prod en fichier indépendant"
                                onClick={() => onDetachVersion(p.track.id)}
                                className={`pr-2 pl-1 py-1.5 opacity-60 hover:opacity-100 transition cursor-pointer ${
                                  isSelectedProd ? 'hover:text-rose-200' : 'hover:text-rose-500'
                                }`}
                              >
                                <Unlink size={11} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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

            {/* TODO & Pense-bête / Inspis Card (Single unified compact card!) */}
            <section className="space-y-3 rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/35 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="inline-flex items-center gap-1 rounded-xl bg-slate-200/60 dark:bg-zinc-900 p-0.5">
                  <button
                    type="button"
                    onClick={() => setTodoCardTab('todo')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      todoCardTab === 'todo'
                        ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    <ListChecks size={13} />
                    <span>TODO</span>
                    {todos.length > 0 && (
                      <span className="font-mono text-[10px] opacity-65">
                        {doneTodos}/{todos.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTodoCardTab('notes')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      todoCardTab === 'notes'
                        ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Sparkles size={12} className="text-amber-500" />
                    <span>Pense-bête</span>
                    {(track.quickNotes?.length || 0) > 0 && (
                      <span className="font-mono text-[10px] opacity-65">
                        {track.quickNotes?.length}
                      </span>
                    )}
                  </button>
                </div>

                {todoCardTab === 'todo' && todos.length > 0 && (
                  <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-zinc-300">
                    {todoPct}%
                  </span>
                )}
              </div>

              {todoCardTab === 'notes' ? (
                <QuickNotesPanel
                  notes={track.quickNotes || []}
                  placeholder="+ Noter une inspi, une idée de couplet/mix ou coller un lien…"
                  onAdd={(txt, refId) => addMusicTrackNote(track.id, txt, refId)}
                  onUpdate={(nid, txt) => updateMusicTrackNote(track.id, nid, txt)}
                  onDelete={(nid) => deleteMusicTrackNote(track.id, nid)}
                  onPromoteToTodo={(nid) => {
                    promoteMusicTrackNoteToTodo(track.id, nid);
                    setTodoCardTab('todo');
                  }}
                />
              ) : (
                <>
                  {todos.length > 0 && (
                    <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden">
                      <div
                        style={{ width: `${todoPct}%` }}
                        className="h-full rounded-full bg-[#8C271E] transition-all duration-300"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                {todos.length === 0 ? (
                  <p className="text-[11px] text-slate-400 py-1">
                    Aucune tâche pour ce son — ajoute tes prochaines modifs (ex. « Revoir la 808 », « Enregistrer refrain »).
                  </p>
                ) : (
                  todos.map((td) => {
                    const isEditing = editingTodoId === td.id;
                    return (
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
                          {isEditing ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (editingTodoDraft.trim()) {
                                  updateMusicTrackTodo(track.id, td.id, editingTodoDraft);
                                }
                                setEditingTodoId(null);
                              }}
                              className="flex-1 flex items-center gap-1.5 min-w-0"
                            >
                              <input
                                autoFocus
                                type="text"
                                value={editingTodoDraft}
                                onChange={(e) => setEditingTodoDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') setEditingTodoId(null);
                                }}
                                onBlur={() => {
                                  if (editingTodoDraft.trim()) {
                                    updateMusicTrackTodo(track.id, td.id, editingTodoDraft);
                                  }
                                  setEditingTodoId(null);
                                }}
                                className="flex-1 min-w-0 rounded-lg border border-[#8C271E]/50 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-900 dark:text-zinc-100 outline-none"
                              />
                              <button
                                type="submit"
                                onMouseDown={(e) => e.preventDefault()}
                                aria-label="Enregistrer"
                                className="p-1 rounded-lg bg-[#8C271E] text-white cursor-pointer shrink-0"
                              >
                                <Check size={11} />
                              </button>
                            </form>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTodoId(td.id);
                                setEditingTodoDraft(td.label);
                              }}
                              title="Cliquer pour modifier cette tâche"
                              className={`text-xs truncate text-left flex-1 cursor-text ${
                                td.done
                                  ? 'line-through text-slate-400 dark:text-zinc-500'
                                  : 'text-slate-800 dark:text-zinc-100'
                              }`}
                            >
                              {td.label}
                            </button>
                          )}
                        </div>
                        {!isEditing && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTodoId(td.id);
                                setEditingTodoDraft(td.label);
                              }}
                              title="Modifier cette tâche"
                              aria-label="Modifier cette tâche"
                              className="opacity-60 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100 transition cursor-pointer"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteMusicTrackTodo(track.id, td.id)}
                              aria-label="Supprimer cette tâche"
                              className="opacity-60 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
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
                  className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs outline-none focus:border-slate-400 dark:focus:border-zinc-600"
                />
                <button
                  type="submit"
                  className="h-8 px-3 rounded-xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={13} /> Ajouter
                </button>
              </form>
                </>
              )}
            </section>

            {/* Metadata Grid: BPM, Key, Project */}
            <section className="grid grid-cols-3 gap-2.5">
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
                <button
                  type="button"
                  onClick={() => setProjectPickerOpen(true)}
                  className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 hover:border-slate-300 dark:hover:border-zinc-700 px-2.5 py-2 text-xs text-left font-medium text-slate-800 dark:text-zinc-200 truncate transition cursor-pointer"
                >
                  {linkedProject ? linkedProject.title : 'Aucun projet…'}
                </button>
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
                      className="inline-flex items-center gap-1 hover:text-[#8C271E] cursor-pointer"
                    >
                      <Tag size={10} className="text-[#8C271E]" />
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
                    className="w-40 rounded-full border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] outline-none focus:border-slate-400 dark:focus:border-zinc-600"
                  />
                </form>
              </div>
            </section>
          </div>
        </div>
        {/* Searchable Lyrics Picker Modal */}
        {lyricsPickerOpen && (
          <div
            onClick={() => setLyricsPickerOpen(false)}
            className="fixed inset-0 z-[60] bg-slate-950/50 dark:bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#141418] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[80dvh]"
            >
              <div className="px-4 py-3.5 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                    Associer un texte à « {group.baseTitle} »
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setLyricsPickerOpen(false)}
                  className="p-1.5 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="p-3 border-b border-slate-100 dark:border-zinc-800 space-y-2">
                <div className="flex items-center gap-2 rounded-xl bg-slate-100/80 dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 px-3 py-2">
                  <Search size={13} className="text-slate-400 shrink-0" />
                  <input
                    autoFocus
                    type="text"
                    value={lyricsSearch}
                    onChange={(e) => setLyricsSearch(e.target.value)}
                    placeholder="Rechercher un texte existant…"
                    className="w-full bg-transparent text-xs outline-none text-slate-900 dark:text-zinc-100 placeholder:text-slate-400"
                  />
                  {lyricsSearch && (
                    <button
                      type="button"
                      onClick={() => setLyricsSearch('')}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setLyricsPickerOpen(false);
                      onOpenLyrics(track);
                      onClose();
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20 px-3 py-2 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
                  >
                    <Plus size={13} />
                    {linkedLyrics ? 'Ouvrir le texte lié' : 'Créer un nouveau texte'}
                  </button>
                  {linkedLyrics && (
                    <button
                      type="button"
                      onClick={() => {
                        for (const id of allGroupTrackIds) {
                          const t = state.musicTracks.find((x) => x.id === id);
                          if (t?.linkedLyricsId === linkedLyrics.id) {
                            updateMusicTrack(id, { linkedLyricsId: undefined });
                          }
                        }
                        if (
                          linkedLyrics.linkedTrackId &&
                          allGroupTrackIds.includes(linkedLyrics.linkedTrackId)
                        ) {
                          updateLyricsDoc(linkedLyrics.id, { linkedTrackId: undefined });
                        }
                        notify('Texte dissocié');
                        setLyricsPickerOpen(false);
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border border-rose-200 dark:border-rose-900/60 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                    >
                      <Unlink size={12} /> Dissocier
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {(() => {
                  const q = lyricsSearch.trim().toLowerCase();
                  const docs = state.lyricsDocs
                    .filter((d) => !d.deletedAt)
                    .filter(
                      (d) =>
                        !q ||
                        d.title.toLowerCase().includes(q) ||
                        d.content.toLowerCase().includes(q)
                    )
                    .sort(
                      (a, b) =>
                        new Date(b.lastModified || 0).getTime() -
                        new Date(a.lastModified || 0).getTime()
                    );
                  if (docs.length === 0) {
                    return (
                      <p className="py-8 text-center text-xs text-slate-400">
                        Aucun texte trouvé.
                      </p>
                    );
                  }
                  return docs.map((doc) => {
                    const isSelected = linkedLyrics?.id === doc.id;
                    const st = LYRICS_STATUS_META[doc.status || 1];
                    const words = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => {
                          // Unlink previous doc if different
                          if (linkedLyrics && linkedLyrics.id !== doc.id) {
                            if (
                              linkedLyrics.linkedTrackId &&
                              allGroupTrackIds.includes(linkedLyrics.linkedTrackId)
                            ) {
                              updateLyricsDoc(linkedLyrics.id, { linkedTrackId: undefined });
                            }
                          }
                          updateMusicTrack(track.id, { linkedLyricsId: doc.id });
                          updateLyricsDoc(doc.id, { linkedTrackId: track.id });
                          notify(`Texte « ${doc.title || 'Sans titre'} » associé ✓`);
                          setLyricsPickerOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition cursor-pointer ${
                          isSelected
                            ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20'
                            : 'hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-slate-800 dark:text-zinc-100'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold truncate">
                              {doc.title || 'Sans titre'}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium shrink-0 ${
                                isSelected
                                  ? 'bg-white/15 dark:bg-black/15 text-current'
                                  : st.badge
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                              {st.label}
                            </span>
                          </div>
                          <p
                            className={`text-[10px] truncate mt-0.5 ${
                              isSelected ? 'opacity-70' : 'text-slate-400'
                            }`}
                          >
                            {doc.content.trim().slice(0, 65) || `${words} mots`}
                          </p>
                        </div>
                        {isSelected && <Check size={14} className="shrink-0" />}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Apple-Style Project Assignment Sheet */}
        {projectPickerOpen && (
          <div
            onClick={() => setProjectPickerOpen(false)}
            className="fixed inset-0 z-[60] bg-slate-950/50 dark:bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#141418] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[75dvh]"
            >
              <div className="px-4 py-3.5 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                  Projet de « {group.baseTitle} »
                </h3>
                <button
                  type="button"
                  onClick={() => setProjectPickerOpen(false)}
                  className="p-1.5 rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="p-2 overflow-y-auto space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    handleAssignProject('');
                    setProjectPickerOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition cursor-pointer ${
                    !linkedProject
                      ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20 font-semibold'
                      : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800/80'
                  }`}
                >
                  <span>Aucun projet (son indépendant)</span>
                  {!linkedProject && <Check size={14} />}
                </button>

                {state.musicProjects.map((proj) => {
                  const selected = linkedProject?.id === proj.id;
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => {
                        handleAssignProject(proj.id);
                        setProjectPickerOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition cursor-pointer ${
                        selected
                          ? 'bg-[#8C271E] text-white shadow-xs shadow-[#8C271E]/20 font-semibold'
                          : 'text-slate-800 dark:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800/80'
                      }`}
                    >
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <FolderKanban size={13} className={selected ? 'text-current' : 'text-slate-400'} />
                        <span className="truncate">{proj.title}</span>
                        <span className="text-[10px] uppercase opacity-55 shrink-0">
                          {proj.kind}
                        </span>
                      </div>
                      {selected && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <AppleConfirmDialog
          open={confirmDeleteOpen}
          title={
            group.hasMultipleVersions
              ? `Supprimer la version ${activeEntry.versionLabel} ?`
              : `Supprimer « ${group.baseTitle} » ?`
          }
          description="Ce morceau sera retiré de ta bibliothèque Kora."
          confirmLabel="Supprimer"
          destructive
          onConfirm={() => {
            deleteMusicTrack(track.id);
            if (group.versions.length <= 1) onClose();
          }}
          onCancel={() => setConfirmDeleteOpen(false)}
        />

        <AppleConfirmDialog
          open={Boolean(confirmDetachBranch)}
          title={`Séparer « ${confirmDetachBranch?.label || ''} » en son indépendant ?`}
          description="Toutes les versions et prods de cette variante formeront un nouveau morceau séparé dans ta bibliothèque."
          confirmLabel="Séparer"
          onConfirm={() => {
            if (!confirmDetachBranch) return;
            detachTrackVariant(
              confirmDetachBranch.ids,
              `${group.baseTitle} (${confirmDetachBranch.label})`
            );
            notify(`Variante « ${confirmDetachBranch.label} » séparée en son indépendant ✓`);
            setConfirmDetachBranch(null);
          }}
          onCancel={() => setConfirmDetachBranch(null)}
        />

        <ShareOptionsModal
          open={shareModalOpen}
          kind="track"
          id={track.id}
          title={group.baseTitle}
          onClose={() => setShareModalOpen(false)}
        />
      </motion.div>
    </AnimatePresence>
  );
}
