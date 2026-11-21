import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Columns3,
  List,
  MapPin,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
} from 'lucide-react';
import type { CalendarOccurrence, EventType } from '../types';
import { useApp } from '../context/AppContext';
import { useAI } from '../context/AIContext';
import { GoogleCalendarModal } from './GoogleCalendarModal';
import {
  addDays,
  formatLongDateFR,
  getISOWeekday,
  getOccurrencesForDate,
  getWeekDates,
  parseISODate,
  timeToMinutes,
  todayISO,
  WEEKDAY_SHORT_FR,
} from '../utils/dates';
import { EVENT_STYLES } from '../utils/theme';
import type { QuickAddContext } from './QuickAddModal';

interface PlanningViewProps {
  onOpenQuickAdd: (ctx?: QuickAddContext) => void;
  onSelectOccurrence: (occ: CalendarOccurrence) => void;
}

const START_HOUR = 7;
const END_HOUR = 22;
const HOUR_HEIGHT = 54;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

interface PositionedOccurrence {
  occ: CalendarOccurrence;
  colIndex: number;
  colCount: number;
}

function layoutDayOccurrences(events: CalendarOccurrence[]): PositionedOccurrence[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => {
    const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    if (diff !== 0) return diff;
    return timeToMinutes(b.endTime) - timeToMinutes(a.endTime);
  });

  const clusters: CalendarOccurrence[][] = [];
  let currentCluster: CalendarOccurrence[] = [];
  let clusterEnd = -1;

  for (const ev of sorted) {
    const start = timeToMinutes(ev.startTime);
    const end = Math.max(start + 35, timeToMinutes(ev.endTime));
    if (currentCluster.length === 0 || start < clusterEnd) {
      currentCluster.push(ev);
      clusterEnd = Math.max(clusterEnd, end);
    } else {
      clusters.push(currentCluster);
      currentCluster = [ev];
      clusterEnd = end;
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const result: PositionedOccurrence[] = [];
  for (const cluster of clusters) {
    const colEnds: number[] = [];
    const assigned: { occ: CalendarOccurrence; col: number }[] = [];

    for (const ev of cluster) {
      const start = timeToMinutes(ev.startTime);
      const end = Math.max(start + 35, timeToMinutes(ev.endTime));
      let col = colEnds.findIndex((cEnd) => cEnd <= start);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(end);
      } else {
        colEnds[col] = end;
      }
      assigned.push({ occ: ev, col });
    }

    const colCount = Math.max(1, colEnds.length);
    for (const item of assigned) {
      result.push({ occ: item.occ, colIndex: item.col, colCount });
    }
  }
  return result;
}

