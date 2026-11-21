import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  Disc3,
  ListMusic,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Star,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { getMediaObjectUrl } from '../../lib/mediaDb';
import { triggerHapticTick } from '../../lib/haptics';
import { shareOrCopyPublicLink } from '../../lib/publicShare';
import { groupMusicTracks, parseTrackVersion } from '../../lib/musicVersioning';
import { findLinkedProjectForTrack, resolveEffectiveTrackCover } from '../../lib/trackCover';

export const PROJECT_GRADIENTS: { id: string; label: string; css: string }[] = [
  { id: 'pink', label: 'Untitled Pink', css: 'from-pink-300 via-fuchsia-400 to-fuchsia-600' },
  { id: 'violet', label: 'Violet Dusk', css: 'from-violet-400 via-purple-600 to-indigo-900' },
  { id: 'emerald', label: 'Emerald', css: 'from-emerald-300 via-teal-500 to-emerald-900' },
  { id: 'amber', label: 'Sunset', css: 'from-amber-300 via-orange-500 to-rose-600' },
  { id: 'sky', label: 'Ocean', css: 'from-sky-300 via-blue-500 to-indigo-800' },
  { id: 'midnight', label: 'Obsidian', css: 'from-zinc-700 via-zinc-900 to-black' },
];

export function getGradientClass(id?: string): string {
  return PROJECT_GRADIENTS.find((g) => g.id === id)?.css || PROJECT_GRADIENTS[0].css;
}

function fmt(sec: number) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const BAR_COUNT = 110;
const BAR_STEP_PX = 4.5; // crisp dense [untitled] tape bars
const TOTAL_TAPE_PX = BAR_COUNT * BAR_STEP_PX;

const MINI_BAR_COUNT = 44;
const MINI_BAR_STEP_PX = 3.5;
const MINI_TAPE_PX = MINI_BAR_COUNT * MINI_BAR_STEP_PX;

