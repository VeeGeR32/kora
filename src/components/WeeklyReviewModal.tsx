import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Dumbbell, GraduationCap, Music2, Scale, Sparkles, Timer, X } from 'lucide-react';
import type { AIDomain } from '../types';
import { useApp } from '../context/AppContext';
import { addDays, todayISO } from '../utils/dates';

interface WeeklyReviewModalProps {
  open: boolean;
  onClose: () => void;
  onRequestAI: (prompt: string, domain?: AIDomain) => void;
}

export function WeeklyReviewModal({ open, onClose, onRequestAI }: WeeklyReviewModalProps) {
  const { state } = useApp();
  const today = todayISO();
  const weekAgo = addDays(today, -7);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const stats = useMemo(() => {
    const doneHw = state.homework.filter((h) => h.done).length;
    const totalHw = state.homework.length;
    const recentWorkouts = state.workouts.filter((w) => w.completed && w.date >= weekAgo);
    const totalVolume = recentWorkouts.reduce((s, w) => s + (w.totalVolumeKg || 0), 0);
    const focusMin = state.focusSessions
      .filter((f) => f.date >= weekAgo)
      .reduce((s, f) => s + f.durationMin, 0);
    const sortedW = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
    const wDelta =
      sortedW.length > 1 ? sortedW[sortedW.length - 1].weightKg - sortedW[0].weightKg : null;
    const studioStepsDone = state.musicProjects
      .flatMap((p) => p.steps)
      .filter((s) => s.done).length;
    const studioStepsTotal = state.musicProjects.flatMap((p) => p.steps).length;

    return {
      doneHw,
      totalHw,
      workoutsCount: recentWorkouts.length,
      totalVolume,
      focusMin,
      wDelta,
      studioStepsDone,
      studioStepsTotal,
    };
  }, [state, weekAgo]);

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
            className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#121215] border border-slate-200 dark:border-zinc-800 p-6 space-y-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Bilan de la semaine</h2>
                <p className="text-xs text-slate-400">Vue globale Cours · Gym · Music</p>
              </div>
              <button type="button" onClick={onClose} className="p-1.5 text-slate-400 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-900/50 p-3.5">
                <p className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                  <GraduationCap size={13} /> Devoirs validés
                </p>
                <p className="font-mono text-2xl font-bold mt-1">
                  {stats.doneHw}
                  <span className="text-sm font-normal opacity-60">/{stats.totalHw}</span>
                </p>
              </div>

              <div className="rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/50 p-3.5">
                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <Dumbbell size={13} /> Séances Gym (7j)
                </p>
                <p className="font-mono text-2xl font-bold mt-1">{stats.workoutsCount}</p>
                <p className="font-mono text-[10px] opacity-70">{stats.totalVolume.toLocaleString('fr-FR')} kg soulevés</p>
              </div>

              <div className="rounded-2xl bg-fuchsia-50/70 dark:bg-fuchsia-950/30 border border-fuchsia-200/60 dark:border-fuchsia-900/50 p-3.5">
                <p className="text-[11px] font-medium text-fuchsia-700 dark:text-fuchsia-300 flex items-center gap-1.5">
                  <Music2 size={13} /> Music
                </p>
                <p className="font-mono text-2xl font-bold mt-1">
                  {stats.studioStepsDone}
                  <span className="text-sm font-normal opacity-60">/{stats.studioStepsTotal}</span>
                </p>
                <p className="text-[10px] opacity-70">étapes projets</p>
              </div>

              <div className="rounded-2xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200/70 dark:border-zinc-800 p-3.5">
                <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <Timer size={13} /> Focus & Poids
                </p>
                <p className="font-mono text-2xl font-bold mt-1">{stats.focusMin} min</p>
                <p className="font-mono text-[10px] text-slate-400 flex items-center gap-1">
                  <Scale size={10} />{' '}
                  {stats.wDelta !== null ? `${stats.wDelta > 0 ? '+' : ''}${stats.wDelta.toFixed(1)} kg` : '—'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onRequestAI(
                  'Fais le bilan de ma semaine (cours, gym, music) et propose-moi un planning équilibré pour la semaine prochaine en plaçant mes révisions, séances gym et sessions music dans mes créneaux libres.',
                  'general'
                );
              }}
              className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-3 text-xs font-semibold flex items-center justify-center gap-2 hover:opacity-95 cursor-pointer"
            >
              <Sparkles size={15} /> Planifier ma semaine suivante avec Kora AI
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
