import { motion } from 'framer-motion';

interface ProgressRingProps {
  value: number; // 0..100
  size?: number;
  strokeWidth?: number;
  className?: string;
  colorClass?: string;
  showLabel?: boolean;
}

export function ProgressRing({
  value,
  size = 54,
  strokeWidth = 4.5,
  className = '',
  colorClass = 'stroke-slate-900 dark:stroke-zinc-100',
  showLabel = true,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className={`relative inline-flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-slate-200/80 dark:stroke-zinc-800"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={colorClass}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: 'spring', stiffness: 110, damping: 20 }}
        />
      </svg>
      {showLabel && (
        <span className="absolute font-mono text-[11px] font-semibold tabular-nums text-slate-900 dark:text-zinc-100">
          {clamped}%
        </span>
      )}
    </div>
  );
}
