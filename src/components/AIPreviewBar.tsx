import { AnimatePresence, motion } from 'framer-motion';
import { Check, Sparkles, X } from 'lucide-react';
import { useAI } from '../context/AIContext';

export function AIPreviewBar() {
  const { draftActions, applyAllDrafts, clearDrafts } = useAI();

  return (
    <AnimatePresence>
      {draftActions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="mb-4 rounded-2xl border-2 border-dashed border-violet-400/80 dark:border-violet-600 bg-violet-50/85 dark:bg-violet-950/40 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-violet-950 dark:text-violet-100">
            <Sparkles size={14} className="text-violet-600 dark:text-violet-400 shrink-0" />
            <span>
              <strong>Aperçu IA actif</strong> — {draftActions.length} modification
              {draftActions.length > 1 ? 's' : ''} visible{draftActions.length > 1 ? 's' : ''} en
              pointillés sur ton app
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={applyAllDrafts}
              className="inline-flex items-center gap-1 rounded-xl bg-violet-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-violet-700 transition cursor-pointer"
            >
              <Check size={13} /> Tout appliquer
            </button>
            <button
              type="button"
              onClick={clearDrafts}
              className="inline-flex items-center gap-1 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:text-rose-600 transition cursor-pointer"
            >
              <X size={13} /> Annuler
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
