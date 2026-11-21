import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Disc3, Pause, Play, Repeat, X } from 'lucide-react';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { getMediaObjectUrl } from '../../lib/mediaDb';

function fmt(sec: number) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MiniAudioPlayer() {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    loop,
    togglePlay,
    seek,
    setLoop,
    closePlayer,
  } = useAudioPlayer();

  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (currentTrack?.coverMediaId) {
      getMediaObjectUrl(currentTrack.coverMediaId).then((url) => {
        if (active) setCoverUrl(url);
      });
    } else if (currentTrack?.cloudCoverUrl) {
      setCoverUrl(currentTrack.cloudCoverUrl);
    } else {
      setCoverUrl(null);
    }
    return () => {
      active = false;
    };
  }, [currentTrack?.coverMediaId, currentTrack?.cloudCoverUrl]);

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="fixed bottom-[76px] md:bottom-4 left-3 right-3 md:left-64 md:right-6 z-40 max-w-2xl md:mx-auto rounded-2xl bg-white/95 dark:bg-[#141418]/95 backdrop-blur-xl border border-slate-200/90 dark:border-zinc-800 shadow-xl px-3.5 py-2.5"
        >
          {/* Progress bar + timestamped markers */}
          <div className="relative flex items-center gap-2 mb-2">
            <span className="font-mono text-[10px] text-slate-400 tabular-nums w-8">
              {fmt(currentTime)}
            </span>
            <div className="relative flex-1 h-4 flex items-center">
              <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-fuchsia-600 dark:bg-fuchsia-400 transition-all duration-100"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {duration > 0 &&
                currentTrack.markers.map((mk) => (
                  <button
                    key={mk.id}
                    type="button"
                    title={`${mk.label} (${fmt(mk.timeSec)})`}
                    onClick={() => seek(mk.timeSec)}
                    style={{ left: `${Math.min(98, (mk.timeSec / duration) * 100)}%` }}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full bg-violet-500 ring-2 ring-white dark:ring-zinc-900 hover:scale-125 transition cursor-pointer z-10"
                  />
                ))}
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => seek(parseFloat(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
                aria-label="Position audio"
              />
            </div>
            <span className="font-mono text-[10px] text-slate-400 tabular-nums w-8 text-right">
              {fmt(duration)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            {/* Cover & Meta */}
            <div className="flex items-center gap-2.5 min-w-0">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={currentTrack.title}
                  className="h-9 w-9 rounded-xl object-cover shrink-0 border border-slate-200/70 dark:border-zinc-800"
                />
              ) : (
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-fuchsia-600 to-violet-600 text-white flex items-center justify-center shrink-0">
                  <Disc3 size={16} className={isPlaying ? 'animate-spin' : ''} />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                  {currentTrack.title}
                </p>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 truncate">
                  {currentTrack.artist}
                  {currentTrack.bpm ? ` · ${currentTrack.bpm} BPM` : ''}
                  {!currentTrack.mediaId && !currentTrack.cloudAudioUrl ? ' · Aucun MP3 importé' : ''}
                </p>
              </div>
            </div>

            {/* Quick Marker Jump Pills (desktop) */}
            {currentTrack.markers.length > 0 && (
              <div className="hidden sm:flex items-center gap-1 overflow-x-auto max-w-[200px]">
                {currentTrack.markers.slice(0, 3).map((mk) => (
                  <button
                    key={mk.id}
                    type="button"
                    onClick={() => seek(mk.timeSec)}
                    className="rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-zinc-300 hover:bg-fuchsia-500/15 hover:text-fuchsia-700 dark:hover:text-fuchsia-300 whitespace-nowrap transition cursor-pointer"
                  >
                    {mk.label}
                  </button>
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setLoop(!loop)}
                title="Boucle"
                className={`h-8 w-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
                  loop
                    ? 'bg-fuchsia-600 text-white'
                    : 'text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Repeat size={14} />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                disabled={!currentTrack.mediaId && !currentTrack.cloudAudioUrl}
                className="h-9 w-9 rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center hover:opacity-90 disabled:opacity-35 transition cursor-pointer"
              >
                {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={closePlayer}
                aria-label="Fermer le lecteur"
                className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 transition cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
