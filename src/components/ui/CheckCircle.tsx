import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

interface CheckCircleProps {
  checked: boolean;
  onToggle: () => void;
  accent?: 'indigo' | 'violet' | 'emerald' | 'amber' | 'slate';
  size?: 'sm' | 'md';
  label?: string;
}

const ACCENT_MAP = {
  indigo: 'bg-slate-900 dark:bg-zinc-100 border-slate-900 dark:border-zinc-100 text-white dark:text-zinc-900',
  violet: 'bg-[#FF5500] border-[#FF5500] text-white',
  emerald: 'bg-emerald-600 border-emerald-600 text-white',
  amber: 'bg-amber-500 border-amber-500 text-white',
  slate: 'bg-slate-900 dark:bg-zinc-100 border-slate-900 dark:border-zinc-100 text-white dark:text-zinc-900',
};

export function CheckCircle({
  checked,
  onToggle,
  accent = 'slate',
  size = 'md',
  label,
}: CheckCircleProps) {
  const dim = size === 'sm' ? 'h-4 w-4' : 'h-[19px] w-[19px]';
  const iconSize = size === 'sm' ? 10 : 12;

  return (
    <motion.button
      type="button"
      aria-label={label || (checked ? 'Marquer comme non fait' : 'Marquer comme fait')}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      whileTap={{ scale: 0.84 }}
      className={`relative shrink-0 rounded-full border transition-colors flex items-center justify-center cursor-pointer ${dim} ${
        checked
          ? ACCENT_MAP[accent]
          : 'border-slate-300 dark:border-zinc-700 hover:border-slate-500 dark:hover:border-zinc-400 bg-transparent'
      }`}
    >
      <motion.span
        initial={false}
        animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 28 }}
        className="flex items-center justify-center"
      >
        <Check size={iconSize} strokeWidth={3} />
      </motion.span>
    </motion.button>
  );
}
