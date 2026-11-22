export function KoraLogo({ size = 32 }: { size?: number }) {
  const radius = Math.max(8, Math.round(size * 0.3));
  return (
    <div
      style={{ width: size, height: size, borderRadius: radius }}
      className="bg-[#111113] dark:bg-[#f4f4f6] text-white dark:text-[#111113] flex items-center justify-center shadow-xs border border-black/10 dark:border-white/15 shrink-0 select-none"
      aria-label="Kora"
    >
      <svg
        viewBox="0 0 32 32"
        width={Math.round(size * 0.68)}
        height={Math.round(size * 0.68)}
        fill="none"
      >
        {/* Precision Studio Vinyl / Acoustic Ring */}
        <path
          d="M23.8 11.4A9.2 9.2 0 1 0 21.6 23.2"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M25.2 16a9.2 9.2 0 0 1-1.3 4.7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeOpacity="0.32"
        />
        {/* Studio Spindle Core */}
        <circle cx="16" cy="16" r="2.6" fill="currentColor" />
        {/* Kora Signature Signal Orange Satellite */}
        <circle cx="24.2" cy="9.4" r="2.35" fill="#FF5500" />
      </svg>
    </div>
  );
}
