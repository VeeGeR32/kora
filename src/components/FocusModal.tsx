import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Disc3, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { sendKoraNotification } from '../lib/notifications';
import { todayISO } from '../utils/dates';
import { ProgressRing } from './ui/ProgressRing';

interface FocusModalProps {
  open: boolean;
  onClose: () => void;
}

export function FocusModal({ open, onClose }: FocusModalProps) {
  const { state, addFocusSession } = useApp();
  const player = useAudioPlayer();

  const [presetMin, setPresetMin] = useState(25);
  const [remainingSec, setRemainingSec] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState('Session Focus');
  const [category, setCategory] = useState<'cours' | 'musique' | 'perso'>('cours');
  const [trackId, setTrackId] = useState('');

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemainingSec((s) => {
        if (s <= 1) {
          setRunning(false);
          addFocusSession({
            date: todayISO(),
            durationMin: presetMin,
            label: label.trim() || 'Session Focus',
            category,
            linkedTrackId: trackId || undefined,
            completedAt: new Date().toISOString(),
          });
          if (state.preferences.notifications?.enabled && state.preferences.notifications?.timers) {
            void sendKoraNotification({
              title: 'Session Focus terminée ✓',
              body: `${presetMin} min sur « ${label.trim() || 'Session Focus'} » validées.`,
              tag: 'kora-focus-done',
            });
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, presetMin, label, category, trackId, addFocusSession]);

  const selectPreset = (m: number) => {
    setRunning(false);
    setPresetMin(m);
    setRemainingSec(m * 60);
  };

  const toggleStart = () => {
    if (!running && trackId) {
      const trk = state.musicTracks.find((t) => t.id === trackId);
      if (trk) void player.playTrack(trk);
    }
    setRunning((r) => !r);
  };

  const totalSec = presetMin * 60;
  const pct = totalSec > 0 ? ((totalSec - remainingSec) / totalSec) * 100 : 0;
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;

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
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Timer size={14} /> Mode Focus
              </span>
              <button type="button" onClick={onClose} className="p-1.5 text-slate-400 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {/* Presets */}
            <div className="grid grid-cols-3 gap-1.5">
              {[25, 45, 50].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectPreset(m)}
                  className={`rounded-xl py-1.5 font-mono text-xs font-semibold cursor-pointer ${
                    presetMin === m
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
                size={164}
                strokeWidth={7}
                showLabel={false}
                colorClass="stroke-indigo-600 dark:stroke-indigo-400"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-4xl font-bold tabular-nums tracking-tight">
                  {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
                </span>
                <span className="text-[11px] text-slate-400 mt-1">{category}</span>
              </div>
            </div>

            {/* Session Context */}
            <div className="space-y-2.5">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Objectif (ex. Révision Maths / Couplet 2)"
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs text-center"
              />
              <div className="grid grid-cols-3 gap-1.5">
                {(['cours', 'musique', 'perso'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`rounded-xl py-1.5 text-xs font-medium capitalize cursor-pointer ${
                      category === c
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {state.musicTracks.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2">
                  <Disc3 size={13} className="text-fuchsia-500 shrink-0" />
                  <select
                    value={trackId}
                    onChange={(e) => setTrackId(e.target.value)}
                    className="flex-1 bg-transparent text-xs outline-none"
                  >
                    <option value="">Musique de fond (optionnel)</option>
                    {state.musicTracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => selectPreset(presetMin)}
                className="h-11 w-11 rounded-2xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 flex items-center justify-center cursor-pointer"
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                onClick={toggleStart}
                className="flex-1 h-11 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                {running ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                {running ? 'Pause' : 'Démarrer le Focus'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
