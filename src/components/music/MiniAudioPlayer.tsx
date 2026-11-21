import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  Disc3,
  ListMusic,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { getMediaObjectUrl } from '../../lib/mediaDb';
import { triggerHapticTick } from '../../lib/haptics';

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

const BAR_COUNT = 96;
const BAR_STEP_PX = 5.5; // bar width + gap = crisp dense [untitled] waveform tape
const TOTAL_TAPE_PX = BAR_COUNT * BAR_STEP_PX;

export function MiniAudioPlayer() {
  const { state } = useApp();
  const {
    currentTrack,
    queue,
    isPlaying,
    currentTime,
    duration,
    loop,
    expanded,
    hasNext,
    hasPrev,
    playTrack,
    playNext,
    playPrev,
    togglePlay,
    seek,
    setLoop,
    setExpanded,
    closePlayer,
  } = useAudioPlayer();

  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [showQueue, setShowQueue] = useState(false);

  // Tape-reel drag scrubbing state (fixed yellow center needle + scrolling waveform + haptics!)
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startTime: number;
    lastTickBar: number;
  } | null>(null);

  const linkedProject = useMemo(
    () =>
      currentTrack
        ? state.musicProjects.find(
            (p) => p.id === currentTrack.linkedProjectId || p.trackIds.includes(currentTrack.id)
          ) || null
        : null,
    [currentTrack, state.musicProjects]
  );

  useEffect(() => {
    let active = true;
    if (currentTrack?.coverMediaId) {
      getMediaObjectUrl(currentTrack.coverMediaId).then((url) => {
        if (active) setCoverUrl(url);
      });
    } else if (currentTrack?.cloudCoverUrl) {
      setCoverUrl(currentTrack.cloudCoverUrl);
    } else if (linkedProject?.coverDataUrl) {
      setCoverUrl(linkedProject.coverDataUrl);
    } else if (linkedProject?.coverMediaId) {
      getMediaObjectUrl(linkedProject.coverMediaId).then((url) => {
        if (active) setCoverUrl(url);
      });
    } else {
      setCoverUrl(null);
    }
    return () => {
      active = false;
    };
  }, [
    currentTrack?.coverMediaId,
    currentTrack?.cloudCoverUrl,
    linkedProject?.coverDataUrl,
    linkedProject?.coverMediaId,
  ]);

  // Dense deterministic waveform bars (matching [untitled] tape reel)
  const bars = useMemo(() => {
    if (!currentTrack) return [];
    let seed = currentTrack.id.split('').reduce((a, c) => a + c.charCodeAt(0), 31);
    return Array.from({ length: BAR_COUNT }, (_, idx) => {
      seed = (seed * 9301 + 49297) % 233280;
      const base = 16 + Math.round((seed / 233280) * 84);
      // Slight natural intro/outro taper
      const edge = Math.min(1, Math.min(idx + 3, BAR_COUNT - idx + 2) / 8);
      return Math.max(14, Math.round(base * (0.45 + 0.55 * edge)));
    });
  }, [currentTrack?.id]);

  const effectiveDuration = duration || currentTrack?.durationSec || 0;
  const displayTime = scrubbing ? scrubTime : currentTime;
  const ratio = effectiveDuration > 0 ? Math.min(1, Math.max(0, displayTime / effectiveDuration)) : 0;
  const pct = ratio * 100;
  const tapeOffsetPx = -ratio * TOTAL_TAPE_PX;
  // Vinyl disc rotation directly driven by playback & finger scrub!
  const discRotationDeg = displayTime * 22;

  const gradCls = getGradientClass(linkedProject?.coverGradient);
  const subtitle = [linkedProject?.title, currentTrack?.artist || state.preferences.name || 'Moi']
    .filter(Boolean)
    .join(' · ');
  const canPlay = Boolean(
    currentTrack?.mediaId || currentTrack?.cloudAudioUrl || currentTrack?.googleDriveFileId
  );

  // Pointer drag handlers for the horizontal scrolling waveform tape with haptic ticks
  const handleTapePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!effectiveDuration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startBar = Math.floor(ratio * BAR_COUNT);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startTime: currentTime,
      lastTickBar: startBar,
    };
    setScrubTime(currentTime);
    setScrubbing(true);
    triggerHapticTick(10);
  };

  const handleTapePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !effectiveDuration) return;
    // Dragging finger LEFT advances forward in the track (exact [untitled] tape reel physics!)
    const dx = drag.startX - e.clientX;
    const deltaSec = (dx / TOTAL_TAPE_PX) * effectiveDuration;
    const nextSec = Math.max(0, Math.min(effectiveDuration, drag.startTime + deltaSec));
    setScrubTime(nextSec);

    const barIndex = Math.floor((nextSec / effectiveDuration) * BAR_COUNT);
    if (barIndex !== drag.lastTickBar) {
      drag.lastTickBar = barIndex;
      triggerHapticTick(26);
    }
  };

  const finishTapeDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    seek(scrubTime);
    setScrubbing(false);
    triggerHapticTick(10);
  };

  return (
    <>
      {/* ================= FLOATING [UNTITLED]-STYLE MINI PLAYER ================= */}
      <AnimatePresence>
        {currentTrack && !expanded && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 left-2.5 right-2.5 md:left-64 md:right-6 z-50 max-w-2xl md:mx-auto rounded-full bg-[#141418]/96 text-white border border-white/10 shadow-[0_14px_38px_-8px_rgba(0,0,0,0.6)] backdrop-blur-xl px-2 py-1.5"
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
                  style={{ transform: `rotate(${discRotationDeg}deg)` }}
                  className="relative h-10 w-10 rounded-full overflow-hidden border border-white/15 shrink-0 transition-transform duration-100"
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
                    {currentTrack.title}
                  </p>
                  <p className="text-[10px] text-zinc-400 truncate mt-0.5">{subtitle}</p>
                </div>
              </button>

              {/* Mini Tape Preview (center-right on sm+) */}
              <div
                onClick={() => setExpanded(true)}
                className="hidden sm:flex relative w-24 h-7 items-center overflow-hidden cursor-pointer shrink-0"
              >
                <div
                  style={{ transform: `translateX(calc(50% + ${tapeOffsetPx * 0.22}px))` }}
                  className="flex items-center gap-[1.5px] h-6"
                >
                  {bars.slice(0, 36).map((h, i) => (
                    <div
                      key={i}
                      style={{ height: `${h}%` }}
                      className={`w-[2px] rounded-full ${
                        (i / 36) * 100 <= pct ? 'bg-white/90' : 'bg-white/25'
                      }`}
                    />
                  ))}
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

      {/* ================= EXPANDED [UNTITLED]-STYLE SCROLLING TAPE PLAYER ================= */}
      <AnimatePresence>
        {currentTrack && expanded && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setExpanded(false)}
              className="fixed inset-0 bg-neutral-900/72 backdrop-blur-2xl"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 24 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="relative z-10 w-full max-w-[356px] flex flex-col items-center gap-4"
            >
              {/* Main Obsidian Card (exact [untitled] video card!) */}
              <div className="w-full rounded-[32px] bg-[#0b0b0d] text-white border border-white/10 shadow-[0_32px_90px_-14px_rgba(0,0,0,0.88)] px-6 pt-6 pb-6 flex flex-col items-center space-y-5">
                {/* Title & Subtitle */}
                <div className="w-full text-center space-y-0.5 px-2">
                  <h2 className="text-[15px] font-semibold tracking-tight text-white truncate">
                    {currentTrack.title}
                  </h2>
                  <p className="text-xs text-zinc-400 truncate">{subtitle}</p>
                </div>

                {/* Large Spinning Vinyl Disc (rotates smoothly with playback & finger scrub!) */}
                <div className="py-1">
                  <div
                    style={{ transform: `rotate(${discRotationDeg}deg)` }}
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

                {/* [untitled] Scrolling Tape-Reel Waveform + Fixed Center Yellow Playhead + Haptics */}
                <div className="w-full space-y-2.5">
                  {/* Floating Yellow Time Pill (always crisp above needle while scrubbing!) */}
                  <div className="h-6 flex items-center justify-center">
                    <AnimatePresence>
                      {scrubbing && (
                        <motion.span
                          initial={{ opacity: 0, y: 4, scale: 0.92 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 4, scale: 0.92 }}
                          className="rounded-full bg-amber-300 text-zinc-950 px-3 py-0.5 font-mono text-[11px] font-bold tabular-nums shadow-md"
                        >
                          {fmt(displayTime)} / {fmt(effectiveDuration)}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Interactive Horizontal Tape Reel (Drag Left/Right with Haptic Feedback!) */}
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
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-[#0b0b0d] to-transparent z-10" />
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-[#0b0b0d] to-transparent z-10" />

                    {/* Sliding Bars Track anchored to center (50%) */}
                    <div
                      style={{
                        transform: `translate3d(calc(50% + ${tapeOffsetPx}px), 0, 0)`,
                        width: `${TOTAL_TAPE_PX}px`,
                      }}
                      className="absolute inset-y-0 left-0 flex items-center will-change-transform"
                    >
                      {bars.map((h, i) => {
                        const barRatio = i / BAR_COUNT;
                        const played = barRatio <= ratio;
                        return (
                          <div
                            key={i}
                            style={{ width: `${BAR_STEP_PX}px` }}
                            className="h-full flex items-center justify-center shrink-0"
                          >
                            <div
                              style={{ height: `${h}%` }}
                              className={`w-[2.5px] rounded-full transition-colors duration-75 ${
                                played ? 'bg-white' : 'bg-white/25'
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Fixed Center Yellow Playhead Needle */}
                    <div className="pointer-events-none absolute left-1/2 top-0.5 bottom-0.5 w-[2.5px] -translate-x-1/2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.85)] z-20" />
                  </div>

                  {/* Time Readout below tape */}
                  <p className="text-center font-mono text-xs text-zinc-400 tabular-nums">
                    {fmt(displayTime)} <span className="opacity-50">/</span> {fmt(effectiveDuration)}
                  </p>

                  {/* Timestamped Markers (if any) */}
                  {currentTrack.markers.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {currentTrack.markers.map((mk) => (
                        <button
                          key={mk.id}
                          type="button"
                          onClick={() => {
                            seek(mk.timeSec);
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

                {/* Transport Row (Prev · Play/Pause · Next · Loop) */}
                <div className="w-full flex items-center justify-around px-2 pt-1">
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
                      setLoop(!loop);
                      triggerHapticTick(10);
                    }}
                    title="Boucle"
                    className={`h-10 w-10 rounded-full flex items-center justify-center transition cursor-pointer ${
                      loop
                        ? 'bg-white/16 text-amber-300'
                        : 'text-zinc-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Repeat size={17} />
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
                                <span className="text-xs font-medium truncate">{t.title}</span>
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
