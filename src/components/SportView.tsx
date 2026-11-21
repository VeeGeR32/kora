import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  CalendarPlus,
  Camera,
  Check,
  Clock,
  Disc3,
  Droplets,
  Dumbbell,
  Flame,
  Play,
  Plus,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Trophy,
  Utensils,
  X,
} from 'lucide-react';
import type { AIDomain, FitnessGoal, MealSlot, WorkoutFocus, WorkoutRoutine } from '../types';
import { useApp } from '../context/AppContext';
import { useAI } from '../context/AIContext';
import { formatShortDateFR, todayISO, uid } from '../utils/dates';
import { MEAL_SLOT_LABELS, WORKOUT_FOCUSES } from '../utils/theme';
import { ProgressRing } from './ui/ProgressRing';
import { WeightChart } from './ui/WeightSparkline';
import { MealPhotoAnalyzerModal } from './sport/MealPhotoAnalyzerModal';
import { BodyEvolutionSection } from './sport/BodyEvolutionSection';
import { MonthlyShowcaseModal } from './sport/MonthlyShowcaseModal';
import type { QuickAddContext } from './QuickAddModal';

interface SportViewProps {
  onOpenQuickAdd: (ctx?: QuickAddContext) => void;
  onRequestAI?: (prompt: string, domain?: AIDomain) => void;
}

type SportSubTab = 'gym' | 'nutrition' | 'poids';

/** Fast offline heuristic nutrition estimator when user logs a meal in natural French text */
function estimateMealLocally(text: string): { calories: number; protein: number; carbs: number; fat: number } {
  const lower = text.toLowerCase();
  const baseItems: [RegExp, number, number, number, number][] = [
    [/poulet|dinde/, 260, 44, 0, 6],
    [/b[œo]uf|steak|viande/, 310, 36, 0, 18],
    [/saumon|thon|poisson/, 290, 34, 0, 16],
    [/[œo]uf|omelette/, 220, 18, 2, 15],
    [/whey|shaker|prot/, 130, 26, 3, 2],
    [/skyr|fromage blanc|yaourt/, 140, 18, 10, 2],
    [/riz|p[âa]tes|semoule|quinoa/, 340, 10, 72, 2],
    [/avoine|porridge|flocon/, 290, 10, 50, 5],
    [/patate|pomme de terre|frites/, 260, 5, 50, 5],
    [/pain|baguette|toast/, 180, 6, 36, 2],
    [/banane|pomme|fruit|myrtille/, 105, 1, 26, 0],
    [/avocat|amande|noix|beurre de cacahu[eè]te|huile/, 180, 4, 5, 16],
    [/kebab|tacos|burger|pizza/, 850, 42, 85, 36],
  ];
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let matched = 0;
  for (const [re, c, p, g, l] of baseItems) {
    if (re.test(lower)) {
      calories += c;
      protein += p;
      carbs += g;
      fat += l;
      matched++;
    }
  }
  if (matched === 0) return { calories: 480, protein: 28, carbs: 50, fat: 16 };
  return { calories, protein, carbs, fat };
}

