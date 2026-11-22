import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Check,
  ChevronLeft,
  Disc3,
  ExternalLink,
  FileText,
  FolderKanban,
  GitBranch,
  Link2,
  ListChecks,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  Share2,
  Star,
  Tag,
  Trash2,
  TrendingUp,
  Unlink,
  X,
} from 'lucide-react';
import type { MusicTrack, TrackMood, TrackStatus } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { getMediaObjectUrl } from '../../lib/mediaDb';
import { triggerHapticTick } from '../../lib/haptics';
import { shareOrCopyPublicLink } from '../../lib/publicShare';
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
import { getDeterministicGradientId } from '../../lib/musicVersioning';
import {
  TRACK_MOOD_META,
  TRACK_PIPELINE_ORDER,
  TRACK_STATUS_META,
} from '../../utils/theme';
import { AppleConfirmDialog } from '../ui/AppleConfirmDialog';
import { CheckCircle } from '../ui/CheckCircle';
import { getGradientClass, PROJECT_GRADIENTS } from './MiniAudioPlayer';

interface TrackDetailModalProps {
  group: TrackGroup | null;
  selectedTrackId: string | null;
  activeProjectId?: string | null;
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
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

const BAR_COUNT = 110;
const BAR_STEP_PX = 4.5;
const TOTAL_TAPE_PX = BAR_COUNT * BAR_STEP_PX;

export function TrackDetailModal({
  group,
  selectedTrackId,
  activeProjectId,
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
    renameTrackGroup,
    setTrackGroupCover,
    setTrackGroupFavorite,
    setTrackGroupRatings,
    setTrackGroupWorkflow,
    addMusicTrackTodo,
    toggleMusicTrackTodo,
    deleteMusicTrackTodo,
    addTrackMarker,
    deleteTrackMarker,
    deleteMusicTrack,
    updateMusicProject,
    setProjectTrackVersion,
    updateLyricsDoc,
    notify,
  } = useApp();
  const player = useAudioPlayer();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const [todoInput, setTodoInput] = useState('');
  const [markerLabel, setMarkerLabel] = useState('');
  const [blobCoverUrl, setBlobCoverUrl] = useState<string | null>(null);
  const [songTitleDraft, setSongTitleDraft] = useState('');
  const [lyricsPickerOpen, setLyricsPickerOpen] = useState(false);
  const [lyricsSearch, setLyricsSearch] = useState('');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    setSongTitleDraft(group?.baseTitle || '');
  }, [group?.groupKey, group?.baseTitle]);

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
            group.versions.map((v) => v.track)
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

  const waveformBars = useMemo(() => {
    const id = track?.id || 'kora';
    let seed = id.split('').reduce((a, c) => a + c.charCodeAt(0), 31);
    return Array.from({ length: BAR_COUNT }, (_, idx) => {
      seed = (seed * 9301 + 49297) % 233280;
      const base = 18 + Math.round((seed / 233280) * 82);
      const edge = Math.min(1, Math.min(idx + 3, BAR_COUNT - idx + 2) / 7);
      return Math.max(14, Math.round(base * (0.5 + 0.5 * edge)));
    });
  }, [track?.id]);

  // 60fps Scrolling Tape Waveform refs & state (identical to MiniAudioPlayer!)
  const tapePlayedRef = useRef<HTMLDivElement | null>(null);
  const tapeUnplayedRef = useRef<HTMLDivElement | null>(null);
  const timeTextRef = useRef<HTMLParagraphElement | null>(null);
  const scrubPillTextRef = useRef<HTMLSpanElement | null>(null);
  const scrubbingRef = useRef(false);
  const scrubTimeRef = useRef(0);
  const [scrubbing, setScrubbing] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startTime: number;
    lastTickBar: number;
    moved: boolean;
  } | null>(null);

  const isCurrentTrack = Boolean(track && player.currentTrack?.id === track.id);
  const isPlayingTrack = isCurrentTrack && player.isPlaying;
  const effectiveDurationVal =
    (isCurrentTrack && player.duration > 0 ? player.duration : track?.durationSec) || 0;

  const applyVisualFrame = (t: number, dur: number) => {
    const r = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
    const tx = -r * TOTAL_TAPE_PX;
    const tapeTransform = `translate3d(${tx.toFixed(2)}px, 0, 0)`;
    if (tapePlayedRef.current) tapePlayedRef.current.style.transform = tapeTransform;
    if (tapeUnplayedRef.current) tapeUnplayedRef.current.style.transform = tapeTransform;

    const label = dur > 0 ? `${fmt(t)} / ${fmt(dur)}` : `${fmt(t)} / —`;
    if (timeTextRef.current && timeTextRef.current.textContent !== label) {
      timeTextRef.current.textContent = label;
    }
    if (scrubPillTextRef.current && scrubPillTextRef.current.textContent !== label) {
      scrubPillTextRef.current.textContent = label;
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

  const playedBarsEl = useMemo(
    () =>
      waveformBars.map((h, i) => (
        <div
          key={i}
          style={{ width: `${BAR_STEP_PX}px` }}
          className="h-full flex items-center justify-center shrink-0"
        >
          <div style={{ height: `${h}%` }} className="w-[2px] rounded-full bg-slate-900 dark:bg-white" />
        </div>
      )),
    [waveformBars]
  );

  const unplayedBarsEl = useMemo(
    () =>
      waveformBars.map((h, i) => (
        <div
          key={i}
          style={{ width: `${BAR_STEP_PX}px` }}
          className="h-full flex items-center justify-center shrink-0"
        >
          <div
            style={{ height: `${h}%` }}
            className="w-[2px] rounded-full bg-slate-900/20 dark:bg-white/25"
          />
        </div>
      )),
    [waveformBars]
  );

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
        : { status: 'maquette' as TrackStatus, mood: null as TrackMood | null },
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
  const isCurrentProd = Boolean(group.prodTrack && player.currentTrack?.id === group.prodTrack.id);
  const isPlayingProd = isCurrentProd && player.isPlaying;

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
  const activeContextProject = activeProjectId
    ? state.musicProjects.find(
        (p) =>
          p.id === activeProjectId &&
          (p.trackIds.some((id) => allGroupTrackIds.includes(id)) ||
            (p.benchTrackIds || []).some((id) => allGroupTrackIds.includes(id)))
      ) || null
    : null;
  const targetProject = activeContextProject || linkedProject;
  const projectTrackIdInGroup = targetProject
    ? targetProject.trackIds.find((id) => allGroupTrackIds.includes(id)) ||
      (targetProject.benchTrackIds || []).find((id) => allGroupTrackIds.includes(id)) ||
      null
    : null;
  const projectVersionEntry = projectTrackIdInGroup
    ? group.versions.find((v) => v.track.id === projectTrackIdInGroup) || null
    : null;
  const isProjectPinned = Boolean(
    targetProject && targetProject.pinnedVersionByGroup?.[group.groupKey]
  );

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
        className="max-w-3xl mx-auto tempo-card rounded-3xl text-slate-900 dark:text-zinc-100 overflow-hidden"
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
                <GitBranch size={11} className="text-[#FF5500] shrink-0" />
                {activeEntry.versionLabel}
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

                  {group.prodTrack && group.prodTrack.id !== track.id && (
                    <button
                      type="button"
                      onClick={() =>
                        isCurrentProd
                          ? player.togglePlay()
                          : void player.playTrack(group.prodTrack!, 0, [track, group.prodTrack!])
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                        isPlayingProd
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-emerald-500/14 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/24'
                      }`}
                    >
                      {isPlayingProd ? (
                        <>
                          <Pause size={13} fill="currentColor" /> Pause Prod
                        </>
                      ) : (
                        <>
                          <Music2 size={13} /> Lancer la prod
                        </>
                      )}
                    </button>
                  )}

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
                    onClick={async () => {
                      if (!track.googleDriveFileId && !track.cloudAudioUrl) {
                        notify('Ce son est local uniquement — importe-le depuis Drive pour le partager.');
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
                            ? 'Lien public partagé ✓'
                            : 'Lien public copié ✓ (écoute sans compte)'
                        );
                      } catch (err) {
                        notify(`Partage : ${(err as Error).message}`);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-zinc-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 transition cursor-pointer"
                  >
                    <Share2 size={13} className="text-emerald-500" />
                    Partager
                  </button>
                </div>
              </div>
            </div>

            {/* 60fps Scrolling Tape Waveform (Exact same precision player bar as MiniAudioPlayer!) */}
            <section className="w-full py-1 space-y-2">
              <div className="h-4 flex items-center justify-center">
                <span
                  ref={scrubPillTextRef}
                  className={`rounded-full bg-[#FF5500] text-white px-3 py-0.5 font-mono text-[11px] font-bold tabular-nums transition-opacity duration-100 ${
                    scrubbing ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                />
              </div>

              <div
                onPointerDown={(e) => {
                  const dur = effectiveDuration || 180;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const liveT = isCurrent ? player.getLiveTime() : 0;
                  const startBar = Math.floor((liveT / dur) * BAR_COUNT);
                  dragRef.current = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startTime: liveT,
                    lastTickBar: startBar,
                    moved: false,
                  };
                  scrubTimeRef.current = liveT;
                  scrubbingRef.current = true;
                  setScrubbing(true);
                  applyVisualFrame(liveT, dur);
                  triggerHapticTick(10);
                }}
                onPointerMove={(e) => {
                  const drag = dragRef.current;
                  const dur = effectiveDuration || 180;
                  if (!drag || drag.pointerId !== e.pointerId) return;
                  const dx = drag.startX - e.clientX;
                  if (Math.abs(dx) > 3) drag.moved = true;
                  const deltaSec = (dx / TOTAL_TAPE_PX) * dur;
                  const nextSec = Math.max(0, Math.min(dur, drag.startTime + deltaSec));
                  scrubTimeRef.current = nextSec;
                  applyVisualFrame(nextSec, dur);

                  const barIndex = Math.floor((nextSec / dur) * BAR_COUNT);
                  if (barIndex !== drag.lastTickBar) {
                    drag.lastTickBar = barIndex;
                    triggerHapticTick(24);
                  }
                }}
                onPointerUp={(e) => {
                  const drag = dragRef.current;
                  if (!drag || drag.pointerId !== e.pointerId) return;
                  dragRef.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  const targetSec = scrubTimeRef.current;
                  const wasMoved = drag.moved;
                  scrubbingRef.current = false;
                  setScrubbing(false);
                  if (isCurrent) {
                    if (wasMoved) {
                      player.seek(targetSec);
                      applyVisualFrame(targetSec, effectiveDuration);
                    } else {
                      player.togglePlay();
                    }
                  } else {
                    void player.playTrack(
                      track,
                      wasMoved ? targetSec : 0,
                      group.versions.map((v) => v.track)
                    );
                  }
                  triggerHapticTick(10);
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
                className="relative w-full h-12 overflow-hidden cursor-grab active:cursor-grabbing select-none"
                title="Glisser horizontalement pour naviguer dans le son (ou cliquer pour lancer)"
              >
                <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[var(--surface)] to-transparent z-20" />
                <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--surface)] to-transparent z-20" />

                <div className="pointer-events-none absolute inset-y-0 left-0 right-1/2 overflow-hidden">
                  <div
                    ref={tapePlayedRef}
                    style={{ width: `${TOTAL_TAPE_PX}px` }}
                    className="absolute inset-y-0 left-full flex items-center will-change-transform"
                  >
                    {playedBarsEl}
                  </div>
                </div>

                <div className="pointer-events-none absolute inset-y-0 left-1/2 right-0 overflow-hidden">
                  <div
                    ref={tapeUnplayedRef}
                    style={{ width: `${TOTAL_TAPE_PX}px` }}
                    className="absolute inset-y-0 left-0 flex items-center will-change-transform"
                  >
                    {unplayedBarsEl}
                  </div>
                </div>

                <div className="pointer-events-none absolute left-1/2 top-0.5 bottom-0.5 w-[2px] -translate-x-1/2 rounded-full bg-[#FF5500] z-30" />
              </div>

              <p
                ref={timeTextRef}
                className="text-center font-mono text-xs text-slate-500 dark:text-zinc-400 tabular-nums min-h-[1rem]"
              >
                {`${isCurrent ? fmt(player.currentTime) : '0:00'} / ${
                  effectiveDuration > 0 ? fmt(effectiveDuration) : '—'
                }`}
              </p>

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
                          void player.playTrack(
                            track,
                            mk.timeSec,
                            group.versions.map((v) => v.track)
                          );
                        }
                        triggerHapticTick(10);
                      }}
                      className="rounded-full bg-slate-900/8 dark:bg-white/10 hover:bg-slate-900/14 dark:hover:bg-white/20 px-2.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-zinc-200 transition cursor-pointer"
                    >
                      {fmt(mk.timeSec)} · {mk.label}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* 5-Stage Strict Sequential Production Pipeline + Mood Tag */}
            <section className="rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/60 dark:bg-zinc-900/40 px-4 py-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Pipeline · Étape {TRACK_STATUS_META[workflow.status].step}/5
                  </span>
                  <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                    {TRACK_STATUS_META[workflow.status].label}{' '}
                    <span className="font-normal text-slate-400">
                      — {TRACK_STATUS_META[workflow.status].hint}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={currentStepIdx <= 0}
                    onClick={() => {
                      const prevSt = TRACK_PIPELINE_ORDER[currentStepIdx - 1];
                      if (!prevSt) return;
                      setTrackGroupWorkflow(allGroupTrackIds, { status: prevSt });
                      notify(`Étape : ${TRACK_STATUS_META[prevSt].label}`);
                    }}
                    className="rounded-lg border border-slate-200 dark:border-zinc-800 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-30 transition cursor-pointer"
                  >
                    ← Préc.
                  </button>
                  <button
                    type="button"
                    disabled={currentStepIdx >= TRACK_PIPELINE_ORDER.length - 1}
                    onClick={() => {
                      const nextSt = TRACK_PIPELINE_ORDER[currentStepIdx + 1];
                      if (!nextSt) return;
                      if (nextSt === 'rec-final' && fixTagCount > 0) {
                        notify(
                          `Attention : encore ${fixTagCount} balise${fixTagCount > 1 ? 's' : ''} [FIX] dans les paroles`
                        );
                      }
                      setTrackGroupWorkflow(allGroupTrackIds, { status: nextSt });
                      if (!(nextSt === 'rec-final' && fixTagCount > 0)) {
                        notify(`Étape : ${TRACK_STATUS_META[nextSt].label} ✓`);
                      }
                    }}
                    className="rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-2.5 py-1 text-[11px] font-semibold hover:opacity-90 disabled:opacity-30 transition cursor-pointer"
                  >
                    Suiv. →
                  </button>
                </div>
              </div>

              {/* Strict 6-Stage Progress Track (v0 Brouillon -> v4 Masterisé, adjacent steps clickable) */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                {TRACK_PIPELINE_ORDER.map((st, idx) => {
                  const meta = TRACK_STATUS_META[st];
                  const active = idx === currentStepIdx;
                  const done = idx < currentStepIdx;
                  const canJump = Math.abs(idx - currentStepIdx) <= 1;
                  return (
                    <button
                      key={st}
                      type="button"
                      disabled={!canJump}
                      onClick={() => {
                        if (!canJump || active) return;
                        if (st === 'rec-final' && fixTagCount > 0) {
                          notify(
                            `Attention : encore ${fixTagCount} balise${fixTagCount > 1 ? 's' : ''} [FIX] dans les paroles`
                          );
                        }
                        setTrackGroupWorkflow(allGroupTrackIds, { status: st });
                      }}
                      title={
                        canJump
                          ? `${meta.step}. ${meta.label} — ${meta.hint}`
                          : `Avance étape par étape vers ${meta.label}`
                      }
                      className={`rounded-xl px-1.5 py-1.5 text-center transition ${
                        active
                          ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold'
                          : done
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-medium'
                          : 'bg-white dark:bg-zinc-900/90 border border-slate-200/70 dark:border-zinc-800 text-slate-400'
                      } ${canJump && !active ? 'cursor-pointer hover:border-slate-400' : 'cursor-default opacity-75'}`}
                    >
                      <span className="block font-mono text-[9px] opacity-65">{meta.step}</span>
                      <span className="block text-[10px] truncate">{meta.shortLabel}</span>
                    </button>
                  );
                })}
              </div>

              {/* Mood Tag Selector */}
              <div className="pt-2 border-t border-slate-200/60 dark:border-zinc-800/70 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                  Ambiance (pour Sprints)
                </span>
                <div className="flex items-center gap-1.5">
                  {(['energetic', 'chill', 'experimental'] as TrackMood[]).map((m) => {
                    const meta = TRACK_MOOD_META[m];
                    const active = workflow.mood === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() =>
                          setTrackGroupWorkflow(allGroupTrackIds, { mood: active ? null : m })
                        }
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                          active
                            ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                            : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:border-slate-400'
                        }`}
                      >
                        {meta.emoji} {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Minimalist Dual Ratings (Note actuelle + Potentiel /10) */}
            <section className="rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50/60 dark:bg-zinc-900/40 px-4 py-3.5 space-y-3">
              {/* Row 1: Note actuelle */}
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
                            ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                            : filled
                            ? 'bg-slate-200/90 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200'
                            : 'bg-white dark:bg-zinc-900/90 border border-slate-200/70 dark:border-zinc-800 text-slate-400 hover:text-slate-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Row 2: Potentiel */}
              <div className="space-y-1.5 pt-2 border-t border-slate-200/60 dark:border-zinc-800/70">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-300">
                    <TrendingUp size={12} className="text-[#FF5500]" />
                    Potentiel
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-[#FF5500]">
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
                            ? 'bg-[#FF5500] text-white'
                            : filled
                            ? 'bg-[#FF5500]/15 text-orange-700 dark:text-orange-300'
                            : 'bg-white dark:bg-zinc-900/90 border border-slate-200/70 dark:border-zinc-800 text-slate-400 hover:text-[#FF5500]'
                        }`}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

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
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90 px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer"
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

              {targetProject && projectVersionEntry && group.hasMultipleVersions && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 px-3 py-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <FolderKanban size={12} className="text-slate-500 dark:text-zinc-400 shrink-0" />
                    <span className="text-slate-500 dark:text-zinc-400">
                      Dans <strong className="text-slate-800 dark:text-zinc-100">{targetProject.title}</strong> :
                    </span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-zinc-100">
                      {projectVersionEntry.versionLabel}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                        isProjectPinned
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {isProjectPinned ? 'Fixée' : 'Auto · dernière'}
                    </span>
                  </div>

                  {track.id !== projectTrackIdInGroup ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProjectTrackVersion(
                          targetProject.id,
                          group.groupKey,
                          track.id,
                          activeEntry.isLatest ? 'auto' : 'pin'
                        );
                        notify(
                          activeEntry.isLatest
                            ? `Version ${activeEntry.versionLabel} (auto) activée pour « ${targetProject.title} » ✓`
                            : `Version ${activeEntry.versionLabel} fixée pour « ${targetProject.title} » ✓`
                        );
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-2.5 py-1 text-[11px] font-semibold hover:opacity-90 transition cursor-pointer shrink-0"
                    >
                      <Check size={11} />
                      Utiliser {activeEntry.versionLabel} dans le projet
                    </button>
                  ) : isProjectPinned && !projectVersionEntry.isLatest ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProjectTrackVersion(
                          targetProject.id,
                          group.groupKey,
                          group.latestTrack.id,
                          'auto'
                        );
                        onSelectVersion(group.latestTrack.id);
                        notify(
                          `Version ${group.latestVersionLabel} (auto) activée pour « ${targetProject.title} » ✓`
                        );
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-200/80 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-700 px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer shrink-0"
                    >
                      Passer en auto ({group.latestVersionLabel})
                    </button>
                  ) : null}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {group.versions.map((v) => {
                  const selected = v.track.id === track.id;
                  const isUsedInProject = Boolean(
                    targetProject && projectTrackIdInGroup === v.track.id
                  );
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
                        {(v.track.modifiedAt || v.track.addedAt) && (
                          <span
                            className={`font-mono text-[10px] ${
                              selected ? 'opacity-70' : 'text-slate-400 dark:text-zinc-500'
                            }`}
                          >
                            {fmtDate(v.track.modifiedAt || v.track.addedAt)}
                          </span>
                        )}
                        {v.isLatest && (
                          <span
                            className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                              selected
                                ? 'bg-white/20 text-white dark:bg-black/15 dark:text-zinc-950'
                                : 'bg-slate-200/80 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300'
                            }`}
                          >
                            Actuelle
                          </span>
                        )}
                        {isUsedInProject && (
                          <span
                            title={`Version active dans « ${targetProject?.title} »`}
                            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              selected
                                ? 'bg-emerald-400/25 text-emerald-200 dark:bg-emerald-600/20 dark:text-emerald-800'
                                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            Projet
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
                  <ListChecks size={14} className="text-slate-500 dark:text-zinc-400" />
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
                  <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-zinc-300">
                    {todoPct}%
                  </span>
                )}
              </div>

              {todos.length > 0 && (
                <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-zinc-800 overflow-hidden">
                  <div
                    style={{ width: `${todoPct}%` }}
                    className="h-full rounded-full bg-slate-900 dark:bg-zinc-100 transition-all duration-300"
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
                  className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-xs outline-none focus:border-slate-400 dark:focus:border-zinc-600"
                />
                <button
                  type="submit"
                  className="h-8 px-3 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={13} /> Ajouter
                </button>
              </form>
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
                      className="inline-flex items-center gap-1 hover:text-[#FF5500] cursor-pointer"
                    >
                      <Tag size={10} className="text-[#FF5500]" />
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
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-2 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
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
                            ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
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
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold'
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
                          ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold'
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
      </motion.div>
    </AnimatePresence>
  );
}
