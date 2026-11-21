import { useState } from 'react';
import type { WeightEntry } from '../../types';
import { formatShortDateFR } from '../../utils/dates';

interface WeightChartProps {
  entries: WeightEntry[];
  goalKg?: number;
  compact?: boolean;
}

export function WeightChart({ entries, goalKg, compact = false }: WeightChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (entries.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-xs text-slate-400 dark:text-zinc-500 ${
          compact ? 'h-14' : 'h-48'
        }`}
      >
        Aucune pesée enregistrée
      </div>
    );
  }

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const width = compact ? 160 : 560;
  const height = compact ? 48 : 200;
  const padX = compact ? 6 : 24;
  const padY = compact ? 6 : 22;

  const values = sorted.map((e) => e.weightKg);
  if (goalKg && !compact) values.push(goalKg);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(1.2, rawMax - rawMin);
  const minVal = rawMin - span * 0.18;
  const maxVal = rawMax + span * 0.18;

  const getX = (i: number) => {
    if (sorted.length === 1) return width / 2;
    return padX + (i / (sorted.length - 1)) * (width - padX * 2);
  };

  const getY = (val: number) => {
    const ratio = (val - minVal) / (maxVal - minVal);
    return height - padY - ratio * (height - padY * 2);
  };

  const points = sorted.map((e, i) => ({ x: getX(i), y: getY(e.weightKg), entry: e }));

  // Smooth cubic bezier path
  const linePath = points.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = points[i - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`;
  }, '');

  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1].x} ${height - padY} L ${points[0].x} ${
          height - padY
        } Z`
      : '';

  const goalY = goalKg ? getY(goalKg) : null;
  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={`w-full overflow-visible ${compact ? 'h-12' : 'h-48 sm:h-52'}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={compact ? 'wGradCompact' : 'wGradFull'} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={compact ? '0.22' : '0.18'} />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>

        {!compact && goalY !== null && goalY >= padY && goalY <= height - padY && (
          <g>
            <line
              x1={padX}
              x2={width - padX}
              y1={goalY}
              y2={goalY}
              stroke="currentColor"
              strokeDasharray="4 4"
              className="text-emerald-500/45"
              strokeWidth="1.2"
            />
            <text
              x={width - padX}
              y={goalY - 6}
              textAnchor="end"
              className="fill-emerald-600 dark:fill-emerald-400 text-[10px] font-mono"
            >
              Objectif {goalKg?.toFixed(1)} kg
            </text>
          </g>
        )}

        {areaPath && (
          <path d={areaPath} fill={`url(#${compact ? 'wGradCompact' : 'wGradFull'})`} />
        )}

        {points.length > 1 && (
          <path
            d={linePath}
            fill="none"
            stroke="#10b981"
            strokeWidth={compact ? 2 : 2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {points.map((pt, i) => {
          const isLast = i === points.length - 1;
          const isHovered = hoveredIdx === i;
          if (compact && !isLast) return null;
          return (
            <g key={pt.entry.id}>
              {!compact && (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={14}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              )}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isHovered ? 5.5 : isLast ? 4 : 3}
                className="fill-white dark:fill-zinc-900 stroke-emerald-500 transition-all"
                strokeWidth={isHovered ? 2.5 : 2}
              />
            </g>
          );
        })}
      </svg>

      {!compact && activePoint && (
        <div
          className="pointer-events-none absolute -top-1 -translate-x-1/2 rounded-lg bg-slate-900 dark:bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-white dark:text-zinc-900 shadow-md whitespace-nowrap"
          style={{ left: `${(activePoint.x / width) * 100}%` }}
        >
          <span className="font-mono font-semibold tabular-nums">
            {activePoint.entry.weightKg.toFixed(1)} kg
          </span>
          <span className="opacity-70 ml-1.5">{formatShortDateFR(activePoint.entry.date)}</span>
        </div>
      )}

      {!compact && sorted.length > 1 && (
        <div className="flex justify-between text-[11px] text-slate-400 dark:text-zinc-500 px-2 mt-1 font-mono tabular-nums">
          <span>{formatShortDateFR(sorted[0].date)}</span>
          <span>{formatShortDateFR(sorted[sorted.length - 1].date)}</span>
        </div>
      )}
    </div>
  );
}
