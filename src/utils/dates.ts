import type { AppState, CalendarOccurrence } from '../types';

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** ISO weekday: 1 = Lundi ... 7 = Dimanche */
export function getISOWeekday(iso: string): number {
  const d = parseISODate(iso).getDay();
  return d === 0 ? 7 : d;
}

export function getStartOfWeekISO(iso: string): string {
  const weekday = getISOWeekday(iso);
  return addDays(iso, -(weekday - 1));
}

export function getWeekDates(anchorISO: string): string[] {
  const start = getStartOfWeekISO(anchorISO);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function diffDays(fromISO: string, toISO: string): number {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(totalMin: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMin)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addMinutesToTime(hhmm: string, delta: number): string {
  return minutesToTime(timeToMinutes(hhmm) + delta);
}

export function formatLongDateFR(iso: string): string {
  const d = parseISODate(iso);
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function formatShortDateFR(iso: string): string {
  const today = todayISO();
  const delta = diffDays(today, iso);
  if (delta === 0) return "Aujourd'hui";
  if (delta === 1) return 'Demain';
  if (delta === -1) return 'Hier';
  const d = parseISODate(iso);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

export function formatCountdownBadge(iso: string): { label: string; urgent: boolean; past: boolean } {
  const delta = diffDays(todayISO(), iso);
  if (delta < 0) return { label: `Passé (${Math.abs(delta)}j)`, urgent: false, past: true };
  if (delta === 0) return { label: "Aujourd'hui", urgent: true, past: false };
  if (delta === 1) return { label: 'Demain', urgent: true, past: false };
  if (delta <= 3) return { label: `J-${delta}`, urgent: true, past: false };
  return { label: `J-${delta}`, urgent: false, past: false };
}

export function formatDurationLabel(startTime: string, endTime: string): string {
  const mins = Math.max(15, timeToMinutes(endTime) - timeToMinutes(startTime));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function formatRelativeMinutes(mins: number): string {
  if (mins <= 0) return 'Maintenant';
  if (mins < 60) return `Dans ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `Dans ${h}h`;
  return `Dans ${h}h${String(m).padStart(2, '0')}`;
}

export const WEEKDAY_SHORT_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/**
 * Expands all schedule events, dated exams, and scheduled workouts for a given date (YYYY-MM-DD),
 * sorted chronologically by startTime.
 */
export function getOccurrencesForDate(state: AppState, dateISO: string): CalendarOccurrence[] {
  const weekday = getISOWeekday(dateISO);
  const list: CalendarOccurrence[] = [];

  for (const ev of state.events) {
    const matchesDirect = !ev.recurringWeekly && ev.date === dateISO;
    const matchesRecurring =
      Boolean(ev.recurringWeekly) &&
      (ev.recurringDays && ev.recurringDays.length > 0
        ? ev.recurringDays.includes(weekday)
        : getISOWeekday(ev.date) === weekday);

    if (matchesDirect || matchesRecurring) {
      list.push({
        occurrenceKey: `ev-${ev.id}-${dateISO}`,
        id: ev.id,
        source: 'event',
        type: ev.type,
        title: ev.title,
        subject: ev.subject,
        location: ev.location,
        date: dateISO,
        startTime: ev.startTime,
        endTime: ev.endTime,
        recurringWeekly: ev.recurringWeekly,
        notes: ev.notes,
        geminiNotebookUrl: ev.geminiNotebookUrl,
        completed: ev.completed,
        event: ev,
      });
    }
  }

  for (const exam of state.exams) {
    if (exam.date === dateISO) {
      const startTime = exam.startTime || '09:00';
      const endTime = exam.endTime || addMinutesToTime(startTime, 120);
      list.push({
        occurrenceKey: `exam-${exam.id}-${dateISO}`,
        id: exam.id,
        source: 'exam',
        type: 'eval',
        title: exam.title,
        subject: exam.subject,
        location: exam.room,
        date: dateISO,
        startTime,
        endTime,
        notes: exam.notes,
        geminiNotebookUrl: exam.geminiNotebookUrl,
        completed: exam.done,
        exam,
      });
    }
  }

  for (const workout of state.workouts) {
    if (workout.date === dateISO) {
      const startTime = workout.startTime || '18:00';
      const endTime = addMinutesToTime(startTime, workout.durationMin || 60);
      list.push({
        occurrenceKey: `workout-${workout.id}-${dateISO}`,
        id: workout.id,
        source: 'workout',
        type: 'sport',
        title: workout.title,
        subject: workout.focus,
        location: 'Salle de sport',
        date: dateISO,
        startTime,
        endTime,
        notes: workout.notes,
        completed: workout.completed,
        workout,
      });
    }
  }

  return list.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}