export function MiniAudioPlayer() {
  const { state, setTrackGroupFavorite, notify } = useApp();
  const {
    currentTrack,
    queue,
    isPlaying,
    currentTime,
    duration,
    repeatMode,
    shuffle,
    expanded,
    hasNext,
    hasPrev,
    getLiveTime,
    playTrack,
    playNext,
    playPrev,
    togglePlay,
    seek,
    cycleRepeatMode,
    toggleShuffle,
    setExpanded,
    closePlayer,
    hasFullscreenOverlay,
  } = useAudioPlayer();

  const [blobCoverUrl, setBlobCoverUrl] = useState<string | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  // Direct GPU DOM refs updated via 60/120fps requestAnimationFrame (ZERO React re-renders per frame!)
  const discRef = useRef<HTMLDivElement>(null);
  const miniDiscRef = useRef<HTMLDivElement>(null);
  const tapePlayedRef = useRef<HTMLDivElement>(null);
  const tapeUnplayedRef = useRef<HTMLDivElement>(null);
  const miniTapePlayedRef = useRef<HTMLDivElement>(null);
  const miniTapeUnplayedRef = useRef<HTMLDivElement>(null);
  const timeTextRef = useRef<HTMLParagraphElement>(null);
  const scrubPillTextRef = useRef<HTMLSpanElement>(null);

  const scrubTimeRef = useRef(0);
  const scrubbingRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startTime: number;
    lastTickBar: number;
  } | null>(null);

  const currentGroup = useMemo(() => {
    if (!currentTrack) return null;
    const allGroups = groupMusicTracks(state.musicTracks);
    return allGroups.find((g) => g.allTrackIds.includes(currentTrack.id)) || null;
  }, [currentTrack?.id, state.musicTracks]);

  const siblingTracks = useMemo(
    () => (currentGroup ? currentGroup.versions.map((v) => v.track) : undefined),
    [currentGroup]
  );

  const linkedProject = useMemo(
    () =>
      currentTrack
        ? findLinkedProjectForTrack(currentTrack, state.musicProjects, siblingTracks)
        : null,
    [currentTrack, state.musicProjects, siblingTracks]
  );

  const effectiveCover = useMemo(
    () =>
      currentTrack
        ? resolveEffectiveTrackCover(
            currentTrack,
            state.musicProjects,
            currentGroup?.groupKey,
            siblingTracks
          )
        : null,
    [currentTrack, state.musicProjects, currentGroup?.groupKey, siblingTracks]
  );

  useEffect(() => {
    let active = true;
    if (effectiveCover && !effectiveCover.coverDataUrl && effectiveCover.coverMediaId) {
      getMediaObjectUrl(effectiveCover.coverMediaId).then((url) => {
        if (active) setBlobCoverUrl(url);
      });
    } else {
      setBlobCoverUrl(null);
    }
    return () => {
      active = false;
    };
  }, [effectiveCover?.coverDataUrl, effectiveCover?.coverMediaId]);

  const coverUrl =
    effectiveCover?.coverDataUrl || blobCoverUrl || effectiveCover?.cloudCoverUrl || null;

  // Deterministic waveform bars (memoized once per track)
  const bars = useMemo(() => {
    if (!currentTrack) return [];
    let seed = currentTrack.id.split('').reduce((a, c) => a + c.charCodeAt(0), 31);
    return Array.from({ length: BAR_COUNT }, (_, idx) => {
      seed = (seed * 9301 + 49297) % 233280;
      const base = 18 + Math.round((seed / 233280) * 82);
      const edge = Math.min(1, Math.min(idx + 3, BAR_COUNT - idx + 2) / 7);
      return Math.max(14, Math.round(base * (0.5 + 0.5 * edge)));
    });
  }, [currentTrack?.id]);

  const miniBars = useMemo(() => {
    if (bars.length === 0) return [];
    return Array.from({ length: MINI_BAR_COUNT }, (_, i) => {
      const srcIdx = Math.min(bars.length - 1, Math.floor((i / MINI_BAR_COUNT) * bars.length));
      return bars[srcIdx];
    });
  }, [bars]);

  const effectiveDuration = duration || currentTrack?.durationSec || 0;

  // Helper that paints exact GPU transforms & clock text directly to the DOM at 60/120fps
  const applyVisualFrame = (t: number, dur: number) => {
    const r = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
    const tx = -r * TOTAL_TAPE_PX;
    const miniTx = -r * MINI_TAPE_PX;
    const rot = t * 24; // smooth 24 deg/s vinyl spin synced directly to audio time

    const tapeTransform = `translate3d(${tx.toFixed(2)}px, 0, 0)`;
    if (tapePlayedRef.current) tapePlayedRef.current.style.transform = tapeTransform;
    if (tapeUnplayedRef.current) tapeUnplayedRef.current.style.transform = tapeTransform;

    const miniTransform = `translate3d(${miniTx.toFixed(2)}px, 0, 0)`;
    if (miniTapePlayedRef.current) miniTapePlayedRef.current.style.transform = miniTransform;
    if (miniTapeUnplayedRef.current) miniTapeUnplayedRef.current.style.transform = miniTransform;

    const discTransform = `rotate3d(0, 0, 1, ${rot.toFixed(2)}deg)`;
    if (discRef.current) discRef.current.style.transform = discTransform;
    if (miniDiscRef.current) miniDiscRef.current.style.transform = discTransform;

    const label = `${fmt(t)} / ${fmt(dur)}`;
    if (timeTextRef.current && timeTextRef.current.textContent !== label) {
      timeTextRef.current.textContent = label;
    }
    if (scrubPillTextRef.current && scrubPillTextRef.current.textContent !== label) {
      scrubPillTextRef.current.textContent = label;
    }
  };

  // Sync visual frame synchronously before paint on mount / track change / expand / pause (never fights rAF!)
  useLayoutEffect(() => {
    if (!currentTrack) return;
    applyVisualFrame(scrubbingRef.current ? scrubTimeRef.current : getLiveTime(), effectiveDuration);
  }, [currentTrack?.id, expanded, effectiveDuration, isPlaying, getLiveTime]);

  // Smooth 60/120fps requestAnimationFrame loop while playing!
  useEffect(() => {
    if (!currentTrack || !isPlaying) return;
    let rafId = 0;
    const tick = () => {
      if (!scrubbingRef.current) {
        applyVisualFrame(getLiveTime(), effectiveDuration);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [currentTrack?.id, isPlaying, expanded, effectiveDuration, getLiveTime]);

  const gradCls = getGradientClass(currentTrack?.coverGradient || linkedProject?.coverGradient);
  const parsedCurrent = useMemo(
    () => (currentTrack ? parseTrackVersion(currentTrack) : null),
    [currentTrack]
  );

  // Find sibling Prod / Song track so user can switch Son <-> Prod in 1 tap right inside the player!
  const alternateProdOrSong = useMemo(() => {
    if (!currentTrack || !parsedCurrent) return null;
    const allGroups = groupMusicTracks(state.musicTracks);
    const grp = allGroups.find((g) => g.allTrackIds.includes(currentTrack.id));
    if (!grp || !grp.prodTrack) return null;
    if (parsedCurrent.isProd) {
      if (grp.latestTrack.id === currentTrack.id) return null;
      return { target: grp.latestTrack, label: 'Son', isCurrentlyProd: true };
    }
    return { target: grp.prodTrack, label: 'Prod', isCurrentlyProd: false };
  }, [currentTrack, parsedCurrent, state.musicTracks]);
  const displayTrackTitle =
    currentTrack?.manualGroupTitle || parsedCurrent?.baseTitle || currentTrack?.title || '';
  const versionSuffix =
    parsedCurrent && parsedCurrent.versionLabel !== 'Original' ? parsedCurrent.versionLabel : '';
  const subtitle = [
    versionSuffix,
    linkedProject?.title,
    currentTrack?.artist || state.preferences.name || 'Moi',
  ]
    .filter(Boolean)
    .join(' · ');
  const canPlay = Boolean(
    currentTrack?.mediaId || currentTrack?.cloudAudioUrl || currentTrack?.googleDriveFileId
  );

  // Zero-lag GPU drag scrubbing with haptic ticks!
  const handleTapePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!effectiveDuration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const liveT = getLiveTime();
    const startBar = Math.floor((liveT / effectiveDuration) * BAR_COUNT);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startTime: liveT,
      lastTickBar: startBar,
    };
    scrubTimeRef.current = liveT;
    scrubbingRef.current = true;
    setScrubbing(true);
    applyVisualFrame(liveT, effectiveDuration);
    triggerHapticTick(10);
  };

  const handleTapePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !effectiveDuration) return;
    const dx = drag.startX - e.clientX;
    const deltaSec = (dx / TOTAL_TAPE_PX) * effectiveDuration;
    const nextSec = Math.max(0, Math.min(effectiveDuration, drag.startTime + deltaSec));
    scrubTimeRef.current = nextSec;
    applyVisualFrame(nextSec, effectiveDuration);

    const barIndex = Math.floor((nextSec / effectiveDuration) * BAR_COUNT);
    if (barIndex !== drag.lastTickBar) {
      drag.lastTickBar = barIndex;
      triggerHapticTick(24);
    }
  };

  const finishTapeDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const targetSec = scrubTimeRef.current;
    scrubbingRef.current = false;
    setScrubbing(false);
    seek(targetSec);
    applyVisualFrame(targetSec, effectiveDuration);
    triggerHapticTick(10);
  };

  // Pre-rendered static bar rows (never re-rendered on playback frames!)
  const playedBarsEl = useMemo(
    () =>
      bars.map((h, i) => (
        <div
          key={i}
          style={{ width: `${BAR_STEP_PX}px` }}
          className="h-full flex items-center justify-center shrink-0"
        >
          <div style={{ height: `${h}%` }} className="w-[2px] rounded-full bg-white" />
        </div>
      )),
    [bars]
  );

  const unplayedBarsEl = useMemo(
    () =>
      bars.map((h, i) => (
        <div
          key={i}
          style={{ width: `${BAR_STEP_PX}px` }}
          className="h-full flex items-center justify-center shrink-0"
        >
          <div style={{ height: `${h}%` }} className="w-[2px] rounded-full bg-white/25" />
        </div>
      )),
    [bars]
  );

  const miniPlayedBarsEl = useMemo(
    () =>
      miniBars.map((h, i) => (
        <div
          key={i}
          style={{ width: `${MINI_BAR_STEP_PX}px` }}
          className="h-full flex items-center justify-center shrink-0"
        >
          <div style={{ height: `${h}%` }} className="w-[1.8px] rounded-full bg-white/95" />
        </div>
      )),
    [miniBars]
  );

  const miniUnplayedBarsEl = useMemo(
    () =>
      miniBars.map((h, i) => (
        <div
          key={i}
          style={{ width: `${MINI_BAR_STEP_PX}px` }}
          className="h-full flex items-center justify-center shrink-0"
        >
          <div style={{ height: `${h}%` }} className="w-[1.8px] rounded-full bg-white/25" />
        </div>
      )),
    [miniBars]
  );

  return (
    <>
      {/* ================= FLOATING [UNTITLED]-STYLE MINI PLAYER ================= */}
      <AnimatePresence>
        {currentTrack && !expanded && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed ${
              hasFullscreenOverlay
                ? 'bottom-[max(0.75rem,env(safe-area-inset-bottom))]'
                : 'bottom-[calc(4.15rem+env(safe-area-inset-bottom))]'
            } md:bottom-4 left-2.5 right-2.5 md:left-64 md:right-6 z-50 max-w-2xl md:mx-auto rounded-full bg-[#141418]/96 text-white border border-white/10 shadow-[0_14px_38px_-8px_rgba(0,0,0,0.6)] backdrop-blur-xl px-2 py-1.5 transition-[bottom] duration-200 ease-out`}
          >
            <div className="flex items-center justify-between gap-2">
              {/* Clickable Circular Cover Art + Title -> Expands to [untitled] Player */}
              <button
                type="button"
                onClick={() => {
                  setShowQueue(false);
                  setExpanded(true);
                }}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left group cursor-pointer"
                title="Cliquer pour agrandir le lecteur"
              >
                <div
                  ref={miniDiscRef}
                  className="relative h-10 w-10 rounded-full overflow-hidden border border-white/15 shrink-0 will-change-transform"
                >
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={currentTrack.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      className={`h-full w-full bg-gradient-to-br ${gradCls} flex items-center justify-center`}
                    >
                      <Disc3 size={15} className="text-white/90" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate leading-tight">
                    {displayTrackTitle}
                  </p>
                  <p className="text-[10px] text-zinc-400 truncate mt-0.5">{subtitle}</p>
                </div>
              </button>

              {/* Smooth 60fps Mini Tape Preview (center-right on sm+) */}
              <div
                onClick={() => setExpanded(true)}
                className="hidden sm:block relative w-24 h-7 overflow-hidden cursor-pointer shrink-0"
              >
                <div className="pointer-events-none absolute inset-y-0 left-0 right-1/2 overflow-hidden">
                  <div
                    ref={miniTapePlayedRef}
                    style={{ width: `${MINI_TAPE_PX}px` }}
                    className="absolute inset-y-0 left-full flex items-center will-change-transform"
                  >
                    {miniPlayedBarsEl}
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-y-0 left-1/2 right-0 overflow-hidden">
                  <div
                    ref={miniTapeUnplayedRef}
                    style={{ width: `${MINI_TAPE_PX}px` }}
                    className="absolute inset-y-0 left-0 flex items-center will-change-transform"
                  >
                    {miniUnplayedBarsEl}
                  </div>
                </div>
                <div className="pointer-events-none absolute left-1/2 top-0.5 bottom-0.5 w-[2px] -translate-x-1/2 rounded-full bg-amber-300" />
              </div>

              {/* Compact Transport Controls (Prev / Play-Pause / Next / Close) */}
              <div className="flex items-center gap-0.5 shrink-0 pr-0.5">
                <button
                  type="button"
                  onClick={playPrev}
                  disabled={!hasPrev && currentTime <= 3}
                  aria-label="Précédent"
                  className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-30 transition cursor-pointer"
                >
                  <SkipBack size={14} fill="currentColor" />
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!canPlay}
                  aria-label={isPlaying ? 'Pause' : 'Lecture'}
                  className="h-9 w-9 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-35 transition cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause size={15} fill="currentColor" />
                  ) : (
                    <Play size={15} fill="currentColor" className="ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={playNext}
                  disabled={!hasNext}
                  aria-label="Suivant"
                  className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-30 transition cursor-pointer"
                >
                  <SkipForward size={14} fill="currentColor" />
                </button>

                <button
                  type="button"
                  onClick={closePlayer}
                  aria-label="Fermer le lecteur"
                  className="h-7 w-7 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================= EXPANDED 60/120FPS [UNTITLED]-STYLE TAPE PLAYER ================= */}
      <AnimatePresence>
        {currentTrack && expanded && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={() => setExpanded(false)}
              className="fixed inset-0 bg-neutral-950/82 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ type: 'spring', stiffness: 440, damping: 36, mass: 0.8 }}
              className="relative z-10 w-full max-w-[356px] flex flex-col items-center gap-4"
            >
              {/* Main Obsidian Card */}
              <div className="w-full rounded-[32px] bg-[#0b0b0d] text-white border border-white/10 shadow-2xl px-6 pt-6 pb-6 flex flex-col items-center space-y-5">
                {/* Title & Subtitle (+ 1-Tap Son/Prod Switcher when linked prod exists!) */}
                <div className="w-full text-center space-y-1 px-2">
                  <h2 className="text-[15px] font-semibold tracking-tight text-white truncate">
                    {displayTrackTitle}
                  </h2>
                  <p className="text-xs text-zinc-400 truncate">{subtitle}</p>
                  {alternateProdOrSong && (
                    <div className="pt-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          void playTrack(alternateProdOrSong.target, 0, queue);
                          triggerHapticTick(10);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition cursor-pointer ${
                          alternateProdOrSong.isCurrentlyProd
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 hover:bg-emerald-500/30'
                            : 'bg-white/10 text-zinc-200 border border-white/15 hover:bg-white/20'
                        }`}
                      >
                        <Music2 size={11} />
                        {alternateProdOrSong.isCurrentlyProd
                          ? 'Prod en cours · Passer au son'
                          : 'Écouter la prod'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Large Spinning Vinyl Disc (60/120fps direct GPU transform) */}
                <div className="py-1">
                  <div
                    ref={discRef}
                    className={`h-52 w-52 sm:h-56 sm:w-56 rounded-full overflow-hidden border border-white/15 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] will-change-transform ${
                      coverUrl ? '' : `bg-gradient-to-br ${gradCls}`
                    }`}
                  >
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={currentTrack.title}
                        draggable={false}
                        className="h-full w-full object-cover select-none pointer-events-none"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <div className="h-12 w-12 rounded-full bg-black/25 border border-white/20" />
                      </div>
                    )}
                  </div>
                </div>

                {/* 60/120fps Dual-Clip Scrolling Tape-Reel Waveform + Fixed Center Yellow Needle */}
                <div className="w-full space-y-2.5">
                  {/* Floating Time Pill (pure DOM text updates — zero flicker while scrubbing) */}
                  <div className="h-6 flex items-center justify-center">
                    <span
                      ref={scrubPillTextRef}
                      className={`rounded-full bg-amber-300 text-zinc-950 px-3 py-0.5 font-mono text-[11px] font-bold tabular-nums transition-opacity duration-100 ${
                        scrubbing ? 'opacity-100' : 'opacity-0 pointer-events-none'
                      }`}
                    />
                  </div>

                  {/* Interactive Horizontal Tape Reel (Zero-Offset Split Halves, Native GPU Compositing) */}
                  <div
                    onPointerDown={handleTapePointerDown}
                    onPointerMove={handleTapePointerMove}
                    onPointerUp={finishTapeDrag}
                    onPointerCancel={finishTapeDrag}
                    style={{ touchAction: 'none' }}
                    className="relative w-full h-12 overflow-hidden cursor-grab active:cursor-grabbing select-none"
                    title="Glisser horizontalement pour naviguer dans le son"
                  >
                    {/* Edge fade masks */}
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-[#0b0b0d] to-transparent z-20" />
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-[#0b0b0d] to-transparent z-20" />

                    {/* Left Half (Played = Crisp White, ends pixel-exact at 50% center) */}
                    <div className="pointer-events-none absolute inset-y-0 left-0 right-1/2 overflow-hidden">
                      <div
                        ref={tapePlayedRef}
                        style={{ width: `${TOTAL_TAPE_PX}px` }}
                        className="absolute inset-y-0 left-full flex items-center will-change-transform"
                      >
                        {playedBarsEl}
                      </div>
                    </div>

                    {/* Right Half (Unplayed = Muted Gray, starts pixel-exact at 50% center) */}
                    <div className="pointer-events-none absolute inset-y-0 left-1/2 right-0 overflow-hidden">
                      <div
                        ref={tapeUnplayedRef}
                        style={{ width: `${TOTAL_TAPE_PX}px` }}
                        className="absolute inset-y-0 left-0 flex items-center will-change-transform"
                      >
                        {unplayedBarsEl}
                      </div>
                    </div>

                    {/* Fixed Center Playhead Needle (crisp, zero glow) */}
                    <div className="pointer-events-none absolute left-1/2 top-0.5 bottom-0.5 w-[2px] -translate-x-1/2 rounded-full bg-amber-300 z-30" />
                  </div>

                  {/* Time Readout below tape (pure DOM updated at 60/120fps) */}
                  <p
                    ref={timeTextRef}
                    className="text-center font-mono text-xs text-zinc-400 tabular-nums min-h-[1rem]"
                  />

                  {/* Timestamped Markers (if any) */}
                  {currentTrack.markers.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {currentTrack.markers.map((mk) => (
                        <button
                          key={mk.id}
                          type="button"
                          onClick={() => {
                            seek(mk.timeSec);
                            applyVisualFrame(mk.timeSec, effectiveDuration);
                            triggerHapticTick(10);
                          }}
                          className="rounded-full bg-white/10 hover:bg-white/20 px-2.5 py-0.5 font-mono text-[10px] text-zinc-200 transition cursor-pointer"
                        >
                          {fmt(mk.timeSec)} · {mk.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Transport Row (Shuffle · Prev · Play/Pause · Next · Repeat Off/All/1) */}
                <div className="w-full flex items-center justify-between px-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      toggleShuffle();
                      triggerHapticTick(10);
                    }}
                    title={shuffle ? 'Aléatoire activé' : 'Activer la lecture aléatoire'}
                    aria-label="Aléatoire"
                    className={`relative h-10 w-10 rounded-full flex items-center justify-center transition cursor-pointer ${
                      shuffle
                        ? 'bg-white/15 text-amber-300'
                        : 'text-zinc-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Shuffle size={16} />
                    {shuffle && (
                      <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-amber-300" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      playPrev();
                      triggerHapticTick(10);
                    }}
                    disabled={!hasPrev && currentTime <= 3}
                    aria-label="Précédent"
                    className="h-11 w-11 rounded-full flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-30 transition cursor-pointer"
                  >
                    <SkipBack size={20} fill="currentColor" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      togglePlay();
                      triggerHapticTick(10);
                    }}
                    disabled={!canPlay}
                    aria-label={isPlaying ? 'Pause' : 'Lecture'}
                    className="h-14 w-14 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-35 transition shadow-lg cursor-pointer"
                  >
                    {isPlaying ? (
                      <Pause size={24} fill="currentColor" />
                    ) : (
                      <Play size={24} fill="currentColor" className="ml-1" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      playNext();
                      triggerHapticTick(10);
                    }}
                    disabled={!hasNext}
                    aria-label="Suivant"
                    className="h-11 w-11 rounded-full flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-30 transition cursor-pointer"
                  >
                    <SkipForward size={20} fill="currentColor" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      cycleRepeatMode();
                      triggerHapticTick(10);
                    }}
                    title={
                      repeatMode === 'off'
                        ? 'Pas de boucle (cliquer pour boucler la file / le projet)'
                        : repeatMode === 'all'
                        ? 'Boucle file / projet (cliquer pour boucler 1 morceau)'
                        : 'Boucle 1 morceau (cliquer pour désactiver)'
                    }
                    aria-label="Mode boucle"
                    className={`relative h-10 w-10 rounded-full flex items-center justify-center transition cursor-pointer ${
                      repeatMode !== 'off'
                        ? 'bg-white/15 text-amber-300'
                        : 'text-zinc-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
                    {repeatMode !== 'off' && (
                      <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-amber-300" />
                    )}
                  </button>
                </div>

                {/* Collapsible Queue Drawer inside Card */}
                <AnimatePresence>
                  {showQueue && queue.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="w-full border-t border-white/10 pt-3 overflow-hidden"
                    >
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-2">
                        File d’attente ({queue.length})
                      </p>
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                        {queue.map((t, i) => {
                          const active = t.id === currentTrack.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                void playTrack(t, 0, queue);
                                triggerHapticTick(10);
                              }}
                              className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left transition cursor-pointer ${
                                active
                                  ? 'bg-white/14 text-white'
                                  : 'text-zinc-400 hover:bg-white/8 hover:text-zinc-200'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-[10px] opacity-60 w-4">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                                <span className="text-xs font-medium truncate">
                                  {t.manualGroupTitle || t.title}
                                </span>
                              </span>
                              {t.durationSec ? (
                                <span className="font-mono text-[10px] opacity-60 shrink-0">
                                  {fmt(t.durationSec)}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Bottom Floating Pill Dock ([untitled] style!) */}
              <div className="w-full flex items-center justify-between px-1">
                <div className="inline-flex items-center gap-1 rounded-full bg-white/14 backdrop-blur-xl border border-white/15 p-1">
                  <button
                    type="button"
                    onClick={() => setShowQueue((v) => !v)}
                    className={`h-9 px-3.5 rounded-full inline-flex items-center gap-1.5 text-xs font-medium transition cursor-pointer ${
                      showQueue ? 'bg-white text-zinc-950' : 'text-white hover:bg-white/12'
                    }`}
                  >
                    <ListMusic size={15} />
                    <span>{queue.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const ids =
                        currentGroup && currentGroup.allTrackIds.length > 0
                          ? currentGroup.allTrackIds
                          : [currentTrack.id];
                      const nextFav = !(currentGroup?.isFavorite ?? Boolean(currentTrack.isFavorite));
                      setTrackGroupFavorite(ids, nextFav);
                      triggerHapticTick(10);
                      notify(nextFav ? 'Ajouté aux favoris ★' : 'Retiré des favoris');
                    }}
                    title={
                      (currentGroup?.isFavorite ?? Boolean(currentTrack.isFavorite))
                        ? 'Retirer des favoris'
                        : 'Ajouter aux favoris'
                    }
                    aria-label="Favori"
                    className={`h-9 w-9 rounded-full inline-flex items-center justify-center transition cursor-pointer ${
                      (currentGroup?.isFavorite ?? Boolean(currentTrack.isFavorite))
                        ? 'text-amber-400 bg-amber-400/15'
                        : 'text-white/85 hover:text-white hover:bg-white/12'
                    }`}
                  >
                    <Star
                      size={15}
                      fill={
                        (currentGroup?.isFavorite ?? Boolean(currentTrack.isFavorite))
                          ? 'currentColor'
                          : 'none'
                      }
                    />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!currentTrack.googleDriveFileId && !currentTrack.cloudAudioUrl) {
                        notify('Ce son est uniquement local — synchronise-le via Drive pour le partager.');
                        return;
                      }
                      try {
                        const res = await shareOrCopyPublicLink({
                          kind: 'track',
                          id: currentTrack.id,
                          title: currentTrack.title,
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
                    title="Partager ce son (lien public sans compte)"
                    className="h-9 w-9 rounded-full inline-flex items-center justify-center text-white/85 hover:text-white hover:bg-white/12 transition cursor-pointer"
                  >
                    <Share2 size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={closePlayer}
                    title="Arrêter et fermer"
                    className="h-9 w-9 rounded-full inline-flex items-center justify-center text-white/80 hover:text-white hover:bg-white/12 transition cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="h-11 px-5 rounded-full bg-white text-zinc-950 text-xs font-semibold inline-flex items-center gap-1.5 shadow-lg hover:opacity-92 transition cursor-pointer"
                >
                  <ChevronDown size={15} /> Réduire
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
