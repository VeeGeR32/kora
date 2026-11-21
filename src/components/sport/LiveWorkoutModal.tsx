import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Disc3,
  Pause,
  Play,
  Plus,
  Search,
  Timer,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import type { SetType, WorkoutExercise, WorkoutSession } from '../../types';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { sendKoraNotification } from '../../lib/notifications';
import { EXERCISE_LIBRARY } from '../../data/exercises';
import { todayISO, uid } from '../../utils/dates';

interface LiveWorkoutModalProps {
  sessionDraft: WorkoutSession | null;
  onClose: () => void;
  onFinish: (completedSession: WorkoutSession) => void;
}

function playBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // ignore audio restrictions
  }
}

function fmtSec(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function LiveWorkoutModal({ sessionDraft, onClose, onFinish }: LiveWorkoutModalProps) {
  const { state } = useApp();
  const player = useAudioPlayer();

  const [title, setTitle] = useState('');
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [notes, setNotes] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [restSec, setRestSec] = useState(0);
  const [restActive, setRestActive] = useState(false);

  // Exercise picker drawer
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchEx, setSearchEx] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('Tous');

  useEffect(() => {
    if (!sessionDraft) return;
    setTitle(sessionDraft.title);
    setExercises(sessionDraft.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) })));
    setNotes(sessionDraft.notes || '');
    setElapsedSec(0);
    setRestSec(0);
    setRestActive(false);
    setPickerOpen(false);
  }, [sessionDraft]);

  // Workout elapsed stopwatch
  useEffect(() => {
    if (!sessionDraft) return;
    const id = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [sessionDraft]);

  // Rest countdown
  useEffect(() => {
    if (!restActive) return;
    if (restSec <= 0) {
      setRestActive(false);
      playBeep();
      return;
    }
    const id = window.setInterval(() => {
      setRestSec((s) => {
        if (s <= 1) {
          setRestActive(false);
          playBeep();
          if (state.preferences.notifications?.enabled && state.preferences.notifications?.timers) {
            void sendKoraNotification({
              title: 'Repos terminé · Go série suivante !',
              body: 'Ton chrono de repos gym est à 0:00.',
              tag: 'kora-gym-rest',
            });
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [restActive, restSec]);

  // Historical bests per exercise name (for previous perf & PR detection)
  const historyByExercise = useMemo(() => {
    const map = new Map<string, { maxWeight: number; lastText: string }>();
    const past = [...state.workouts]
      .filter((w) => w.completed && w.id !== sessionDraft?.id)
      .sort((a, b) => b.date.localeCompare(a.date));

    for (const w of past) {
      for (const ex of w.exercises) {
        const key = ex.name.toLowerCase();
        const doneSets = ex.sets.filter((s) => s.done && s.type !== 'warmup');
        if (doneSets.length === 0) continue;
        const bestInSession = doneSets.reduce((m, s) => Math.max(m, s.weightKg), 0);
        const existing = map.get(key);
        if (!existing) {
          const topSet = doneSets.reduce((a, b) => (b.weightKg > a.weightKg ? b : a), doneSets[0]);
          map.set(key, {
            maxWeight: bestInSession,
            lastText: `${topSet.weightKg} kg × ${topSet.reps}`,
          });
        } else if (bestInSession > existing.maxWeight) {
          existing.maxWeight = bestInSession;
        }
      }
    }
    return map;
  }, [state.workouts, sessionDraft?.id]);

  const linkedTrack = useMemo(
    () => state.musicTracks.find((t) => t.id === sessionDraft?.linkedTrackId) || null,
    [state.musicTracks, sessionDraft?.linkedTrackId]
  );

  // Live metrics
  const { doneSetsCount, totalSetsCount, totalVolumeKg, prCount } = useMemo(() => {
    let done = 0;
    let total = 0;
    let vol = 0;
    let prs = 0;
    const prExercises = new Set<string>();

    for (const ex of exercises) {
      const hist = historyByExercise.get(ex.name.toLowerCase());
      for (const s of ex.sets) {
        total++;
        if (s.done) {
          done++;
          vol += s.weightKg * s.reps;
          if (hist && s.type !== 'warmup' && s.weightKg > hist.maxWeight && !prExercises.has(ex.name)) {
            prs++;
            prExercises.add(ex.name);
          }
        }
      }
    }
    return { doneSetsCount: done, totalSetsCount: total, totalVolumeKg: Math.round(vol), prCount: prs };
  }, [exercises, historyByExercise]);

  const toggleSet = (exId: string, setId: string, restDefault = 90) => {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id !== exId) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s) => {
            if (s.id !== setId) return s;
            const nextDone = !s.done;
            if (nextDone) {
              setRestSec(ex.restSeconds || restDefault);
              setRestActive(true);
            }
            return { ...s, done: nextDone };
          }),
        };
      })
    );
  };

  const updateSet = (
    exId: string,
    setId: string,
    patch: { weightKg?: number; reps?: number; type?: SetType }
  ) => {
    setExercises((prev) =>
      prev.map((ex) =>
        ex.id === exId
          ? { ...ex, sets: ex.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }
          : ex
      )
    );
  };

  const addSet = (exId: string) => {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id !== exId) return ex;
        const last = ex.sets[ex.sets.length - 1];
        return {
          ...ex,
          sets: [
            ...ex.sets,
            {
              id: uid('s'),
              weightKg: last ? last.weightKg : 20,
              reps: last ? last.reps : 10,
              done: false,
              type: 'normal',
            },
          ],
        };
      })
    );
  };

  const removeSet = (exId: string, setId: string) => {
    setExercises((prev) =>
      prev.map((ex) => (ex.id === exId ? { ...ex, sets: ex.sets.filter((s) => s.id !== setId) } : ex))
    );
  };

  const addExercise = (name: string, muscleGroup = 'Autre', restSeconds = 90) => {
    const clean = name.trim();
    if (!clean) return;
    const hist = historyByExercise.get(clean.toLowerCase());
    setExercises((prev) => [
      ...prev,
      {
        id: uid('ex'),
        name: clean,
        muscleGroup,
        restSeconds,
        sets: [
          { id: uid('s'), reps: 10, weightKg: hist ? hist.maxWeight : 20, done: false, type: 'normal' },
          { id: uid('s'), reps: 10, weightKg: hist ? hist.maxWeight : 20, done: false, type: 'normal' },
          { id: uid('s'), reps: 10, weightKg: hist ? hist.maxWeight : 20, done: false, type: 'normal' },
        ],
      },
    ]);
    setPickerOpen(false);
    setSearchEx('');
  };

  const handleFinish = () => {
    if (!sessionDraft) return;
    onFinish({
      ...sessionDraft,
      title: title.trim() || sessionDraft.title,
      date: sessionDraft.date || todayISO(),
      durationMin: Math.max(1, Math.round(elapsedSec / 60)),
      completed: true,
      exercises,
      notes: notes.trim() || undefined,
      totalVolumeKg,
      prCount,
    });
  };

  const muscles = ['Tous', ...Array.from(new Set(EXERCISE_LIBRARY.map((e) => e.muscleGroup)))];
  const filteredLib = EXERCISE_LIBRARY.filter(
    (e) =>
      (muscleFilter === 'Tous' || e.muscleGroup === muscleFilter) &&
      (!searchEx.trim() || e.name.toLowerCase().includes(searchEx.toLowerCase()))
  );

  const cycleSetType = (t?: SetType): SetType =>
    t === 'warmup' ? 'normal' : t === 'failure' ? 'warmup' : 'failure';

  return (
    <AnimatePresence>
      {sessionDraft && (
        <div className="fixed inset-0 z-50 bg-[var(--bg)] flex flex-col">
          {/* Sticky Top Live Workout Bar (Hevy Style) */}
          <header className="shrink-0 bg-white/95 dark:bg-[#111114]/95 backdrop-blur-md border-b border-slate-200/80 dark:border-zinc-800 px-4 py-3">
            <div className="max-w-2xl mx-auto space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                  title="Quitter sans enregistrer"
                >
                  <X size={18} />
                </button>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="flex-1 text-center font-semibold text-sm sm:text-base bg-transparent outline-none truncate"
                />
                <button
                  type="button"
                  onClick={handleFinish}
                  className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-xs font-semibold hover:bg-emerald-700 active:scale-[0.98] transition cursor-pointer"
                >
                  Terminer
                </button>
              </div>

              {/* Live Metrics Strip */}
              <div className="grid grid-cols-3 gap-2 text-center bg-slate-50 dark:bg-zinc-900/70 rounded-xl py-2 px-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Durée</p>
                  <p className="font-mono text-xs sm:text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmtSec(elapsedSec)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Volume</p>
                  <p className="font-mono text-xs sm:text-sm font-semibold tabular-nums">
                    {totalVolumeKg.toLocaleString('fr-FR')} kg
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Séries</p>
                  <p className="font-mono text-xs sm:text-sm font-semibold tabular-nums flex items-center justify-center gap-1">
                    {doneSetsCount}/{totalSetsCount}
                    {prCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-amber-500 text-[10px]">
                        <Trophy size={10} /> {prCount}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Linked Music Track Quick Pill */}
              {linkedTrack && (
                <div className="flex items-center justify-between rounded-xl bg-fuchsia-500/10 px-3 py-1.5 text-xs">
                  <span className="flex items-center gap-2 text-fuchsia-700 dark:text-fuchsia-300 font-medium truncate">
                    <Disc3 size={13} />
                    Prod séance : {linkedTrack.title}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      player.currentTrack?.id === linkedTrack.id
                        ? player.togglePlay()
                        : void player.playTrack(linkedTrack)
                    }
                    className="rounded-lg bg-fuchsia-600 text-white px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    {player.currentTrack?.id === linkedTrack.id && player.isPlaying ? (
                      <>
                        <Pause size={11} /> Pause
                      </>
                    ) : (
                      <>
                        <Play size={11} /> Lancer
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </header>

          {/* Auto Rest Timer Banner */}
          <AnimatePresence>
            {restActive && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="shrink-0 bg-emerald-600 text-white px-4 py-2.5"
              >
                <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Timer size={16} />
                    <span className="text-xs font-medium opacity-90">Repos</span>
                    <span className="font-mono text-lg font-bold tabular-nums">{fmtSec(restSec)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRestSec((s) => Math.max(5, s - 15))}
                      className="rounded-lg bg-white/15 px-2.5 py-1 font-mono text-xs hover:bg-white/25 cursor-pointer"
                    >
                      -15s
                    </button>
                    <button
                      type="button"
                      onClick={() => setRestSec((s) => s + 15)}
                      className="rounded-lg bg-white/15 px-2.5 py-1 font-mono text-xs hover:bg-white/25 cursor-pointer"
                    >
                      +15s
                    </button>
                    <button
                      type="button"
                      onClick={() => setRestActive(false)}
                      className="rounded-lg bg-white text-emerald-700 px-3 py-1 text-xs font-semibold cursor-pointer"
                    >
                      Passer
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Exercises Scroll Area */}
          <div className="flex-1 overflow-y-auto px-4 py-5 pb-28">
            <div className="max-w-2xl mx-auto space-y-4">
              {exercises.length === 0 ? (
                <div className="tempo-card rounded-3xl p-10 text-center space-y-3">
                  <p className="text-sm font-medium text-slate-500 dark:text-zinc-400">
                    Séance vide prête — ajoute ton premier exercice !
                  </p>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-5 py-2.5 text-xs font-semibold cursor-pointer"
                  >
                    <Plus size={15} /> Ajouter un exercice
                  </button>
                </div>
              ) : (
                exercises.map((ex) => {
                  const hist = historyByExercise.get(ex.name.toLowerCase());
                  return (
                    <div key={ex.id} className="tempo-card rounded-3xl p-4 sm:p-5 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-zinc-100">
                            {ex.name}
                          </h3>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                            {ex.muscleGroup && <span>{ex.muscleGroup}</span>}
                            {hist && (
                              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                                · Préc. {hist.lastText}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <select
                            value={ex.restSeconds || 90}
                            onChange={(e) =>
                              setExercises((prev) =>
                                prev.map((x) =>
                                  x.id === ex.id ? { ...x, restSeconds: Number(e.target.value) } : x
                                )
                              )
                            }
                            className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2 py-1 font-mono text-[11px] text-slate-600 dark:text-zinc-300"
                            title="Temps de repos"
                          >
                            <option value={45}>45s</option>
                            <option value={60}>60s</option>
                            <option value={75}>75s</option>
                            <option value={90}>90s</option>
                            <option value={120}>120s</option>
                            <option value={150}>150s</option>
                            <option value={180}>180s</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => setExercises((prev) => prev.filter((x) => x.id !== ex.id))}
                            className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Table Header */}
                      <div className="grid grid-cols-[36px_1fr_1fr_42px_28px] gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1">
                        <span className="text-center">Série</span>
                        <span className="text-center">Poids (kg)</span>
                        <span className="text-center">Reps</span>
                        <span className="text-center">OK</span>
                        <span />
                      </div>

                      {/* Sets */}
                      <div className="space-y-1.5">
                        {ex.sets.map((s, idx) => {
                          const isPR =
                            s.done &&
                            s.type !== 'warmup' &&
                            hist &&
                            s.weightKg > hist.maxWeight;
                          return (
                            <div
                              key={s.id}
                              className={`grid grid-cols-[36px_1fr_1fr_42px_28px] items-center gap-2 rounded-xl px-1.5 py-1.5 transition ${
                                s.done
                                  ? 'bg-emerald-500/12 dark:bg-emerald-950/40'
                                  : 'bg-slate-50/80 dark:bg-zinc-900/60'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => updateSet(ex.id, s.id, { type: cycleSetType(s.type) })}
                                title="Cliquer pour changer : Normale / Échec (F) / Échauffement (W)"
                                className={`h-7 rounded-lg font-mono text-xs font-bold cursor-pointer ${
                                  s.type === 'warmup'
                                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                    : s.type === 'failure'
                                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                    : 'text-slate-500 dark:text-zinc-400'
                                }`}
                              >
                                {s.type === 'warmup' ? 'W' : s.type === 'failure' ? 'F' : idx + 1}
                              </button>

                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={s.weightKg}
                                onChange={(e) =>
                                  updateSet(ex.id, s.id, { weightKg: parseFloat(e.target.value) || 0 })
                                }
                                className="w-full rounded-lg border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-1.5 text-center font-mono text-sm font-semibold tabular-nums focus:outline-none focus:border-emerald-500"
                              />

                              <input
                                type="number"
                                min="1"
                                value={s.reps}
                                onChange={(e) =>
                                  updateSet(ex.id, s.id, { reps: parseInt(e.target.value, 10) || 1 })
                                }
                                className="w-full rounded-lg border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-1.5 text-center font-mono text-sm font-semibold tabular-nums focus:outline-none focus:border-emerald-500"
                              />

                              <button
                                type="button"
                                onClick={() => toggleSet(ex.id, s.id, ex.restSeconds || 90)}
                                className={`h-8 w-full rounded-xl flex items-center justify-center transition active:scale-90 cursor-pointer ${
                                  s.done
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-400'
                                }`}
                              >
                                {isPR ? <Trophy size={14} /> : <Check size={15} strokeWidth={3} />}
                              </button>

                              <button
                                type="button"
                                onClick={() => removeSet(ex.id, s.id)}
                                className="p-1 text-slate-300 dark:text-zinc-600 hover:text-rose-500 cursor-pointer"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => addSet(ex.id)}
                        className="w-full rounded-xl bg-slate-100/90 dark:bg-zinc-800/80 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-700 transition cursor-pointer"
                      >
                        + Ajouter une série
                      </button>
                    </div>
                  );
                })
              )}

              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="w-full rounded-2xl border-2 border-dashed border-slate-200 dark:border-zinc-800 py-3.5 text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600 transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus size={15} /> Ajouter un exercice
              </button>

              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes de séance (sensations, fatigue, PR…)"
                className="w-full rounded-2xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5 text-xs outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Exercise Picker Bottom Sheet */}
          <AnimatePresence>
            {pickerOpen && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setPickerOpen(false)}
                  className="fixed inset-0 bg-black/50 backdrop-blur-xs"
                />
                <motion.div
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 40, opacity: 0 }}
                  className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#141418] border border-slate-200 dark:border-zinc-800 p-5 max-h-[80vh] flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Ajouter un exercice</h3>
                    <button
                      type="button"
                      onClick={() => setPickerOpen(false)}
                      className="p-1.5 text-slate-400 cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2">
                    <Search size={14} className="text-slate-400" />
                    <input
                      autoFocus
                      type="text"
                      value={searchEx}
                      onChange={(e) => setSearchEx(e.target.value)}
                      placeholder="Rechercher ou créer un exercice…"
                      className="flex-1 bg-transparent text-xs outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {muscles.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMuscleFilter(m)}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                          muscleFilter === m
                            ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-1">
                    {searchEx.trim() && (
                      <button
                        type="button"
                        onClick={() => addExercise(searchEx.trim(), 'Perso', 90)}
                        className="w-full text-left rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-2.5 text-xs font-semibold cursor-pointer"
                      >
                        + Créer « {searchEx.trim()} »
                      </button>
                    )}
                    {filteredLib.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => addExercise(item.name, item.muscleGroup, item.defaultRestSec)}
                        className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-zinc-800/70 transition text-left cursor-pointer"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                            {item.name}
                          </p>
                          <p className="text-[10px] text-slate-400">{item.muscleGroup}</p>
                        </div>
                        <span className="font-mono text-[10px] text-slate-400">
                          {item.defaultRestSec}s
                        </span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      )}
    </AnimatePresence>
  );
}
