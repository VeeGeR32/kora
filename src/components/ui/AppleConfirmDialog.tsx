import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface AppleConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AppleConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  destructive = true,
  onConfirm,
  onCancel,
}: AppleConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-4"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 bg-black/45 dark:bg-black/70 backdrop-blur-[3px]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 4 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-[300px] rounded-[22px] bg-white/95 dark:bg-[#1c1c21]/95 backdrop-blur-2xl border border-black/10 dark:border-white/12 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)] overflow-hidden text-center select-none"
          >
            <div className="px-5 pt-5 pb-4 space-y-1.5">
              <h3 className="text-sm font-semibold tracking-tight text-slate-950 dark:text-white">
                {title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                {description}
              </p>
            </div>

            <div className="grid grid-cols-2 border-t border-slate-200/80 dark:border-zinc-800 divide-x divide-slate-200/80 dark:divide-zinc-800">
              <button
                type="button"
                onClick={onCancel}
                className="py-3 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100/80 dark:hover:bg-zinc-800/70 active:bg-slate-200/70 transition cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm();
                  onCancel();
                }}
                className={`py-3 text-xs font-semibold transition cursor-pointer ${
                  destructive
                    ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 active:bg-rose-500/20'
                    : 'text-[#FF5500] hover:bg-[#FF5500]/10 active:bg-[#FF5500]/20'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
