import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  CalendarClock,
  CheckSquare,
  Disc3,
  Dumbbell,
  GraduationCap,
  Scale,
  Sparkles,
  Utensils,
  X,
} from 'lucide-react';
import type { MealSlot, Priority, QuickAddMode, WorkoutFocus } from '../types';
import { useApp } from '../context/AppContext';
import {
  addMinutesToTime,
  getISOWeekday,
  todayISO,
  uid,
  WEEKDAY_SHORT_FR,
} from '../utils/dates';
import { MEAL_SLOT_LABELS, WORKOUT_FOCUSES } from '../utils/theme';

export interface QuickAddContext {
  mode?: QuickAddMode;
  date?: string;
  startTime?: string;
}

interface QuickAddModalProps {
  open: boolean;
  initial?: QuickAddContext;
  onClose: () => void;
}

const MODES: { id: QuickAddMode; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'cours', label: 'Cours', icon: BookOpen },
  { id: 'devoir', label: 'Devoir', icon: CheckSquare },
  { id: 'eval', label: 'Éval', icon: Sparkles },
  { id: 'sport', label: 'Sport', icon: Dumbbell },
  { id: 'music', label: 'Music', icon: Disc3 },
  { id: 'repas', label: 'Repas', icon: Utensils },
  { id: 'poids', label: 'Poids', icon: Scale },
  { id: 'rdv', label: 'RDV', icon: CalendarClock },
  { id: 'tache', label: 'Tâche', icon: GraduationCap },
];

