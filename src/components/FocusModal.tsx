import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Disc3, Play, Square, Timer, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { uid } from '../utils/dates';
import { ProgressRing } from './ui/ProgressRing';

interface FocusModalProps {
  open: boolean;
  onClose: () => void;
}

export function FocusModal({ open, onClose }: FocusModalProps) {
  const { state, startActiveFocus, stopActiveFocus } = useApp();
  const player = useAudioPlayer();

  const activeFocus = state.preferences.activeFocus || null;
  const isRunning = Boolean(activeFocus && activeFocus.endsAt > Date.now());

  const [presetMin, setPresetMin] = useState(25);
  const [label, setLabel] = useState('Session Focus');
  const [category, setCategory] = useState<'cours' | 'musique' | 'perso'>('cours');
  const [trackId, setTrackId] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Sync display metadata when an active Focus session arrives from another device or on launch
  useEffect(() => {
    if (activeFocus) {
      setPresetMin(activeFocus.presetMin);
      setLabel(activeFocus.label);
      setCategory(activeFocus.category);
      setTrackId(activeFocus.linkedTrackId || '');
    }
  }, [activeFocus?.id]);

  // Smooth wall-clock ticker (NEVER pauses even if app closes or switches device!)
  useEffect(() => {
    if (!activeFocus) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [activeFocus?.id]);

  const totalSec = (activeFocus?.presetMin || presetMin) * 60;
  const remainingSec = activeFocus
    ? Math.max(0, Math.ceil((activeFocus.endsAt - nowMs) / 1000))
    : presetMin * 60;
  const pct = totalSec > 0 ? Math.min(100, Math.max(0, ((totalSec - remainingSec) / totalSec) * 100)) : 0;
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;

  const handleStart = () => {
    const startedAt = Date.now();
    const endsAt = startedAt + presetMin * 60_000;
    if (trackId) {
      const trk = state.musicTracks.find((t) => t.id === trackId);
      if (trk) void player.playTrack(trk);
    }
    startActiveFocus({
      id: uid('foc'),
      label: label.trim() || 'Session Focus',
      category,
      presetMin,
      startedAt,
      endsAt,
      linkedTrackId: trackId || undefined,
    });
  };

  const handleStop = () => {
    stopActiveFocus();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/40 dark:bg-black/70 backdrop-blur-xs"
          />

          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="relative z-10 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#121215] border border-slate-200 dark:border-zinc-800 p-6 space-y-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Timer size={14} /> Mode Focus
                </span>
                {isRunning && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 text-[10px] font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                    Actif partout
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                title={isRunning ? 'Réduire (le Focus continue en arrière-plan)' : 'Fermer'}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Presets (locked while running) */}
            <div className="grid grid-cols-3 gap-1.5">
              {[25, 45, 50].map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setPresetMin(m)}
                  className={`rounded-xl py-1.5 font-mono text-xs font-semibold transition cursor-pointer disabled:opacity-50 ${
                    (activeFocus?.presetMin ?? presetMin) === m
                      ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                  }`}
                >
                  {m} min
                </button>
              ))}
            </div>

            {/* Big Ring */}
            <div className="flex flex-col items-center justify-center py-2 relative">
              <ProgressRing
                value={pct}
                size={168}
                strokeWidth={7}
                showLabel={false}
                colorClass="stroke-indigo-600 dark:stroke-indigo-400"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-3xl font-bold tabular-nums tracking-tight">
                  {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  {isRunning ? 'Continue même app fermée' : 'Prêt à démarrer'}
                </span>
              </div>
            </div>

            {/* Session Config */}
            <div className="space-y-2.5">
              <input
                type="text"
                disabled={isRunning}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex. Révision Analyse, Écriture Couplet 2…"
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs outline-none disabled:opacity-70"
              />
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['cours', 'Cours'],
                    ['musique', 'Music'],
                    ['perso', 'Perso'],
                  ] as const
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    disabled={isRunning}
                    onClick={() => setCategory(k)}
                    className={`rounded-xl py-1.5 text-[11px] font-medium cursor-pointer disabled:opacity-50 ${
                      category === k
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {state.musicTracks.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2">
                  <Disc3 size={13} className="text-fuchsia-500 shrink-0" />
                  <select
                    disabled={isRunning}
                    value={trackId}
                    onChange={(e) => setTrackId(e.target.value)}
                    className="flex-1 bg-transparent text-xs outline-none cursor-pointer disabled:opacity-60"
                  >
                    <option value="">Sans fond audio Music</option>
                    {state.musicTracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Action Controls */}
            {isRunning ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-500/12 text-rose-600 dark:text-rose-400 border border-rose-500/25 py-3 text-xs font-semibold hover:bg-rose-500/20 cursor-pointer"
                >
                  <Square size={13} fill="currentColor" /> Arrêter le Focus
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-3 text-xs font-semibold hover:opacity-92 cursor-pointer"
              >
                <Play size={14} /> Démarrer Focus ({presetMin} min)
              </button>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