export function PlanningView({ onOpenQuickAdd, onSelectOccurrence }: PlanningViewProps) {
  const { state } = useApp();
  const { draftActions, applyDraftAction } = useAI();
  const today = todayISO();
  const [anchorDate, setAnchorDate] = useState(today);
  const [viewMode, setViewMode] = useState<'week' | '3days' | 'day' | 'agenda'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week'
  );
  const [filter, setFilter] = useState<EventType | 'all'>('all');
  const [gcalOpen, setGcalOpen] = useState(false);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 640 && viewMode === 'week') setViewMode('day');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewMode]);

  const displayedDates = useMemo(() => {
    if (viewMode === 'day') return [anchorDate];
    if (viewMode === '3days') return [anchorDate, addDays(anchorDate, 1), addDays(anchorDate, 2)];
    return getWeekDates(anchorDate);
  }, [anchorDate, viewMode]);

  const navStepDays = viewMode === 'day' ? 1 : viewMode === '3days' ? 3 : 7;

  const monthHeader = useMemo(() => {
    const start = parseISODate(displayedDates[0]);
    const end = parseISODate(displayedDates[displayedDates.length - 1]);
    const fmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
    const a = fmt.format(start);
    const b = fmt.format(end);
    const label = a === b ? a : `${a.split(' ')[0]} – ${b}`;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [displayedDates]);

  const occurrencesByDay = useMemo(() => {
    const map: Record<string, CalendarOccurrence[]> = {};
    for (const d of displayedDates) {
      const all = getOccurrencesForDate(state, d);
      const draftOccs: CalendarOccurrence[] = draftActions
        .filter((item) => item.action.kind === 'add_schedule_event' && item.action.payload.date === d)
        .map((item) => {
          const ev = (item.action as Extract<typeof item.action, { kind: 'add_schedule_event' }>).payload;
          return {
            occurrenceKey: `draft-${item.id}`,
            id: item.id,
            source: 'event' as const,
            type: ev.type,
            title: ev.title,
            subject: ev.subject,
            location: ev.location,
            date: ev.date,
            startTime: ev.startTime,
            endTime: ev.endTime,
            notes: '__AI_DRAFT__',
          };
        });
      const combined = [...all, ...draftOccs];
      map[d] = filter === 'all' ? combined : combined.filter((o) => o.type === filter);
    }
    return map;
  }, [state, displayedDates, filter, draftActions]);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowOffsetPx = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const showNowLine = nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;

  return (
    <div className="space-y-4 sm:space-y-5 pb-10">
      {/* Top Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
            Planning
          </h1>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{monthHeader}</p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Google Calendar Sync Button */}
          <button
            type="button"
            onClick={() => setGcalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-slate-400 dark:hover:border-zinc-600 transition cursor-pointer"
          >
            <RefreshCw size={12} className="text-indigo-500" />
            Google Agenda
          </button>

          {/* Date Navigator */}
          <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-0.5">
            <button
              type="button"
              onClick={() => setAnchorDate((d) => addDays(d, -navStepDays))}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
              aria-label="Précédent"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(today)}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
            >
              Auj.
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate((d) => addDays(d, navStepDays))}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
              aria-label="Suivant"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Responsive View Switcher */}
          <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-0.5">
            {(
              [
                ['day', 'Jour', CalendarIcon],
                ['3days', '3J', Columns3],
                ['week', 'Sem.', CalendarIcon],
                ['agenda', 'Liste', List],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                  id === 'week' ? 'hidden sm:inline-flex' : ''
                } ${
                  viewMode === id
                    ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                    : 'text-slate-500 dark:text-zinc-400'
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onOpenQuickAdd({ mode: 'cours', date: anchorDate })}
            className="inline-flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-3 py-2 text-xs font-semibold cursor-pointer"
          >
            <Plus size={14} />
            Ajouter
          </button>
        </div>
      </div>

      {/* Category Filters */}
      <div className="flex items-center flex-wrap gap-1.5">
        {(
          [
            ['all', 'Tout'],
            ['cours', 'Cours'],
            ['eval', 'Évals'],
            ['sport', 'Sport'],
            ['music', 'Music'],
            ['rdv', 'RDV'],
          ] as const
        ).map(([key, label]) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition cursor-pointer border whitespace-nowrap ${
                active
                  ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border-transparent'
                  : 'bg-white dark:bg-zinc-900/70 text-slate-600 dark:text-zinc-400 border-slate-200/80 dark:border-zinc-800'
              }`}
            >
              {key !== 'all' && (
                <span className={`h-1.5 w-1.5 rounded-full ${EVENT_STYLES[key].dot}`} />
              )}
              {label}
            </button>
          );
        })}
      </div>

      {/* TIME GRID VIEW (1 day / 3 days / 7 days) */}
      {viewMode !== 'agenda' ? (
        <div className="tempo-card rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <div className={viewMode === 'week' ? 'min-w-[740px]' : 'w-full'}>
              {/* Day Headers */}
              <div
                className="grid border-b border-slate-100 dark:border-zinc-800/80 bg-slate-50/60 dark:bg-zinc-900/40"
                style={{ gridTemplateColumns: `48px repeat(${displayedDates.length}, minmax(0, 1fr))` }}
              >
                <div className="p-2" />
                {displayedDates.map((d) => {
                  const isToday = d === today;
                  const dayNum = parseISODate(d).getDate();
                  const dowLabel = WEEKDAY_SHORT_FR[getISOWeekday(d) - 1];
                  return (
                    <div
                      key={d}
                      className="py-2.5 px-1 text-center border-l border-slate-100 dark:border-zinc-800/70"
                    >
                      <p
                        className={`text-[10px] font-semibold uppercase tracking-wider ${
                          isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'
                        }`}
                      >
                        {dowLabel}
                      </p>
                      <div className="mt-1 flex justify-center">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-semibold tabular-nums ${
                            isToday
                              ? 'bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                              : 'text-slate-700 dark:text-zinc-300'
                          }`}
                        >
                          {dayNum}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Time Grid */}
              <div
                className="relative grid overflow-y-auto max-h-[65vh]"
                style={{
                  gridTemplateColumns: `48px repeat(${displayedDates.length}, minmax(0, 1fr))`,
                  height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT + 24}px`,
                }}
              >
                {/* Hours */}
                <div className="relative select-none">
                  {HOURS.slice(0, -1).map((h, i) => (
                    <div
                      key={h}
                      className="absolute right-2 -translate-y-2 font-mono text-[10px] tabular-nums text-slate-400"
                      style={{ top: `${i * HOUR_HEIGHT + 8}px` }}
                    >
                      {String(h).padStart(2, '0')}h
                    </div>
                  ))}
                </div>

                {/* Columns */}
                {displayedDates.map((d) => {
                  const dayEvents = occurrencesByDay[d] || [];
                  const isToday = d === today;
                  return (
                    <div
                      key={d}
                      className={`relative border-l border-slate-100 dark:border-zinc-800/70 ${
                        isToday ? 'bg-indigo-50/20 dark:bg-indigo-950/10' : ''
                      }`}
                    >
                      {HOURS.slice(0, -1).map((h, i) => (
                        <div
                          key={h}
                          onClick={() =>
                            onOpenQuickAdd({
                              mode: 'cours',
                              date: d,
                              startTime: `${String(h).padStart(2, '0')}:00`,
                            })
                          }
                          className="border-b border-slate-100/80 dark:border-zinc-800/50 hover:bg-slate-100/50 dark:hover:bg-zinc-800/30 transition cursor-pointer"
                          style={{ height: `${HOUR_HEIGHT}px`, marginTop: i === 0 ? '8px' : '0' }}
                        />
                      ))}

                      {isToday && showNowLine && (
                        <div
                          className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                          style={{ top: `${nowOffsetPx + 8}px` }}
                        >
                          <span className="h-2 w-2 -ml-1 rounded-full bg-rose-500" />
                          <span className="h-[1.5px] flex-1 bg-rose-500/80" />
                        </div>
                      )}

                      {layoutDayOccurrences(dayEvents).map(({ occ, colIndex, colCount }) => {
                        const startM = Math.max(START_HOUR * 60, timeToMinutes(occ.startTime));
                        const endM = Math.min(END_HOUR * 60, timeToMinutes(occ.endTime));
                        const durM = Math.max(35, endM - startM);
                        const top = ((startM - START_HOUR * 60) / 60) * HOUR_HEIGHT + 8;
                        const height = (durM / 60) * HOUR_HEIGHT - 3;
                        const style = EVENT_STYLES[occ.type];
                        const widthPct = 100 / colCount;
                        const leftPct = colIndex * widthPct;
                        const isDraft = occ.notes === '__AI_DRAFT__';

                        return (
                          <motion.button
                            key={occ.occurrenceKey}
                            type="button"
                            whileHover={{ scale: 1.015, zIndex: 30 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isDraft) applyDraftAction(occ.id);
                              else onSelectOccurrence(occ);
                            }}
                            title={isDraft ? 'Aperçu IA — cliquer pour appliquer' : occ.title}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                            }}
                            className={`absolute z-10 rounded-xl px-1.5 py-1 text-left overflow-hidden shadow-2xs transition cursor-pointer ${
                              isDraft
                                ? 'border-2 border-dashed border-violet-500 bg-violet-100/85 dark:bg-violet-950/75 text-violet-950 dark:text-violet-100'
                                : `border border-l-[3px] ${style.block} ${style.borderLeft}`
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-[9px] opacity-75 tabular-nums truncate">
                                {isDraft ? `IA · ${occ.startTime}` : occ.startTime}
                              </span>
                              {colCount <= 2 && (
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {occ.geminiNotebookUrl && <Sparkles size={9} className="text-violet-500" />}
                                  {occ.recurringWeekly && <Repeat size={8} className="opacity-55" />}
                                </div>
                              )}
                            </div>
                            <p className="text-[11px] font-semibold leading-tight truncate mt-0.5">
                              {occ.title}
                            </p>
                            {height >= 50 && occ.location && colCount === 1 && (
                              <p className="text-[10px] opacity-70 truncate mt-0.5">{occ.location}</p>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* AGENDA LIST VIEW */
        <div className="space-y-3">
          {getWeekDates(anchorDate).map((d) => {
            const all = getOccurrencesForDate(state, d);
            const items = filter === 'all' ? all : all.filter((o) => o.type === filter);
            const isToday = d === today;
            return (
              <div key={d} className="tempo-card rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-zinc-200">
                      {formatLongDateFR(d)}
                    </h3>
                    {isToday && (
                      <span className="rounded-full bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-2 py-0.5 text-[10px] font-semibold">
                        Auj.
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenQuickAdd({ mode: 'cours', date: d })}
                    className="text-xs text-slate-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    + Ajouter
                  </button>
                </div>

                {items.length === 0 ? (
                  <p className="text-xs text-slate-400 py-1">Aucun créneau</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((occ) => {
                      const style = EVENT_STYLES[occ.type];
                      return (
                        <div
                          key={occ.occurrenceKey}
                          onClick={() => onSelectOccurrence(occ)}
                          className="flex items-center gap-3 rounded-xl border border-slate-100 dark:border-zinc-800/80 px-3 py-2.5 hover:border-slate-300 dark:hover:border-zinc-700 transition cursor-pointer"
                        >
                          <span className="font-mono text-xs tabular-nums text-slate-500 w-20 shrink-0">
                            {occ.startTime}–{occ.endTime}
                          </span>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${style.dot}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{occ.title}</p>
                            {occ.location && (
                              <p className="text-xs text-slate-400 inline-flex items-center gap-1">
                                <MapPin size={10} /> {occ.location}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <GoogleCalendarModal open={gcalOpen} onClose={() => setGcalOpen(false)} />
    </div>
  );
}