export function QuickAddModal({ open, initial, onClose }: QuickAddModalProps) {
  const { addEvent, addHomework, addExam, addTask, addWorkout, addMeal, addWeight } = useApp();

  const [mode, setMode] = useState<QuickAddMode>(initial?.mode || 'cours');

  // Shared fields
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(initial?.date || todayISO());
  const [startTime, setStartTime] = useState(initial?.startTime || '09:00');
  const [endTime, setEndTime] = useState(addMinutesToTime(initial?.startTime || '09:00', 90));
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');

  // Cours recurrence
  const [recurringWeekly, setRecurringWeekly] = useState(true);
  const [recurringDays, setRecurringDays] = useState<number[]>([getISOWeekday(todayISO())]);

  // Eval Gemini Notebook
  const [geminiUrl, setGeminiUrl] = useState('https://notebooklm.google.com/');
  const [geminiTitle, setGeminiTitle] = useState('');
  const [topicsRaw, setTopicsRaw] = useState('');
  const [coefficient, setCoefficient] = useState('2');

  // Sport
  const [focus, setFocus] = useState<WorkoutFocus>('Push');
  const [durationMin, setDurationMin] = useState('60');

  // Repas
  const [slot, setSlot] = useState<MealSlot>('dejeuner');
  const [calories, setCalories] = useState('550');
  const [protein, setProtein] = useState('40');
  const [carbs, setCarbs] = useState('55');
  const [fat, setFat] = useState('15');

  // Poids
  const [weightKg, setWeightKg] = useState('73.0');

  // Tache category
  const [taskCat, setTaskCat] = useState<'perso' | 'rdv' | 'cours' | 'sport'>('perso');

  useEffect(() => {
    if (!open) return;
    const targetDate = initial?.date || todayISO();
    const targetStart = initial?.startTime || '09:00';
    setMode(initial?.mode || 'cours');
    setTitle('');
    setSubject('');
    setLocation('');
    setDate(targetDate);
    setStartTime(targetStart);
    setEndTime(addMinutesToTime(targetStart, 90));
    setNotes('');
    setPriority('medium');
    setRecurringWeekly(true);
    setRecurringDays([getISOWeekday(targetDate)]);
    setGeminiUrl('https://notebooklm.google.com/');
    setGeminiTitle('');
    setTopicsRaw('');
    setCoefficient('2');
    setFocus('Push');
    setDurationMin('60');
    setSlot('dejeuner');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
    setWeightKg('');
    setTaskCat('perso');
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const toggleDay = (d: number) => {
    setRecurringDays((prev) =>
      prev.includes(d) ? (prev.length > 1 ? prev.filter((x) => x !== d) : prev) : [...prev, d]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'cours') {
      if (!title.trim()) return;
      addEvent({
        type: 'cours',
        title: title.trim(),
        subject: subject.trim() || title.trim(),
        location: location.trim() || undefined,
        date,
        startTime,
        endTime,
        recurringWeekly,
        recurringDays: recurringWeekly ? recurringDays : undefined,
        notes: notes.trim() || undefined,
      });
    } else if (mode === 'rdv' || mode === 'music') {
      if (!title.trim()) return;
      addEvent({
        type: mode,
        title: title.trim(),
        location: location.trim() || (mode === 'music' ? 'Home Studio' : undefined),
        date,
        startTime,
        endTime,
        recurringWeekly: false,
        notes: notes.trim() || undefined,
      });
    } else if (mode === 'devoir') {
      if (!title.trim()) return;
      addHomework({
        title: title.trim(),
        subject: subject.trim() || 'Général',
        dueDate: date,
        priority,
        done: false,
        notes: notes.trim() || undefined,
      });
    } else if (mode === 'eval') {
      if (!title.trim()) return;
      const topics = topicsRaw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((label) => ({ id: uid('top'), label, done: false }));
      addExam({
        title: title.trim(),
        subject: subject.trim() || 'Matière',
        date,
        startTime,
        endTime,
        room: location.trim() || undefined,
        coefficient: Number(coefficient) || undefined,
        geminiNotebookUrl: geminiUrl.trim() || undefined,
        geminiNotebookTitle: geminiTitle.trim() || undefined,
        topics,
        notes: notes.trim() || undefined,
        done: false,
      });
    } else if (mode === 'sport') {
      const cleanTitle = title.trim() || `Séance ${focus}`;
      addWorkout({
        title: cleanTitle,
        date,
        startTime,
        durationMin: Number(durationMin) || 60,
        focus,
        completed: false,
        exercises: [],
        notes: notes.trim() || undefined,
      });
    } else if (mode === 'repas') {
      if (!title.trim()) return;
      addMeal({
        date,
        slot,
        name: title.trim(),
        calories: Math.max(0, Number(calories) || 0),
        protein: Math.max(0, Number(protein) || 0),
        carbs: Math.max(0, Number(carbs) || 0),
        fat: Math.max(0, Number(fat) || 0),
      });
    } else if (mode === 'poids') {
      const parsed = parseFloat(weightKg.replace(',', '.'));
      if (isNaN(parsed) || parsed <= 20 || parsed > 250) return;
      addWeight({
        date,
        weightKg: Math.round(parsed * 10) / 10,
        note: notes.trim() || undefined,
      });
    } else if (mode === 'tache') {
      if (!title.trim()) return;
      addTask({
        title: title.trim(),
        dueDate: date || undefined,
        category: taskCat,
        priority,
        done: false,
        notes: notes.trim() || undefined,
      });
    }

    onClose();
  };

  const inputCls =
    'w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/70 px-3.5 py-2.5 text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:focus:ring-zinc-100/20 focus:border-slate-400 dark:focus:border-zinc-600 transition';

  const labelCls = 'block text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/35 dark:bg-black/65 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#121215] border border-slate-200/80 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-zinc-800/80">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-zinc-100">
                  Ajout rapide
                </span>
                <span className="hidden sm:inline-flex items-center rounded-md bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:text-zinc-400">
                  ESC
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                <X size={17} />
              </button>
            </div>

            {/* Category Pills */}
            <div className="px-5 pt-3 pb-2">
              <div className="grid grid-cols-3 sm:grid-cols-3 gap-1.5">
                {MODES.map((m) => {
                  const Icon = m.icon;
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={`relative flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-medium transition cursor-pointer ${
                        active
                          ? 'text-white dark:text-zinc-950'
                          : 'text-slate-600 dark:text-zinc-400 bg-slate-50/80 dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/70'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="quickAddActivePill"
                          transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                          className="absolute inset-0 rounded-xl bg-slate-900 dark:bg-zinc-100"
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        <Icon size={13} />
                        {m.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 overflow-y-auto">
              {mode !== 'poids' && (
                <div>
                  <label className={labelCls}>
                    {mode === 'repas'
                      ? 'Nom du repas'
                      : mode === 'sport'
                      ? 'Nom de la séance'
                      : 'Titre'}
                  </label>
                  <input
                    autoFocus
                    type="text"
                    required={mode !== 'sport'}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      mode === 'cours'
                        ? 'Ex. Mathématiques — Algèbre'
                        : mode === 'devoir'
                        ? 'Ex. Exercices 1 à 5 p.42'
                        : mode === 'eval'
                        ? 'Ex. DS Physique Quantique'
                        : mode === 'sport'
                        ? `Ex. Séance ${focus} (optionnel)`
                        : mode === 'repas'
                        ? 'Ex. Poulet riz brocolis'
                        : mode === 'rdv'
                        ? 'Ex. Kiné / Médecin / Coiffeur'
                        : 'Ex. Appeler la banque'
                    }
                    className={inputCls}
                  />
                </div>
              )}

              {/* Subject + Location for Cours / Eval / Devoir */}
              {(mode === 'cours' || mode === 'eval' || mode === 'devoir') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Matière</label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Maths, Physique, Info..."
                      className={inputCls}
                    />
                  </div>
                  {(mode === 'cours' || mode === 'eval') && (
                    <div>
                      <label className={labelCls}>Salle / Lieu</label>
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Amphi B, Salle 204..."
                        className={inputCls}
                      />
                    </div>
                  )}
                  {mode === 'devoir' && (
                    <div>
                      <label className={labelCls}>Pour le</label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* RDV / Music Location */}
              {(mode === 'rdv' || mode === 'music') && (
                <div>
                  <label className={labelCls}>Lieu</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={mode === 'music' ? 'Home Studio, Cabine…' : 'Adresse, Google Meet…'}
                    className={inputCls}
                  />
                </div>
              )}

              {/* Date & Time row for Cours / Eval / RDV / Sport / Music */}
              {(mode === 'cours' || mode === 'eval' || mode === 'rdv' || mode === 'sport' || mode === 'music') && (
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className={labelCls}>Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className={`${inputCls} font-mono text-xs`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Début</label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => {
                        setStartTime(e.target.value);
                        setEndTime(addMinutesToTime(e.target.value, 90));
                      }}
                      className={`${inputCls} font-mono text-xs`}
                    />
                  </div>
                  {mode === 'sport' ? (
                    <div>
                      <label className={labelCls}>Durée (min)</label>
                      <input
                        type="number"
                        min={10}
                        max={240}
                        value={durationMin}
                        onChange={(e) => setDurationMin(e.target.value)}
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className={labelCls}>Fin</label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Recurring Weekly for Cours */}
              {mode === 'cours' && (
                <div className="rounded-xl border border-slate-200/80 dark:border-zinc-800 p-3 space-y-2.5 bg-slate-50/50 dark:bg-zinc-900/40">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Répéter chaque semaine
                    </span>
                    <input
                      type="checkbox"
                      checked={recurringWeekly}
                      onChange={(e) => setRecurringWeekly(e.target.checked)}
                      className="h-4 w-4 accent-indigo-600 rounded cursor-pointer"
                    />
                  </label>
                  {recurringWeekly && (
                    <div className="flex items-center justify-between gap-1 pt-1">
                      {WEEKDAY_SHORT_FR.map((dLabel, idx) => {
                        const isoDay = idx + 1;
                        const active = recurringDays.includes(isoDay);
                        return (
                          <button
                            key={dLabel}
                            type="button"
                            onClick={() => toggleDay(isoDay)}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                              active
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 border border-slate-200/80 dark:border-zinc-800'
                            }`}
                          >
                            {dLabel}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Eval Gemini Notebook Section */}
              {mode === 'eval' && (
                <div className="rounded-xl border border-violet-200/80 dark:border-violet-900/60 bg-violet-50/50 dark:bg-violet-950/25 p-3.5 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                    <Sparkles size={14} />
                    Notebook Gemini / NotebookLM
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="url"
                      value={geminiUrl}
                      onChange={(e) => setGeminiUrl(e.target.value)}
                      placeholder="https://notebooklm.google.com/..."
                      className={inputCls}
                    />
                    <input
                      type="text"
                      value={geminiTitle}
                      onChange={(e) => setGeminiTitle(e.target.value)}
                      placeholder="Nom du notebook (optionnel)"
                      className={inputCls}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="col-span-2">
                      <label className={labelCls}>Chapitres à réviser (1 par ligne)</label>
                      <textarea
                        rows={2}
                        value={topicsRaw}
                        onChange={(e) => setTopicsRaw(e.target.value)}
                        placeholder={'Chapitre 1\nChapitre 2\nAnnales'}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Coeff.</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={coefficient}
                        onChange={(e) => setCoefficient(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Sport Focus */}
              {mode === 'sport' && (
                <div>
                  <label className={labelCls}>Type de séance</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WORKOUT_FOCUSES.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFocus(f)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
                          focus === f
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Repas */}
              {mode === 'repas' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Moment</label>
                      <select
                        value={slot}
                        onChange={(e) => setSlot(e.target.value as MealSlot)}
                        className={inputCls}
                      >
                        {Object.entries(MEAL_SLOT_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Date</label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className={labelCls}>Kcal</label>
                      <input
                        type="number"
                        required
                        min="0"
                        value={calories}
                        onChange={(e) => setCalories(e.target.value)}
                        placeholder="550"
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Prot (g)</label>
                      <input
                        type="number"
                        min="0"
                        value={protein}
                        onChange={(e) => setProtein(e.target.value)}
                        placeholder="40"
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Gluc (g)</label>
                      <input
                        type="number"
                        min="0"
                        value={carbs}
                        onChange={(e) => setCarbs(e.target.value)}
                        placeholder="60"
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Lip (g)</label>
                      <input
                        type="number"
                        min="0"
                        value={fat}
                        onChange={(e) => setFat(e.target.value)}
                        placeholder="15"
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Poids */}
              {mode === 'poids' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Poids (kg)</label>
                    <input
                      autoFocus
                      type="number"
                      step="0.1"
                      min="30"
                      max="250"
                      required
                      value={weightKg}
                      onChange={(e) => setWeightKg(e.target.value)}
                      placeholder="72.8"
                      className={`${inputCls} font-mono text-base font-semibold`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className={`${inputCls} font-mono text-xs`}
                    />
                  </div>
                </div>
              )}

              {/* Priority for Devoir & Tache */}
              {(mode === 'devoir' || mode === 'tache') && (
                <div className="grid grid-cols-2 gap-3">
                  {mode === 'tache' && (
                    <div>
                      <label className={labelCls}>Échéance</label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                  )}
                  <div className={mode === 'devoir' ? 'col-span-2' : ''}>
                    <label className={labelCls}>Priorité</label>
                    <div className="flex gap-1.5">
                      {(['low', 'medium', 'high'] as Priority[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPriority(p)}
                          className={`flex-1 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                            priority === p
                              ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                              : 'bg-slate-100 dark:bg-zinc-800/80 text-slate-600 dark:text-zinc-400'
                          }`}
                        >
                          {p === 'high' ? 'Urgent' : p === 'medium' ? 'Normal' : 'Bas'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {mode === 'tache' && (
                <div>
                  <label className={labelCls}>Catégorie</label>
                  <div className="flex gap-1.5">
                    {(
                      [
                        ['perso', 'Perso'],
                        ['cours', 'Études'],
                        ['sport', 'Sport'],
                        ['rdv', 'Admin / RDV'],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTaskCat(k)}
                        className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                          taskCat === k
                            ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                            : 'bg-slate-100 dark:bg-zinc-800/80 text-slate-600 dark:text-zinc-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {mode !== 'repas' && (
                <div>
                  <label className={labelCls}>Note (optionnel)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      mode === 'poids'
                        ? 'Ex. À jeun, après entraînement...'
                        : 'Détail, rappel, matériel...'
                    }
                    className={inputCls}
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-5 py-2.5 text-xs font-semibold hover:opacity-90 active:scale-[0.98] transition cursor-pointer shadow-xs"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
