import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CalendarDays,
  Check,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  ensureGoogleCalendarToken,
  fetchGoogleCalendarEvents,
  getCachedCalendarToken,
  listGoogleCalendars,
  type GoogleCalendarSummary,
} from '../lib/googleCalendar';
import { useApp } from '../context/AppContext';

interface GoogleCalendarModalProps {
  open: boolean;
  onClose: () => void;
}

export function GoogleCalendarModal({ open, onClose }: GoogleCalendarModalProps) {
  const { state, syncGoogleCalendarEvents } = useApp();

  const [token, setToken] = useState<string | null>(() => getCachedCalendarToken());
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [daysForward, setDaysForward] = useState<number>(60);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCalendars = async (activeToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await listGoogleCalendars(activeToken);
      setCalendars(list);
      const primary = list.find((c) => c.primary) || list[0];
      setSelectedIds(new Set(primary ? [primary.id] : []));
    } catch (err) {
      setError((err as Error).message);
      if (!getCachedCalendarToken()) setToken(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const cached = getCachedCalendarToken();
    setToken(cached);
    setError(null);
    if (cached) {
      void loadCalendars(cached);
    }
  }, [open]);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await ensureGoogleCalendarToken(state.preferences.firebaseConfig, false);
      setToken(t);
      await loadCalendars(t);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const toggleCalendar = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSync = async () => {
    if (!token || selectedIds.size === 0 || syncing) return;
    const chosen = calendars.filter((c) => selectedIds.has(c.id));
    setSyncing(true);
    setError(null);
    try {
      const events = await fetchGoogleCalendarEvents(token, chosen, 7, daysForward);
      syncGoogleCalendarEvents(events);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      if (!getCachedCalendarToken()) setToken(null);
    } finally {
      setSyncing(false);
    }
  };

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
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            className="relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#111114] border border-slate-200 dark:border-zinc-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center">
                  <CalendarDays size={15} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Google Agenda</h2>
                  <p className="text-[11px] text-slate-400">
                    Synchronise tes calendriers dans ton Planning Kora
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {error && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2 leading-relaxed">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {!token ? (
                <div className="rounded-2xl border border-slate-200/80 dark:border-zinc-800 p-6 text-center space-y-3">
                  <div className="mx-auto h-11 w-11 rounded-2xl bg-slate-100 dark:bg-zinc-900 flex items-center justify-center text-slate-700 dark:text-zinc-200">
                    <CalendarDays size={20} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Connecter ton Google Agenda</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                      Importe tes événements en lecture seule sans doublons (catégorisés automatiquement en Cours, Sport, Music ou RDV).
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleConnect()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2.5 text-xs font-semibold hover:opacity-92 cursor-pointer disabled:opacity-50"
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
                    Autoriser Google Agenda
                  </button>
                </div>
              ) : (
                <>
                  {/* Period Selector */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                      Horizon de synchronisation
                    </span>
                    <div className="inline-flex rounded-xl bg-slate-100 dark:bg-zinc-900 p-0.5">
                      {[14, 30, 60, 90].map((days) => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setDaysForward(days)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium cursor-pointer transition ${
                            daysForward === days
                              ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-2xs'
                              : 'text-slate-500'
                          }`}
                        >
                          {days}j
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Calendars List */}
                  {loading ? (
                    <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-400">
                      <Loader2 size={15} className="animate-spin" /> Chargement de tes agendas…
                    </div>
                  ) : calendars.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400">
                      Aucun agenda trouvé sur ce compte Google.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-[38vh] overflow-y-auto pr-0.5">
                      {calendars.map((c) => {
                        const selected = selectedIds.has(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleCalendar(c.id)}
                            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left border transition cursor-pointer ${
                              selected
                                ? 'border-slate-900 dark:border-zinc-100 bg-slate-900/5 dark:bg-zinc-100/8'
                                : 'border-slate-200/70 dark:border-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-900/60'
                            }`}
                          >
                            <div
                              className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                                selected
                                  ? 'bg-slate-900 dark:bg-zinc-100 border-slate-900 dark:border-zinc-100 text-white dark:text-zinc-950'
                                  : 'border-slate-300 dark:border-zinc-700'
                              }`}
                            >
                              {selected && <Check size={12} strokeWidth={3} />}
                            </div>
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: c.backgroundColor || '#6366f1' }}
                            />
                            <span className="text-xs font-medium text-slate-800 dark:text-zinc-100 truncate flex-1">
                              {c.summary}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {token && (
              <div className="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-slate-50/60 dark:bg-zinc-950/40">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={syncing}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || syncing}
                  onClick={() => void handleSync()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-950 px-4 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Synchroniser
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
