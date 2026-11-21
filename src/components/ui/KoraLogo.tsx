export function KoraLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-[10px] bg-slate-950 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center shadow-xs shrink-0 select-none"
    >
      <svg
        viewBox="0 0 32 32"
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        fill="none"
      >
        <path
          d="M8.5 5.5V26.5"
          stroke="currentColor"
          strokeWidth="3.1"
          strokeLinecap="round"
        />
        <path
          d="M23.5 6L11.5 16.5L24 26.5"
          stroke="currentColor"
          strokeWidth="3.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="6.2" r="2" className="fill-violet-400 dark:fill-violet-600" />
      </svg>
    </div>
  );
}
