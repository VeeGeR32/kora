import type { EventType, MealSlot, Priority, TrackMood, TrackStatus, WorkoutFocus } from '../types';

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

export const TRACK_PIPELINE_ORDER: TrackStatus[] = [
  'brouillon',
  'squelette',
  'maquette',
  'rec-final',
  'pre-mix',
  'masterise',
];

export const TRACK_STATUS_META: Record<
  TrackStatus,
  {
    step: 0 | 1 | 2 | 3 | 4 | 5;
    label: string;
    shortLabel: string;
    hint: string;
    badge: string;
    dot: string;
  }
> = {
  brouillon: {
    step: 0,
    label: 'v0 - Brouillon',
    shortLabel: 'v0 - Brouillon',
    hint: 'Idée brute ou structure en cours (squelette pas encore complet)',
    badge: 'bg-zinc-500/12 text-zinc-500 dark:text-zinc-400',
    dot: 'bg-zinc-400',
  },
  squelette: {
    step: 1,
    label: 'v1 - Squelette',
    shortLabel: 'v1 - Squelette',
    hint: '100 % de la structure écrite, balises [FIX] autorisées',
    badge: 'bg-slate-500/12 text-slate-700 dark:text-zinc-200',
    dot: 'bg-slate-400',
  },
  maquette: {
    step: 2,
    label: 'v2 - Maquette',
    shortLabel: 'v2 - Maquette',
    hint: 'Prise témoin pour valider placement et souffle',
    badge: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  'rec-final': {
    step: 3,
    label: 'v3 - Rec',
    shortLabel: 'v3 - Rec',
    hint: 'Prises définitives verrouillées, paroles figées',
    badge: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  'pre-mix': {
    step: 4,
    label: 'v4 - Pré-mix',
    shortLabel: 'v4 - Pré-mix',
    hint: "Balance et nettoyage prêts pour l'harmonisation",
    badge: 'bg-[#8C271E]/12 text-[#8C271E] dark:text-[#E56B5F]',
    dot: 'bg-[#8C271E]',
  },
  masterise: {
    step: 5,
    label: 'v5 - Master',
    shortLabel: 'v5 - Master',
    hint: 'Finalisé',
    badge: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
};

export function normalizeTrackStatus(raw?: string | null): TrackStatus {
  switch (raw) {
    case 'brouillon':
    case 'idee':
      return 'brouillon';
    case 'squelette':
    case 'ecriture':
      return 'squelette';
    case 'maquette':
    case 'demo':
      return 'maquette';
    case 'rec-final':
    case 'enregistrement':
      return 'rec-final';
    case 'pre-mix':
    case 'mix':
      return 'pre-mix';
    case 'masterise':
    case 'sorti':
      return 'masterise';
    default:
      return 'brouillon';
  }
}

export function isReadyForHarmonization(raw?: string | null): boolean {
  const st = normalizeTrackStatus(raw);
  return st === 'pre-mix' || st === 'masterise';
}

export const TRACK_MOOD_META: Record<
  TrackMood,
  { label: string; short: string; emoji: string; badge: string }
> = {
  energetic: {
    label: 'Énergique',
    short: 'Énergique',
    emoji: '⚡',
    badge: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  },
  chill: {
    label: 'Chill',
    short: 'Chill',
    emoji: '🌊',
    badge: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  },
  experimental: {
    label: 'Expérimental',
    short: 'Expé',
    emoji: '🧪',
    badge: 'bg-orange-500/12 text-orange-700 dark:text-orange-300',
  },
};

export const DEFAULT_HARMONIZATION_STEPS = [
  { id: 'harm-vocal', label: 'Chaîne vocale de référence (EQ, comp, reverb cohérents)', done: false },
  { id: 'harm-lufs', label: 'Cohérence LUFS, dynamique & niveau perçu entre tous les titres', done: false },
  { id: 'harm-trans', label: 'Transitions, silences et enchaînement de la tracklist finale', done: false },
  { id: 'harm-export', label: 'Export final WAV 24-bit + MP3 320 + écoute test (voiture / AirPods)', done: false },
];
