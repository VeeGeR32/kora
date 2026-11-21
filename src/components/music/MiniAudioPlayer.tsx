import { useEffect, useMemo, useState } from 'react';
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

export const PROJECT_GRADIENTS: { id: string; label: string; css: string }[] = [
  { id: 'pink', label: 'Untitled Pink', css: 'from-pink-300 via-fuchsia-400 to-fuchsia-600' },
  { id: 'violet', label: 'Violet Dusk', css: 'from-violet-400 via-purple-600 to-indigo-900' },
  { id: 'emerald', label: 'Emerald', css: 'from-emerald-300 via-teal-500 to-emerald-900' },
  { id: 'amber', label: 'Sunset', css: 'from-amber-300 via-orange-500 to-rose-600' },
  { id: 'sky', label: 'Ocean', css: 'from-sky-300 via-blue-500 to-indigo-800' },
  { id: 'midnight', label: 'Obsidian', css: 'from-zinc-700 via-zinc-900 to-black' },
];

export function getGradientClass(id?: string): string {
  return (
    PROJECT_GRADIENTS.find((g) => g.id === id)?.css ||
    PROJECT_GRADIENTS[0].css
  );
}

function fmt(sec: number) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

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

  // Deterministic waveform bars for current track (like [untitled])
  const bars = useMemo(() => {
    if (!currentTrack) return [];
    let seed = currentTrack.id.split('').reduce((a, c) => a + c.charCodeAt(0), 23);
    return Array.from({ length: 48 }, () => {
      seed = (seed * 9301 + 49297) % 233280;
      return 18 + Math.round((seed / 233280) * 82);
    });
  }, [currentTrack?.id]);

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const gradCls = getGradientClass(linkedProject?.coverGradient);
  const subtitle = [linkedProject?.title, currentTrack?.artist || state.preferences.name || 'Moi']
    .filter(Boolean)
    .join(' · ');
  const canPlay = Boolean(
    currentTrack?.mediaId || currentTrack?.cloudAudioUrl || currentTrack?.googleDriveFileId
  );

  return (
    <>
      {/* ================= FLOATING MINI PLAYER (ABOVE MOBILE BOTTOM NAVBAR) ================= */}
      <AnimatePresence>
        {currentTrack && !expanded && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 left-2.5 right-2.5 md:left-64 md:right-6 z-30 max-w-2xl md:mx-auto rounded-2xl bg-[#141418]/96 text-white border border-white/10 shadow-[0_14px_38px_-8px_rgba(0,0,0,0.55)] backdrop-blur-xl overflow-hidden"
          >
            {/* Subtle top hairline progress bar */}
            <div className="h-[2.5px] w-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-fuchsia-400 to-amber-300 transition-all duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="px-2.5 py-2 flex items-center justify-between gap-2">
              {/* Clickable Cover Art + Title -> Opens Expanded [untitled] Player */}
              <button
                type="button"
                onClick={() => {
                  setShowQueue(false);
                  setExpanded(true);
                }}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left group cursor-pointer"
                title="Cliquer pour agrandir le lecteur"
              >
                <div className="relative shrink-0">
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={currentTrack.title}
                      className="h-10 w-10 rounded-full object-cover border border-white/15 group-hover:scale-105 transition"
                    />
                  ) : (
                    <div
                      className={`h-10 w-10 rounded-full bg-gradient-to-br ${gradCls} flex items-center justify-center border border-white/15 group-hover:scale-105 transition`}
                    >
                      <Disc3 size={16} className={`text-white/90 ${isPlaying ? 'animate-spin' : ''}`} />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate leading-tight">
                    {currentTrack.title}
                  </p>
                  <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {subtitle}
                  </p>
                </div>
              </button>

              {/* Compact Transport Controls (Prev / Play-Pause / Next / Close) */}
              <div className="flex items-center gap-0.5 shrink-0">
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
                  className="h-9 w-9 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-35 transition cursor-pointer mx-0.5"
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
                  className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================= EXPANDED [UNTITLED]-STYLE FULL-SCREEN PLAYER ================= */}
      <AnimatePresence>
        {currentTrack && expanded && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setExpanded(false)}
              className="fixed inset-0 bg-black/65 backdrop-blur-2xl"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 24 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="relative z-10 w-full max-w-[360px] rounded-[32px] bg-[#141417] text-white border border-white/10 shadow-[0_32px_90px_-16px_rgba(0,0,0,0.85)] px-6 pt-5 pb-6 flex flex-col items-center space-y-5"
            >
              {/* Top Row: Collapse + Track Title & Subtitle */}
              <div className="w-full flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Réduire"
                  className="h-8 w-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-zinc-300 cursor-pointer shrink-0"
                >
                  <ChevronDown size={17} />
                </button>
                <div className="min-w-0 flex-1 text-center pt-0.5">
                  <h2 className="text-base font-semibold tracking-tight text-white truncate">
                    {currentTrack.title}
                  </h2>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={closePlayer}
                  aria-label="Fermer"
                  className="h-8 w-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer shrink-0"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Large Circular Vinyl / Cover Disc (Signature [untitled] Look) */}
              <div className="relative py-2">
                <div
                  className={`h-52 w-52 sm:h-56 sm:w-56 rounded-full overflow-hidden border border-white/15 shadow-[0_18px_50px_-12px_rgba(232,121,249,0.35)] ${
                    coverUrl ? '' : `bg-gradient-to-br ${gradCls}`
                  }`}
                >
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={currentTrack.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <div className="h-12 w-12 rounded-full bg-black/20 backdrop-blur-sm border border-white/20" />
                    </div>
                  )}
                </div>
              </div>

              {/* Interactive Waveform with Bright Yellow Playhead */}
              <div className="w-full space-y-2">
                <div
                  onClick={(e) => {
                    if (!duration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    seek(ratio * duration);
                  }}
                  className="relative h-12 flex items-center gap-[2.5px] cursor-pointer select-none px-0.5"
                  title="Cliquer pour avancer dans le morceau"
                >
                  {bars.map((h, i) => {
                    const barPct = ((i + 0.5) / bars.length) * 100;
                    const played = barPct <= pct;
                    return (
                      <div
                        key={i}
                        style={{ height: `${h}%` }}
                        className={`flex-1 rounded-full transition-colors ${
                          played ? 'bg-white' : 'bg-white/22'
                        }`}
                      />
                    );
                  })}
                  {/* Yellow Vertical Playhead (exact [untitled] signature) */}
                  <div
                    style={{ left: `${pct}%` }}
                    className="pointer-events-none absolute top-0 bottom-0 w-[2.5px] -translate-x-1/2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.8)]"
                  />
                </div>

                {/* Time Readout */}
                <p className="text-center font-mono text-xs text-zinc-400 tabular-nums">
                  {fmt(currentTime)} <span className="opacity-50">/</span> {fmt(duration)}
                </p>

                {/* Timestamped Markers (if any) */}
                {currentTrack.markers.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5">
                    {currentTrack.markers.map((mk) => (
                      <button
                        key={mk.id}
                        type="button"
                        onClick={() => seek(mk.timeSec)}
                        className="rounded-full bg-white/10 hover:bg-white/20 px-2.5 py-0.5 font-mono text-[10px] text-zinc-200 transition cursor-pointer"
                      >
                        {fmt(mk.timeSec)} · {mk.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Transport Controls Row (Loop · Prev · Play/Pause · Next · Queue) */}
              <div className="w-full flex items-center justify-between px-2 pt-1">
                <button
                  type="button"
                  onClick={() => setLoop(!loop)}
                  title="Boucle"
                  className={`h-10 w-10 rounded-full flex items-center justify-center transition cursor-pointer ${
                    loop
                      ? 'bg-white/18 text-amber-300'
                      : 'text-zinc-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Repeat size={17} />
                </button>

                <button
                  type="button"
                  onClick={playPrev}
                  disabled={!hasPrev && currentTime <= 3}
                  aria-label="Morceau précédent"
                  className="h-11 w-11 rounded-full flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-30 transition cursor-pointer"
                >
                  <SkipBack size={22} fill="currentColor" />
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
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
                  onClick={playNext}
                  disabled={!hasNext}
                  aria-label="Morceau suivant"
                  className="h-11 w-11 rounded-full flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-30 transition cursor-pointer"
                >
                  <SkipForward size={22} fill="currentColor" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowQueue((v) => !v)}
                  title="File d’attente"
                  className={`h-10 w-10 rounded-full flex items-center justify-center transition cursor-pointer ${
                    showQueue
                      ? 'bg-white/18 text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <ListMusic size={17} />
                </button>
              </div>

              {/* Optional Collapsible Queue List inside Expanded Player */}
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
                            onClick={() => void playTrack(t, 0, queue)}
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
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
