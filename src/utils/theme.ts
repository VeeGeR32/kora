import type { EventType, MealSlot, Priority, TrackStatus, WorkoutFocus } from '../types';

export const EVENT_STYLES: Record<
  EventType,
  {
    label: string;
    dot: string;
    pill: string;
    block: string;
    borderLeft: string;
    text: string;
  }
> = {
  cours: {
    label: 'Cours',
    dot: 'bg-indigo-500',
    pill: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20',
    block:
      'bg-indigo-50/90 dark:bg-indigo-950/55 border-indigo-200/80 dark:border-indigo-800/60 text-indigo-950 dark:text-indigo-100',
    borderLeft: 'border-l-indigo-500',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
  eval: {
    label: 'Éval',
    dot: 'bg-violet-500',
    pill: 'bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/25',
    block:
      'bg-violet-50/95 dark:bg-violet-950/60 border-violet-200/90 dark:border-violet-800/65 text-violet-950 dark:text-violet-100',
    borderLeft: 'border-l-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
  },
  sport: {
    label: 'Sport',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    block:
      'bg-emerald-50/90 dark:bg-emerald-950/55 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-950 dark:text-emerald-100',
    borderLeft: 'border-l-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  rdv: {
    label: 'RDV',
    dot: 'bg-rose-500',
    pill: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
    block:
      'bg-rose-50/90 dark:bg-rose-950/55 border-rose-200/80 dark:border-rose-800/60 text-rose-950 dark:text-rose-100',
    borderLeft: 'border-l-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
  },
  music: {
    label: 'Music',
    dot: 'bg-fuchsia-500',
    pill: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/20',
    block:
      'bg-fuchsia-50/90 dark:bg-fuchsia-950/55 border-fuchsia-200/80 dark:border-fuchsia-800/60 text-fuchsia-950 dark:text-fuchsia-100',
    borderLeft: 'border-l-fuchsia-500',
    text: 'text-fuchsia-600 dark:text-fuchsia-400',
  },
};

export const PRIORITY_STYLES: Record<Priority, { label: string; dot: string; badge: string }> = {
  high: {
    label: 'Urgent',
    dot: 'bg-rose-500',
    badge: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
  },
  medium: {
    label: 'Normal',
    dot: 'bg-amber-500',
    badge: 'text-amber-700 dark:text-amber-300 bg-amber-500/10',
  },
  low: {
    label: 'Bas',
    dot: 'bg-slate-400',
    badge: 'text-slate-600 dark:text-slate-400 bg-slate-500/10',
  },
};

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  'petit-dej': 'Petit-déjeuner',
  dejeuner: 'Déjeuner',
  collation: 'Collation',
  diner: 'Dîner',
};

export const WORKOUT_FOCUSES: WorkoutFocus[] = [
  'Push',
  'Pull',
  'Legs',
  'Upper',
  'Lower',
  'Full Body',
  'Cardio',
  'Autre',
];

export const TRACK_STATUS_META: Record<TrackStatus, { label: string; badge: string }> = {
  idee: { label: 'Idée', badge: 'bg-slate-500/12 text-slate-600 dark:text-zinc-300' },
  demo: { label: 'Démo', badge: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
  ecriture: { label: 'Écriture', badge: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  enregistrement: { label: 'Rec', badge: 'bg-rose-500/12 text-rose-700 dark:text-rose-300' },
  mix: { label: 'Mix / Master', badge: 'bg-violet-500/12 text-violet-700 dark:text-violet-300' },
  sorti: { label: 'Sorti', badge: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
};
