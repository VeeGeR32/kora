import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Dumbbell,
  ExternalLink,
  MapPin,
  Repeat,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ActiveTab, CalendarOccurrence } from '../types';
import { useApp } from '../context/AppContext';
import { formatDurationLabel, formatLongDateFR } from '../utils/dates';
import { EVENT_STYLES } from '../utils/theme';

interface EventDetailDrawerProps {
  occurrence: CalendarOccurrence | null;
  onClose: () => void;
  onNavigate?: (tab: ActiveTab) => void;
}

export function EventDetailDrawer({ occurrence, onClose, onNavigate }: EventDetailDrawerProps) {
  const { updateEvent, deleteEvent, updateExam, deleteExam, updateWorkout, deleteWorkout } =
    useApp();

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [geminiUrl, setGeminiUrl] = useState('');

  useEffect(() => {
    if (!occurrence) return;
    setEditing(false);
    setTitle(occurrence.title);
    setLocation(occurrence.location || '');
    setStartTime(occurrence.startTime);
    setEndTime(occurrence.endTime);
    setNotes(occurrence.notes || '');
    setGeminiUrl(occurrence.geminiNotebookUrl || '');
  }, [occurrence]);

  useEffect(() => {
    if (!occurrence) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [occurrence, onClose]);

  const handleSave = () => {
    if (!occurrence) return;
    if (occurrence.source === 'event') {
      updateEvent(occurrence.id, {
        title: title.trim() || occurrence.title,
        location: location.trim() || undefined,
        startTime,
        endTime,
        notes: notes.trim() || undefined,
      });
    } else if (occurrence.source === 'exam') {
      updateExam(occurrence.id, {
        title: title.trim() || occurrence.title,
        room: location.trim() || undefined,
        startTime,
        endTime,
        notes: notes.trim() || undefined,
        geminiNotebookUrl: geminiUrl.trim() || undefined,
      });
    } else if (occurrence.source === 'workout') {
      updateWorkout(occurrence.id, {
        title: title.trim() || occurrence.title,
        startTime,
        notes: notes.trim() || undefined,
      });
    }
    setEditing(false);
    onClose();
  };

  const handleToggleDone = () => {
    if (!occurrence) return;
    if (occurrence.source === 'event') {
      updateEvent(occurrence.id, { completed: !occurrence.completed });
    } else if (occurrence.source === 'exam') {
      updateExam(occurrence.id, { done: !occurrence.completed });
    } else if (occurrence.source === 'workout') {
      updateWorkout(occurrence.id, { completed: !occurrence.completed });
    }
    onClose();
  };

  const handleDelete = () => {
    if (!occurrence) return;
    if (occurrence.source === 'event') deleteEvent(occurrence.id);
    else if (occurrence.source === 'exam') deleteExam(occurrence.id);
    else if (occurrence.source === 'workout') deleteWorkout(occurrence.id);
    onClose();
  };

  const style = occurrence ? EVENT_STYLES[occurrence.type] : EVENT_STYLES.cours;

  return (
    <AnimatePresence>
      {occurrence && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/25 dark:bg-black/60 backdrop-blur-[2px]"
          />

          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="relative z-10 w-full max-w-md bg-white dark:bg-[#121215] border-l border-slate-200/80 dark:border-zinc-800 h-full flex flex-col shadow-2xl"
          >
            {/* Top Bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-zinc-800/80">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${style.pill}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                {style.label}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  {editing ? 'Aperçu' : 'Modifier'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {!editing ? (
                <>
                  <div>
                    {occurrence.subject && (
                      <p className="text-xs font-medium text-slate-400 dark:text-zinc-500 mb-1">
                        {occurrence.subject}
                      </p>
                    )}
                    <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-zinc-100">
                      {occurrence.title}
                    </h3>
                  </div>

                  <div className="space-y-2.5 text-sm text-slate-600 dark:text-zinc-300">
                    <div className="flex items-center gap-2.5">
                      <Calendar size={15} className="text-slate-400 shrink-0" />
                      <span>{formatLongDateFR(occurrence.date)}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Clock size={15} className="text-slate-400 shrink-0" />
                      <span className="font-mono text-xs tabular-nums">
                        {occurrence.startTime} – {occurrence.endTime}
                      </span>
                      <span className="text-xs text-slate-400">
                        ({formatDurationLabel(occurrence.startTime, occurrence.endTime)})
                      </span>
                    </div>
                    {occurrence.location && (
                      <div className="flex items-center gap-2.5">
                        <MapPin size={15} className="text-slate-400 shrink-0" />
                        <span>{occurrence.location}</span>
                      </div>
                    )}
                    {occurrence.recurringWeekly && (
                      <div className="flex items-center gap-2.5 text-indigo-600 dark:text-indigo-400 text-xs">
                        <Repeat size={14} className="shrink-0" />
                        <span>Cours récurrent chaque semaine</span>
                      </div>
                    )}
                  </div>

                  {/* Gemini Notebook CTA if Exam */}
                  {occurrence.geminiNotebookUrl && (
                    <a
                      href={occurrence.geminiNotebookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-2xl border border-violet-200 dark:border-violet-800/70 bg-violet-50/70 dark:bg-violet-950/35 px-4 py-3.5 group hover:bg-violet-100/70 dark:hover:bg-violet-950/55 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                          <Sparkles size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-violet-950 dark:text-violet-100 truncate">
                            {occurrence.exam?.geminiNotebookTitle || 'Ouvrir le Notebook Gemini'}
                          </p>
                          <p className="text-[11px] text-violet-600/80 dark:text-violet-300/80 truncate">
                            Réviser l’évaluation avec Gemini
                          </p>
                        </div>
                      </div>
                      <ExternalLink
                        size={15}
                        className="text-violet-600 dark:text-violet-300 shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                      />
                    </a>
                  )}

                  {/* Jump to workout if sport */}
                  {occurrence.source === 'workout' && onNavigate && (
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate('sport');
                        onClose();
                      }}
                      className="w-full flex items-center justify-between rounded-2xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-4 py-3.5 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/50 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                          <Dumbbell size={16} />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-semibold text-emerald-950 dark:text-emerald-100">
                            Ouvrir la séance & séries
                          </p>
                          <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                            {occurrence.workout?.exercises.length || 0} exercices configurés
                          </p>
                        </div>
                      </div>
                      <ExternalLink size={14} className="text-emerald-600 dark:text-emerald-400" />
                    </button>
                  )}

                  {occurrence.notes && (
                    <div className="rounded-xl bg-slate-50 dark:bg-zinc-900/70 border border-slate-100 dark:border-zinc-800/80 p-3.5">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                        Notes
                      </p>
                      <p className="text-sm text-slate-700 dark:text-zinc-300 leading-relaxed">
                        {occurrence.notes}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                      Titre
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                        Début
                      </label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    {occurrence.source !== 'workout' && (
                      <div>
                        <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                          Fin
                        </label>
                        <input
                          type="time"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
                        />
                      </div>
                    )}
                  </div>
                  {occurrence.source !== 'workout' && (
                    <div>
                      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                        Salle / Lieu
                      </label>
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-sm"
                      />
                    </div>
                  )}
                  {occurrence.source === 'exam' && (
                    <div>
                      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                        Lien Notebook Gemini
                      </label>
                      <input
                        type="url"
                        value={geminiUrl}
                        onChange={(e) => setGeminiUrl(e.target.value)}
                        placeholder="https://notebooklm.google.com/..."
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                      Notes
                    </label>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3.5 py-2.5 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="w-full rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 py-2.5 text-xs font-semibold cursor-pointer hover:opacity-90 transition"
                  >
                    Enregistrer les modifications
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleToggleDone}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
                  occurrence.completed
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-700'
                }`}
              >
                <CheckCircle2 size={14} />
                {occurrence.completed ? 'Terminé' : 'Marquer terminé'}
              </button>

              <button
                type="button"
                onClick={handleDelete}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
              >
                <Trash2 size={14} />
                Supprimer
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
