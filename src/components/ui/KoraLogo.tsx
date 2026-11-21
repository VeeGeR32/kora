export function KoraLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-[10px] bg-slate-950 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shadow-xs shrink-0 select-none"
      aria-label="Kora"
    >
      <svg
        viewBox="0 0 32 32"
        width={Math.round(size * 0.66)}
        height={Math.round(size * 0.66)}
        fill="none"
      >
        {/* Minimalist Eclipse / Orbital Ring */}
        <path
          d="M23.8 11.4A9.2 9.2 0 1 0 21.6 23.2"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M25.2 16a9.2 9.2 0 0 1-1.3 4.7"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeOpacity="0.4"
        />
        {/* Subtle Focal Core */}
        <circle cx="16" cy="16" r="2.7" fill="currentColor" />
        {/* Orbital Accent Satellite */}
        <circle cx="24.2" cy="9.4" r="2.1" className="fill-violet-400 dark:fill-violet-600" />
      </svg>
    </div>
  );
}