export function SportView({ onOpenQuickAdd, onRequestAI }: SportViewProps) {
  const {
    state,
    lastCloudSyncAt,
    deleteWorkout,
    addRoutine,
    updateRoutine,
    deleteRoutine,
    updateFitnessProfile,
    updatePreferences,
    updateLastSession,
    startActiveWorkout,
    addMeal,
    deleteMeal,
    addWater,
    addWeight,
    deleteWeight,
    notify,
  } = useApp();
  const { draftActions, applyDraftAction, dismissDraftAction } = useAI();

  const today = todayISO();
  const [subTab, setSubTabState] = useState<SportSubTab>(
    () => state.preferences.lastSession?.sportSubTab || 'gym'
  );
  const sportCloudSyncedRef = useRef(false);

  const setSubTab = (next: SportSubTab) => {
    setSubTabState(next);
    updateLastSession({ sportSubTab: next });
  };

  useEffect(() => {
    if (!lastCloudSyncAt || sportCloudSyncedRef.current) return;
    sportCloudSyncedRef.current = true;
    const saved = state.preferences.lastSession?.sportSubTab;
    if (saved) setSubTabState(saved);
  }, [lastCloudSyncAt]);

  // Domain-specific goals editors (moved out of global Settings!)
  const [showNutritionGoals, setShowNutritionGoals] = useState(false);
  const [editingWeightGoal, setEditingWeightGoal] = useState(false);
  const [weightGoalDraft, setWeightGoalDraft] = useState(String(state.preferences.weightGoalKg));

  // New routine creator state
  const [showNewRoutine, setShowNewRoutine] = useState(false);
  const [rtTitle, setRtTitle] = useState('');
  const [rtFocus, setRtFocus] = useState<WorkoutFocus>('Push');
  const [showProfileEdit, setShowProfileEdit] = useState(false);

  // Nutrition state
  const [nutritionDate, setNutritionDate] = useState(today);
  const [freeMealText, setFreeMealText] = useState('');
  const [freeMealSlot, setFreeMealSlot] = useState<MealSlot>('dejeuner');
  const [mealPhotoOpen, setMealPhotoOpen] = useState(false);

  // Monthly Showcase modal
  const [showcaseOpen, setShowcaseOpen] = useState(false);

  // Weight inline state
  const [weightInput, setWeightInput] = useState('');
  const [weightNote, setWeightNote] = useState('');

  // Progress photos check-in status (Day 1 or weekly >= 7 days)
  const photoPromptStatus = useMemo(() => {
    const photos = [...(state.fitnessProfile.progressPhotos || [])].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    if (photos.length === 0) return { kind: 'initial' as const, week: 1 };
    const baseline = photos.find((p) => p.isBaseline) || photos[0];
    const latest = photos[photos.length - 1];
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSinceLast = Math.round(
      (new Date(`${today}T12:00:00`).getTime() - new Date(`${latest.date}T12:00:00`).getTime()) /
        msPerDay
    );
    const week =
      Math.floor(
        Math.max(
          0,
          new Date(`${today}T12:00:00`).getTime() - new Date(`${baseline.date}T12:00:00`).getTime()
        ) /
          (7 * msPerDay)
      ) + 1;
    if (daysSinceLast >= 7) return { kind: 'weekly' as const, week, daysSinceLast };
    return null;
  }, [state.fitnessProfile.progressPhotos, today]);

  const dayMeals = useMemo(
    () => state.meals.filter((m) => m.date === nutritionDate),
    [state.meals, nutritionDate]
  );
  const totals = useMemo(
    () =>
      dayMeals.reduce(
        (acc, m) => ({
          calories: acc.calories + m.calories,
          protein: acc.protein + m.protein,
          carbs: acc.carbs + m.carbs,
          fat: acc.fat + m.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      ),
    [dayMeals]
  );
  const goals = state.preferences.nutritionGoals;
  const waterMl = state.waterMlByDate[nutritionDate] || 0;

  const sortedWeights = useMemo(
    () => [...state.weights].sort((a, b) => a.date.localeCompare(b.date)),
    [state.weights]
  );
  const latestWeight = sortedWeights[sortedWeights.length - 1] || null;
  const firstWeight = sortedWeights[0] || null;
  const totalDelta =
    latestWeight && firstWeight && sortedWeights.length > 1
      ? latestWeight.weightKg - firstWeight.weightKg
      : null;
  const toGoal = latestWeight ? latestWeight.weightKg - state.preferences.weightGoalKg : null;

  const sortedWorkouts = useMemo(
    () => [...state.workouts].sort((a, b) => b.date.localeCompare(a.date)),
    [state.workouts]
  );

  // Launch Live Workout (empty or from routine or existing session)
  const startEmptyWorkout = () => {
    startActiveWorkout({
      id: '',
      title: 'Séance libre',
      date: today,
      startTime: new Date().toTimeString().slice(0, 5),
      durationMin: 45,
      focus: 'Autre',
      completed: false,
      exercises: [],
    });
  };

  const startFromRoutine = (rt: WorkoutRoutine) => {
    startActiveWorkout({
      id: '',
      title: rt.title,
      date: today,
      startTime: new Date().toTimeString().slice(0, 5),
      durationMin: 60,
      focus: rt.focus,
      completed: false,
      routineId: rt.id,
      linkedTrackId: rt.linkedTrackId,
      exercises: rt.exercises.map((ex) => ({
        id: uid('ex'),
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        restSeconds: ex.restSeconds || 90,
        sets: Array.from({ length: ex.defaultSets || 3 }, () => ({
          id: uid('s'),
          reps: parseInt(ex.targetReps, 10) || 10,
          weightKg: ex.targetWeightKg || 20,
          done: false,
          type: 'normal' as const,
        })),
      })),
    });
  };

  const handleCreateRoutine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rtTitle.trim()) return;
    addRoutine({
      title: rtTitle.trim(),
      focus: rtFocus,
      exercises: [],
    });
    setRtTitle('');
    setShowNewRoutine(false);
  };

  const handleFreeTextMeal = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = freeMealText.trim();
    if (!clean) return;
    if (state.preferences.geminiApiKey && onRequestAI) {
      onRequestAI(
        `Estime précisément les calories et macros (protéines, glucides, lipides) et enregistre ce repas pour le ${nutritionDate} (${MEAL_SLOT_LABELS[freeMealSlot]}) : "${clean}"`,
        'sport'
      );
      setFreeMealText('');
      return;
    }
    const est = estimateMealLocally(clean);
    addMeal({
      date: nutritionDate,
      slot: freeMealSlot,
      name: clean,
      ...est,
    });
    setFreeMealText('');
  };

  const handleInlineWeight = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(weightInput.replace(',', '.'));
    if (isNaN(val) || val < 30 || val > 250) return;
    addWeight({
      date: today,
      weightKg: Math.round(val * 10) / 10,
      note: weightNote.trim() || undefined,
    });
    setWeightInput('');
    setWeightNote('');
  };

  const goalLabels: Record<FitnessGoal, string> = {
    'prise-de-masse': 'Prise de masse',
    seche: 'Sèche / Définition',
    force: 'Force pure',
    recomposition: 'Recomposition',
    endurance: 'Endurance',
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header + Sub-tabs + Monthly Showcase */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Sport & Corps
          </h1>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
            Live Workout, nutrition photo IA, évolution physique & showcase mensuel
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setShowcaseOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-300/80 dark:border-emerald-800/80 bg-emerald-500/10 hover:bg-emerald-500/18 text-emerald-700 dark:text-emerald-300 px-3.5 py-2 text-xs font-semibold transition cursor-pointer"
          >
            <BarChart3 size={13} />
            Showcase mensuel
          </button>

          <div className="inline-flex items-center rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1">
            {(
              [
                ['gym', 'Gym', Dumbbell],
                ['nutrition', 'Nutrition', Utensils],
                ['poids', 'Corps', Scale],
              ] as const
            ).map(([id, label, Icon]) => {
              const active = subTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSubTab(id)}
                  className={`relative flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                    active
                      ? 'text-white dark:text-zinc-950'
                      : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="sportSubTabPill"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-slate-900 dark:bg-zinc-100"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <Icon size={13} />
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Subtle Check-in Photo Prompt Banner (on Gym/Nutrition tabs when initial or weekly photo is due) */}
      {photoPromptStatus && subTab !== 'poids' && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-300">
            <Camera size={14} className="text-emerald-500 shrink-0" />
            <span>
              {photoPromptStatus.kind === 'initial' ? (
                <>
                  <strong>Suivi physique :</strong> ajoute ta photo initiale (Jour 1) pour suivre ton évolution au fil des semaines.
                </>
              ) : (
                <>
                  <strong>Check-in Semaine {photoPromptStatus.week} :</strong> ta photo hebdo est prête pour le Showcase mensuel !
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSubTab('poids')}
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer shrink-0"
          >
            {photoPromptStatus.kind === 'initial' ? 'Ajouter photo Jour 1 →' : 'Faire le check-in →'}
          </button>
        </div>
      )}

      {/* ================== GYM TAB (HEVY STYLE) ================== */}
      {subTab === 'gym' && (
        <div className="space-y-5">
          {/* Quick Start Hero Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={startEmptyWorkout}
              className="rounded-2xl bg-emerald-600 text-white p-4 flex items-center justify-between hover:bg-emerald-700 active:scale-[0.99] transition cursor-pointer shadow-xs"
            >
              <div className="text-left">
                <p className="text-sm font-semibold">Démarrer un entraînement vide</p>
                <p className="text-[11px] opacity-85 mt-0.5">
                  Chrono en direct, séries/kg/reps & repos auto
                </p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <Play size={18} fill="currentColor" className="ml-0.5" />
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                onRequestAI?.(
                  `Crée-moi un programme complet de musculation adapté à mon profil (${goalLabels[state.fitnessProfile.goal]}, ${state.fitnessProfile.daysPerWeek} jours/semaine, matériel : ${state.fitnessProfile.equipment}). Ajoute les routines, planifie ma semaine dans le Planning et ajuste mes macros si besoin.`,
                  'sport'
                )
              }
              className="tempo-card rounded-2xl p-4 flex items-center justify-between hover:border-emerald-400 dark:hover:border-emerald-700 transition cursor-pointer text-left"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-emerald-500" />
                  Programme & Suivi IA
                </p>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                  {goalLabels[state.fitnessProfile.goal]} · {state.fitnessProfile.daysPerWeek}j/sem ·{' '}
                  {state.fitnessProfile.equipment}
                </p>
              </div>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                Générer →
              </span>
            </button>
          </div>

          {/* Editable Fitness Profile Strip */}
          <div className="tempo-card rounded-2xl px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                Profil sportif · {goalLabels[state.fitnessProfile.goal]} ({state.fitnessProfile.level})
              </span>
              <button
                type="button"
                onClick={() => setShowProfileEdit((v) => !v)}
                className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                {showProfileEdit ? 'Fermer' : 'Modifier'}
              </button>
            </div>
            {showProfileEdit && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
                <select
                  value={state.fitnessProfile.goal}
                  onChange={(e) => updateFitnessProfile({ goal: e.target.value as FitnessGoal })}
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                >
                  {Object.entries(goalLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={state.fitnessProfile.daysPerWeek}
                  onChange={(e) => updateFitnessProfile({ daysPerWeek: Number(e.target.value) || 4 })}
                  placeholder="Jours / semaine"
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 font-mono text-xs"
                />
                <input
                  type="text"
                  value={state.fitnessProfile.equipment}
                  onChange={(e) => updateFitnessProfile({ equipment: e.target.value })}
                  placeholder="Matériel (Salle, haltères...)"
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                />
              </div>
            )}
          </div>

          {/* Routines Section (Hevy Style) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                Mes routines ({state.workoutRoutines.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowNewRoutine((v) => !v)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium cursor-pointer"
              >
                <Plus size={13} /> Routine
              </button>
            </div>

            {showNewRoutine && (
              <form
                onSubmit={handleCreateRoutine}
                className="tempo-card rounded-2xl p-3.5 flex flex-col sm:flex-row gap-2"
              >
                <input
                  autoFocus
                  type="text"
                  required
                  value={rtTitle}
                  onChange={(e) => setRtTitle(e.target.value)}
                  placeholder="Nom de la routine (ex. Upper Body Force)"
                  className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                />
                <select
                  value={rtFocus}
                  onChange={(e) => setRtFocus(e.target.value as WorkoutFocus)}
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                >
                  {WORKOUT_FOCUSES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  Créer
                </button>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {/* LIVE AI GHOST PREVIEW ROUTINES */}
              {draftActions
                .filter((d) => d.action.kind === 'create_workout_routine')
                .map((draft) => {
                  if (draft.action.kind !== 'create_workout_routine') return null;
                  const rt = draft.action.payload;
                  return (
                    <div
                      key={draft.id}
                      className="rounded-3xl border-2 border-dashed border-violet-400 dark:border-violet-600 bg-violet-50/60 dark:bg-violet-950/30 p-4 flex flex-col justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 text-white px-2.5 py-0.5 text-[10px] font-semibold">
                            <Sparkles size={10} /> Aperçu IA · {rt.focus}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold mt-2">{rt.title}</h3>
                        <p className="text-[11px] text-slate-600 dark:text-zinc-300 mt-1">
                          {rt.exercises.map((e) => e.name).join(' · ')}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => applyDraftAction(draft.id)}
                          className="flex-1 rounded-xl bg-emerald-600 text-white py-2 text-xs font-semibold cursor-pointer"
                        >
                          Appliquer
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissDraftAction(draft.id)}
                          className="rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs text-slate-500 cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}

              {state.workoutRoutines.map((rt) => (
                <div key={rt.id} className="tempo-card rounded-3xl p-4 flex flex-col justify-between gap-3.5">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 text-[10px] font-semibold">
                        {rt.focus}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteRoutine(rt.id)}
                        className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 mt-2">
                      {rt.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 line-clamp-2">
                      {rt.exercises.length > 0
                        ? rt.exercises.map((e) => e.name).join(' · ')
                        : 'Aucun exercice — ajoute-les en live'}
                    </p>

                    {/* Cross-App Music Link */}
                    {state.musicTracks.length > 0 && (
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <Disc3 size={11} className="text-fuchsia-500 shrink-0" />
                        <select
                          value={rt.linkedTrackId || ''}
                          onChange={(e) =>
                            updateRoutine(rt.id, { linkedTrackId: e.target.value || undefined })
                          }
                          className="bg-transparent text-[11px] text-slate-500 dark:text-zinc-400 outline-none cursor-pointer truncate max-w-full"
                        >
                          <option value="">Son de séance…</option>
                          {state.musicTracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800/80">
                    <button
                      type="button"
                      onClick={() => startFromRoutine(rt)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-2 text-xs font-semibold hover:opacity-90 transition cursor-pointer"
                    >
                      <Play size={12} fill="currentColor" /> Démarrer
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenQuickAdd({ mode: 'sport', date: today })}
                      title="Planifier dans l'agenda"
                      className="rounded-xl border border-slate-200 dark:border-zinc-800 p-2 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                    >
                      <CalendarPlus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Workout History */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              Séances planifiées & historique
            </h2>
            <div className="space-y-2.5">
              {sortedWorkouts.map((w) => {
                const doneSets = w.exercises.flatMap((e) => e.sets).filter((s) => s.done).length;
                const totalSets = w.exercises.flatMap((e) => e.sets).length;
                return (
                  <div
                    key={w.id}
                    className="tempo-card rounded-2xl p-4 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                          w.completed
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {w.completed ? <Check size={16} /> : <Dumbbell size={16} />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {w.title}
                          </h3>
                          {w.prCount ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[10px] font-semibold">
                              <Trophy size={10} /> {w.prCount} PR
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                          <span>{formatShortDateFR(w.date)}</span>
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Clock size={11} /> {w.durationMin} min
                          </span>
                          {w.totalVolumeKg ? (
                            <span className="font-mono">{w.totalVolumeKg} kg</span>
                          ) : (
                            <span className="font-mono">
                              {doneSets}/{totalSets} séries
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => startActiveWorkout(w)}
                        className="rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500/20 cursor-pointer"
                      >
                        {w.completed ? 'Revoir' : 'Lancer'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteWorkout(w.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ================== NUTRITION TAB ================== */}
      {subTab === 'nutrition' && (
        <div className="space-y-5">
          {/* Free-Text + Photo AI Meal Logger */}
          <form
            onSubmit={handleFreeTextMeal}
            className="tempo-card rounded-2xl p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
          >
            <div className="flex items-center gap-2 flex-1 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 px-3 py-2">
              <Sparkles size={14} className="text-emerald-500 shrink-0" />
              <input
                type="text"
                value={freeMealText}
                onChange={(e) => setFreeMealText(e.target.value)}
                placeholder="Log rapide : « 200g poulet, 120g riz, 1 banane »…"
                className="w-full bg-transparent text-xs outline-none"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <button
                type="button"
                onClick={() => setMealPhotoOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold hover:opacity-92 transition cursor-pointer whitespace-nowrap"
              >
                <Camera size={13} /> Photo IA
              </button>
              <select
                value={freeMealSlot}
                onChange={(e) => setFreeMealSlot(e.target.value as MealSlot)}
                className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 text-xs"
              >
                {Object.entries(MEAL_SLOT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-xs font-semibold hover:bg-emerald-700 cursor-pointer whitespace-nowrap"
              >
                Estimer & Ajouter
              </button>
            </div>
          </form>

          {/* Date + Objectifs Nutrition + Manual Add */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={nutritionDate}
                onChange={(e) => setNutritionDate(e.target.value)}
                className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowNutritionGoals((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium cursor-pointer transition ${
                  showNutritionGoals
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border-transparent'
                    : 'border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300'
                }`}
              >
                <SlidersHorizontal size={12} /> Objectifs macros
              </button>
            </div>
            <button
              type="button"
              onClick={() => onOpenQuickAdd({ mode: 'repas', date: nutritionDate })}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3.5 py-2 text-xs font-semibold cursor-pointer"
            >
              <Plus size={14} /> Saisie précise
            </button>
          </div>

          {/* Domain-Specific Nutrition Goals Panel */}
          {showNutritionGoals && (
            <div className="tempo-card rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {(
                [
                  ['calories', 'Calories', goals.calories],
                  ['protein', 'Protéines (g)', goals.protein],
                  ['carbs', 'Glucides (g)', goals.carbs],
                  ['fat', 'Lipides (g)', goals.fat],
                  ['waterMl', 'Eau (ml)', goals.waterMl],
                ] as const
              ).map(([field, label, val]) => (
                <div key={field}>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">{label}</label>
                  <input
                    type="number"
                    value={val}
                    onChange={(e) =>
                      updatePreferences({
                        nutritionGoals: {
                          ...goals,
                          [field]: Math.max(0, Number(e.target.value) || 0),
                        },
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Macro Overview */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-8 tempo-card rounded-3xl p-5 flex flex-col sm:flex-row items-center gap-6">
              <div className="flex items-center gap-4 shrink-0">
                <ProgressRing
                  value={(totals.calories / Math.max(1, goals.calories)) * 100}
                  size={84}
                  strokeWidth={6}
                  colorClass="stroke-emerald-500"
                />
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Flame size={12} className="text-emerald-500" /> Calories
                  </p>
                  <p className="font-mono text-2xl font-semibold tabular-nums">{totals.calories}</p>
                  <p className="font-mono text-xs text-slate-400">sur {goals.calories} kcal</p>
                </div>
              </div>

              <div className="flex-1 w-full space-y-3">
                {[
                  { label: 'Protéines', val: totals.protein, goal: goals.protein, bar: 'bg-indigo-500' },
                  { label: 'Glucides', val: totals.carbs, goal: goals.carbs, bar: 'bg-amber-500' },
                  { label: 'Lipides', val: totals.fat, goal: goals.fat, bar: 'bg-rose-500' },
                ].map((m) => (
                  <div key={m.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-600 dark:text-zinc-300">{m.label}</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        <strong className="text-slate-900 dark:text-zinc-100">{m.val}g</strong> / {m.goal}g
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${m.bar}`}
                        style={{ width: `${Math.min(100, (m.val / Math.max(1, m.goal)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-4 tempo-card rounded-3xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <Droplets size={14} className="text-sky-500" /> Hydratation
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {Math.round((waterMl / Math.max(1, goals.waterMl)) * 100)}%
                  </span>
                </div>
                <p className="font-mono text-2xl font-semibold tabular-nums mt-2">
                  {(waterMl / 1000).toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    / {(goals.waterMl / 1000).toFixed(1)} L
                  </span>
                </p>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden mt-2.5">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, (waterMl / Math.max(1, goals.waterMl)) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-4">
                <button
                  type="button"
                  onClick={() => addWater(nutritionDate, -250)}
                  className="rounded-xl bg-slate-100 dark:bg-zinc-800 py-2 font-mono text-xs cursor-pointer"
                >
                  -250
                </button>
                <button
                  type="button"
                  onClick={() => addWater(nutritionDate, 250)}
                  className="rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300 py-2 font-mono text-xs font-semibold cursor-pointer"
                >
                  +250 ml
                </button>
                <button
                  type="button"
                  onClick={() => addWater(nutritionDate, 500)}
                  className="rounded-xl bg-sky-600 text-white py-2 font-mono text-xs font-semibold cursor-pointer"
                >
                  +500 ml
                </button>
              </div>
            </div>
          </div>

          {/* 1-Tap Favorites */}
          <div className="tempo-card rounded-3xl p-5">
            <p className="text-xs font-semibold mb-3">Ajout 1 clic · Favoris</p>
            <div className="flex flex-wrap gap-2">
              {state.mealPresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    addMeal({
                      date: nutritionDate,
                      slot: p.slot,
                      name: p.name,
                      calories: p.calories,
                      protein: p.protein,
                      carbs: p.carbs,
                      fat: p.fat,
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 px-3.5 py-2 text-left hover:border-emerald-400 transition cursor-pointer"
                >
                  <Plus size={13} className="text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-xs font-medium">{p.name}</p>
                    <p className="font-mono text-[10px] text-slate-400">
                      {p.calories} kcal · {p.protein}g P
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Meals by Slot */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(['petit-dej', 'dejeuner', 'collation', 'diner'] as MealSlot[]).map((slotKey) => {
              const items = dayMeals.filter((m) => m.slot === slotKey);
              const slotKcal = items.reduce((s, m) => s + m.calories, 0);
              return (
                <div key={slotKey} className="tempo-card rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {MEAL_SLOT_LABELS[slotKey]}
                    </h3>
                    <span className="font-mono text-xs text-slate-400">{slotKcal} kcal</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">Rien d’enregistré</p>
                  ) : (
                    <div className="space-y-2">
                      {items.map((m) => (
                        <div
                          key={m.id}
                          className="group flex items-center justify-between gap-2 rounded-xl bg-slate-50/70 dark:bg-zinc-900/60 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{m.name}</p>
                            <p className="font-mono text-[10px] text-slate-400">
                              {m.calories} kcal · P {m.protein}g · G {m.carbs}g · L {m.fat}g
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteMeal(m.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================== CORPS & POIDS TAB ================== */}
      {subTab === 'poids' && (
        <div className="space-y-6">
          {/* Visual Body Evolution (Day 1 baseline + weekly check-ins + Avant/Après slider) */}
          <BodyEvolutionSection />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Actuel</p>
              <p className="font-mono text-2xl font-semibold tabular-nums mt-1">
                {latestWeight ? latestWeight.weightKg.toFixed(1) : '—'}
                <span className="text-xs font-normal text-slate-400 ml-1">kg</span>
              </p>
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-400">Objectif</p>
                <button
                  type="button"
                  onClick={() => {
                    setWeightGoalDraft(String(state.preferences.weightGoalKg));
                    setEditingWeightGoal((v) => !v);
                  }}
                  className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  {editingWeightGoal ? 'Fermer' : 'Modifier'}
                </button>
              </div>
              {editingWeightGoal ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const parsed = parseFloat(weightGoalDraft.replace(',', '.'));
                    if (!isNaN(parsed) && parsed > 25 && parsed < 250) {
                      updatePreferences({ weightGoalKg: Math.round(parsed * 10) / 10 });
                      notify(`Objectif poids : ${parsed.toFixed(1)} kg`);
                    }
                    setEditingWeightGoal(false);
                  }}
                  className="flex items-center gap-1 mt-1"
                >
                  <input
                    autoFocus
                    type="number"
                    step="0.1"
                    value={weightGoalDraft}
                    onChange={(e) => setWeightGoalDraft(e.target.value)}
                    className="w-20 rounded-lg border border-emerald-400 bg-slate-50 dark:bg-zinc-900 px-2 py-1 font-mono text-sm font-semibold"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-600 text-white px-2 py-1 text-[11px] font-semibold cursor-pointer"
                  >
                    OK
                  </button>
                </form>
              ) : (
                <p className="font-mono text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                  {state.preferences.weightGoalKg.toFixed(1)}
                  <span className="text-xs font-normal opacity-70 ml-1">kg</span>
                </p>
              )}
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Écart</p>
              <p className="font-mono text-2xl font-semibold tabular-nums mt-1">
                {toGoal !== null ? `${toGoal > 0 ? '+' : ''}${toGoal.toFixed(1)}` : '—'}
                <span className="text-xs font-normal text-slate-400 ml-1">kg</span>
              </p>
            </div>
            <div className="tempo-card rounded-2xl p-4">
              <p className="text-[11px] text-slate-400">Évolution</p>
              <p className="font-mono text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                {totalDelta !== null ? `${totalDelta > 0 ? '+' : ''}${totalDelta.toFixed(1)}` : '—'}
                <span className="text-xs font-normal opacity-60 ml-1">kg</span>
              </p>
            </div>
          </div>

          <div className="tempo-card rounded-3xl p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Courbe de poids</h2>
              <span className="text-[11px] text-slate-400">Survoler un point</span>
            </div>
            <WeightChart entries={sortedWeights} goalKg={state.preferences.weightGoalKg} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <form
              onSubmit={handleInlineWeight}
              className="md:col-span-5 tempo-card rounded-3xl p-5 space-y-3 self-start"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Nouvelle pesée
              </h3>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="30"
                  max="250"
                  required
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  placeholder={latestWeight ? latestWeight.weightKg.toFixed(1) : '73.0'}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 font-mono text-base font-semibold"
                />
                <span className="text-xs text-slate-400">kg</span>
              </div>
              <input
                type="text"
                value={weightNote}
                onChange={(e) => setWeightNote(e.target.value)}
                placeholder="Note (ex. À jeun)"
                className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2 text-xs"
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-emerald-600 text-white py-2.5 text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
              >
                Enregistrer la pesée
              </button>
            </form>

            <div className="md:col-span-7 tempo-card rounded-3xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                Historique
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-zinc-800/80 max-h-60 overflow-y-auto">
                {[...sortedWeights].reverse().map((entry) => (
                  <div key={entry.id} className="group flex items-center justify-between py-2.5 first:pt-0">
                    <div>
                      <p className="text-xs font-medium">{formatShortDateFR(entry.date)}</p>
                      {entry.note && <p className="text-[11px] text-slate-400">{entry.note}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {entry.weightKg.toFixed(1)} kg
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteWeight(entry.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Meal Photo Analyzer Modal */}
      <MealPhotoAnalyzerModal
        open={mealPhotoOpen}
        date={nutritionDate}
        defaultSlot={freeMealSlot}
        onClose={() => setMealPhotoOpen(false)}
      />

      {/* Monthly Showcase Modal (Training, Load Progression, Nutrition, Weight, Body Photos) */}
      <MonthlyShowcaseModal
        open={showcaseOpen}
        onClose={() => setShowcaseOpen(false)}
        onJumpToPhotos={() => setSubTab('poids')}
      />
    </div>
  );
}
