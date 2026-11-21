import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Award,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  Dumbbell,
  Flame,
  Scale,
  Sparkles,
  TrendingUp,
  Trophy,
  Utensils,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatShortDateFR, todayISO } from '../../utils/dates';
import { WeightChart } from '../ui/WeightSparkline';
import { BeforeAfterSlider } from './BodyEvolutionSection';

interface MonthlyShowcaseModalProps {
  open: boolean;
  onClose: () => void;
  onJumpToPhotos?: () => void;
}

function getMonthKey(dateISO: string): string {
  return dateISO.slice(0, 7); // YYYY-MM
}

function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabelFR(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function calcWorkoutVolume(w: {
  totalVolumeKg?: number;
  exercises: { sets: { done: boolean; reps: number; weightKg: number }[] }[];
}): number {
  if (typeof w.totalVolumeKg === 'number' && w.totalVolumeKg > 0) return w.totalVolumeKg;
  let sum = 0;
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      if (s.done) sum += (s.reps || 0) * (s.weightKg || 0);
    }
  }
  return Math.round(sum);
}

export function MonthlyShowcaseModal({
  open,
  onClose,
  onJumpToPhotos,
}: MonthlyShowcaseModalProps) {
  const { state } = useApp();
  const currentMonthKey = getMonthKey(todayISO());
  const [monthKey, setMonthKey] = useState(currentMonthKey);

  const stats = useMemo(() => {
    const monthWorkouts = state.workouts
      .filter((w) => w.date.startsWith(monthKey))
      .sort((a, b) => a.date.localeCompare(b.date));

    const completedWorkouts = monthWorkouts.filter((w) => w.completed);
    const activeWorkouts = completedWorkouts.length > 0 ? completedWorkouts : monthWorkouts;

    const totalSessions = activeWorkouts.length;
    const totalMinutes = activeWorkouts.reduce((acc, w) => acc + (w.durationMin || 0), 0);
    const totalPRs = activeWorkouts.reduce((acc, w) => acc + (w.prCount || 0), 0);
    const sessionVolumes = activeWorkouts.map((w) => ({
      id: w.id,
      date: w.date,
      title: w.title,
      volumeKg: calcWorkoutVolume(w),
    }));
    const totalVolumeKg = sessionVolumes.reduce((acc, s) => acc + s.volumeKg, 0);
    const maxSessionVol = Math.max(1, ...sessionVolumes.map((s) => s.volumeKg));

    // Per-exercise load progression across the month
    const exerciseMap = new Map<
      string,
      { name: string; firstMax: number; bestMax: number; lastMax: number; sessions: number }
    >();
    for (const w of activeWorkouts) {
      for (const ex of w.exercises) {
        const doneWeights = ex.sets
          .filter((s) => (s.done || !w.completed) && s.weightKg > 0)
          .map((s) => s.weightKg);
        if (doneWeights.length === 0) continue;
        const maxW = Math.max(...doneWeights);
        const key = ex.name.trim().toLowerCase();
        const prev = exerciseMap.get(key);
        if (!prev) {
          exerciseMap.set(key, {
            name: ex.name.trim(),
            firstMax: maxW,
            bestMax: maxW,
            lastMax: maxW,
            sessions: 1,
          });
        } else {
          prev.bestMax = Math.max(prev.bestMax, maxW);
          prev.lastMax = maxW;
          prev.sessions += 1;
        }
      }
    }

    const exerciseProgressions = Array.from(exerciseMap.values())
      .map((e) => ({
        ...e,
        deltaKg: Math.round((e.bestMax - e.firstMax) * 10) / 10,
      }))
      .sort((a, b) => b.deltaKg - a.deltaKg || b.bestMax - a.bestMax)
      .slice(0, 6);

    // Nutrition stats for the month
    const monthMeals = state.meals.filter((m) => m.date.startsWith(monthKey));
    const mealsByDay = new Map<string, { kcal: number; protein: number; carbs: number; fat: number }>();
    for (const m of monthMeals) {
      const cur = mealsByDay.get(m.date) || { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      cur.kcal += m.calories;
      cur.protein += m.protein;
      cur.carbs += m.carbs;
      cur.fat += m.fat;
      mealsByDay.set(m.date, cur);
    }
    const nutritionDays = mealsByDay.size;
    const goalProt = state.preferences.nutritionGoals.protein || 150;
    const goalKcal = state.preferences.nutritionGoals.calories || 2400;

    let sumKcal = 0;
    let sumProt = 0;
    let sumCarbs = 0;
    let sumFat = 0;
    let protHitDays = 0;
    for (const d of mealsByDay.values()) {
      sumKcal += d.kcal;
      sumProt += d.protein;
      sumCarbs += d.carbs;
      sumFat += d.fat;
      if (d.protein >= goalProt * 0.85) protHitDays++;
    }
    const avgKcal = nutritionDays > 0 ? Math.round(sumKcal / nutritionDays) : 0;
    const avgProt = nutritionDays > 0 ? Math.round(sumProt / nutritionDays) : 0;
    const avgCarbs = nutritionDays > 0 ? Math.round(sumCarbs / nutritionDays) : 0;
    const avgFat = nutritionDays > 0 ? Math.round(sumFat / nutritionDays) : 0;
    const protHitPct = nutritionDays > 0 ? Math.round((protHitDays / nutritionDays) * 100) : 0;

    // Hydration stats
    const waterEntries = Object.entries(state.waterMlByDate).filter(
      ([d, ml]) => d.startsWith(monthKey) && ml > 0
    );
    const avgWaterL =
      waterEntries.length > 0
        ? waterEntries.reduce((acc, [, ml]) => acc + ml, 0) / waterEntries.length / 1000
        : 0;

    // Weight evolution
    const allWeights = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
    const monthWeights = allWeights.filter((w) => w.date.startsWith(monthKey));
    const firstWeight = monthWeights[0] || null;
    const lastWeight = monthWeights[monthWeights.length - 1] || null;
    const weightDelta =
      firstWeight && lastWeight && monthWeights.length >= 2
        ? Math.round((lastWeight.weightKg - firstWeight.weightKg) * 10) / 10
        : null;

    // Progress Photos for comparison
    const allPhotos = [...(state.fitnessProfile.progressPhotos || [])].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const monthPhotos = allPhotos.filter((p) => p.date.startsWith(monthKey));
    const baseline = allPhotos.find((p) => p.isBaseline) || allPhotos[0] || null;
    let compareBefore: (typeof allPhotos)[number] | null =
      monthPhotos.length >= 2 ? monthPhotos[0] : baseline;
    const compareAfter: (typeof allPhotos)[number] | null =
      monthPhotos.length > 0
        ? monthPhotos[monthPhotos.length - 1]
        : allPhotos.length >= 2
        ? allPhotos[allPhotos.length - 1]
        : null;
    if (compareBefore && compareAfter && compareBefore.id === compareAfter.id) {
      compareBefore = null;
    }

    return {
      totalSessions,
      totalMinutes,
      totalPRs,
      totalVolumeKg,
      sessionVolumes,
      maxSessionVol,
      exerciseProgressions,
      nutritionDays,
      totalMeals: monthMeals.length,
      avgKcal,
      avgProt,
      avgCarbs,
      avgFat,
      goalKcal,
      goalProt,
      protHitPct,
      avgWaterL,
      monthWeights,
      firstWeight,
      lastWeight,
      weightDelta,
      allPhotos,
      monthPhotos,
      compareBefore,
      compareAfter,
    };
  }, [state, monthKey]);

  const canGoNext = monthKey < currentMonthKey;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/60 dark:bg-black/80 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            className="relative z-10 w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#0e0e11] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
          >
            {/* Header + Month Switcher */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-3 shrink-0 bg-gradient-to-r from-emerald-500/10 via-transparent to-indigo-500/10">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shrink-0">
                  <Sparkles size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                    Showcase Mensuel · Sport & Corps
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <button
                      type="button"
                      onClick={() => setMonthKey((k) => shiftMonthKey(k, -1))}
                      className="h-6 w-6 rounded-lg hover:bg-slate-200/70 dark:hover:bg-zinc-800 flex items-center justify-center text-slate-600 dark:text-zinc-300 cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-zinc-50 min-w-[132px] text-center">
                      {formatMonthLabelFR(monthKey)}
                    </h2>
                    <button
                      type="button"
                      disabled={!canGoNext}
                      onClick={() => setMonthKey((k) => shiftMonthKey(k, 1))}
                      className="h-6 w-6 rounded-lg hover:bg-slate-200/70 dark:hover:bg-zinc-800 flex items-center justify-center text-slate-600 dark:text-zinc-300 disabled:opacity-25 cursor-pointer"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable Showcase Content */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* 1. HERO STATS BENTO */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-2xl bg-slate-950 text-white p-3.5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                    <Dumbbell size={11} className="text-emerald-400" /> Séances
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums">{stats.totalSessions}</p>
                  <p className="text-[10px] text-zinc-400">
                    Obj. ~{state.fitnessProfile.daysPerWeek * 4}/mois
                  </p>
                </div>

                <div className="rounded-2xl bg-emerald-600 text-white p-3.5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-100 flex items-center gap-1">
                    <TrendingUp size={11} /> Volume total
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums">
                    {stats.totalVolumeKg >= 1000
                      ? `${(stats.totalVolumeKg / 1000).toFixed(1)}t`
                      : `${stats.totalVolumeKg}`}
                  </p>
                  <p className="text-[10px] text-emerald-100">
                    {stats.totalVolumeKg.toLocaleString('fr-FR')} kg soulevés
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 p-3.5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Clock size={11} className="text-indigo-500" /> Temps gym
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-zinc-100">
                    {Math.floor(stats.totalMinutes / 60)}h{String(stats.totalMinutes % 60).padStart(2, '0')}
                  </p>
                  <p className="text-[10px] text-slate-400">{stats.totalMinutes} min cumulées</p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 p-3.5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Trophy size={11} className="text-amber-500" /> Records (PR)
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums text-amber-500">
                    {stats.totalPRs}
                  </p>
                  <p className="text-[10px] text-slate-400">Records ce mois</p>
                </div>
              </div>

              {/* 2. ÉVOLUTION DES CHARGES DE TRAVAIL */}
              <section className="rounded-3xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Award size={13} className="text-emerald-500" /> Évolution des charges de travail
                  </h3>
                  <span className="font-mono text-[11px] text-slate-400">
                    {stats.sessionVolumes.length} séance{stats.sessionVolumes.length > 1 ? 's' : ''}
                  </span>
                </div>

                {stats.sessionVolumes.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3 text-center">
                    Aucune séance enregistrée sur {formatMonthLabelFR(monthKey)}.
                  </p>
                ) : (
                  <>
                    {/* Mini Volume Bar Chart */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-slate-400">Volume par séance (kg)</p>
                      <div className="h-24 flex items-end gap-1.5 pt-2">
                        {stats.sessionVolumes.map((s) => {
                          const hPct = Math.max(12, Math.round((s.volumeKg / stats.maxSessionVol) * 100));
                          return (
                            <div
                              key={s.id}
                              title={`${formatShortDateFR(s.date)} · ${s.title} : ${s.volumeKg} kg`}
                              className="flex-1 flex flex-col items-center justify-end gap-1 h-full min-w-[14px]"
                            >
                              <div
                                style={{ height: `${hPct}%` }}
                                className="w-full max-w-[30px] rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-400"
                              />
                              <span className="font-mono text-[9px] text-slate-400 truncate max-w-full">
                                {s.date.slice(8)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Top Exercise Load Progressions */}
                    {stats.exerciseProgressions.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-zinc-800/80">
                        <p className="text-[11px] text-slate-400">Charges max & progressions</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {stats.exerciseProgressions.map((ex) => (
                            <div
                              key={ex.name}
                              className="rounded-xl bg-slate-50 dark:bg-zinc-900 px-3 py-2 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-800 dark:text-zinc-100 truncate">
                                  {ex.name}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  {ex.sessions} séance{ex.sessions > 1 ? 's' : ''} ·{' '}
                                  {ex.firstMax} kg → {ex.bestMax} kg
                                </p>
                              </div>
                              <span
                                className={`font-mono text-xs font-bold shrink-0 px-2 py-0.5 rounded-full ${
                                  ex.deltaKg > 0
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-slate-200/70 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                                }`}
                              >
                                {ex.deltaKg > 0 ? `+${ex.deltaKg} kg` : `${ex.bestMax} kg`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* 3. STATS NUTRITION & HYDRATATION */}
              <section className="rounded-3xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Utensils size={13} className="text-indigo-500" /> Stats Nutrition
                  </h3>
                  <span className="font-mono text-[11px] text-slate-400">
                    {stats.nutritionDays} j suivis · {stats.totalMeals} repas
                  </span>
                </div>

                {stats.nutritionDays === 0 ? (
                  <p className="text-xs text-slate-400 py-2 text-center">
                    Aucun repas enregistré sur ce mois.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="rounded-2xl bg-slate-50 dark:bg-zinc-900 p-3">
                      <p className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Flame size={10} className="text-emerald-500" /> Moy. Kcal/j
                      </p>
                      <p className="font-mono text-lg font-bold mt-0.5">{stats.avgKcal}</p>
                      <p className="font-mono text-[10px] text-slate-400">
                        obj. {stats.goalKcal}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 dark:bg-zinc-900 p-3">
                      <p className="text-[10px] text-slate-400">Moy. Prot/j</p>
                      <p className="font-mono text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
                        {stats.avgProt}g
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">
                        obj. {stats.goalProt}g ({stats.protHitPct}%)
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 dark:bg-zinc-900 p-3">
                      <p className="text-[10px] text-slate-400">Gluc / Lip</p>
                      <p className="font-mono text-sm font-bold mt-1.5">
                        {stats.avgCarbs}g / {stats.avgFat}g
                      </p>
                      <p className="text-[10px] text-slate-400">moyenne / jour</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 dark:bg-zinc-900 p-3">
                      <p className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Droplets size={10} className="text-sky-500" /> Hydratation
                      </p>
                      <p className="font-mono text-lg font-bold text-sky-600 dark:text-sky-400 mt-0.5">
                        {stats.avgWaterL > 0 ? `${stats.avgWaterL.toFixed(1)}L` : '—'}
                      </p>
                      <p className="text-[10px] text-slate-400">moyenne / jour</p>
                    </div>
                  </div>
                )}
              </section>

              {/* 4. ÉVOLUTION DU POIDS */}
              <section className="rounded-3xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Scale size={13} className="text-emerald-500" /> Évolution du poids
                  </h3>
                  {stats.firstWeight && stats.lastWeight && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-slate-500">
                        {stats.firstWeight.weightKg.toFixed(1)} kg →{' '}
                        <strong className="text-slate-900 dark:text-zinc-100">
                          {stats.lastWeight.weightKg.toFixed(1)} kg
                        </strong>
                      </span>
                      {stats.weightDelta !== null && (
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/12 px-2 py-0.5 rounded-full text-[11px]">
                          {stats.weightDelta > 0 ? '+' : ''}
                          {stats.weightDelta.toFixed(1)} kg
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {stats.monthWeights.length > 0 ? (
                  <WeightChart
                    entries={stats.monthWeights}
                    goalKg={state.preferences.weightGoalKg}
                  />
                ) : (
                  <p className="text-xs text-slate-400 py-2 text-center">
                    Aucune pesée enregistrée sur {formatMonthLabelFR(monthKey)}.
                  </p>
                )}
              </section>

              {/* 5. ÉVOLUTION CORPORELLLE VISUELLE (PHOTOS) */}
              <section className="rounded-3xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Camera size={13} className="text-fuchsia-500" /> Évolution physique en images
                  </h3>
                  <span className="font-mono text-[11px] text-slate-400">
                    {stats.allPhotos.length} photo{stats.allPhotos.length > 1 ? 's' : ''}
                  </span>
                </div>

                {stats.compareBefore && stats.compareAfter ? (
                  <BeforeAfterSlider before={stats.compareBefore} after={stats.compareAfter} />
                ) : stats.allPhotos.length === 1 ? (
                  <div className="flex items-center gap-4 rounded-2xl bg-slate-50 dark:bg-zinc-900 p-3">
                    <img
                      src={stats.allPhotos[0].thumbDataUrl}
                      alt={stats.allPhotos[0].label}
                      className="h-24 w-20 rounded-xl object-cover shrink-0"
                    />
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                        Photo initiale prête ({formatShortDateFR(stats.allPhotos[0].date)})
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                        Ajoute une 2ᵉ photo hebdo pour débloquer le comparateur interactif Avant / Après dans ton Showcase !
                      </p>
                      {onJumpToPhotos && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onJumpToPhotos();
                          }}
                          className="rounded-xl bg-emerald-600 text-white px-3 py-1.5 text-[11px] font-semibold cursor-pointer"
                        >
                          Ajouter une photo
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-slate-50 dark:bg-zinc-900 p-5 text-center space-y-2">
                    <p className="text-xs text-slate-500 dark:text-zinc-400">
                      Ajoute ta photo initiale (Jour 1) dans <strong>Sport → Corps</strong> pour visualiser ton évolution mois après mois ici.
                    </p>
                    {onJumpToPhotos && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onJumpToPhotos();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold cursor-pointer"
                      >
                        <Camera size={13} /> Aller à mes photos
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
