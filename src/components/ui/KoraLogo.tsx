export function KoraLogo({ size = 32 }: { size?: number }) {
  const radius = Math.max(8, Math.round(size * 0.26));
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(135deg, #180d0d 0%, #0d0909 50%, #070505 100%)',
      }}
      className="flex items-center justify-center shadow-sm shadow-[#8C271E]/25 border border-[#8C271E]/35 shrink-0 select-none overflow-hidden"
      aria-label="Rowav"
    >
      <svg viewBox="0 0 1024 1024" width={size} height={size} fill="none">
        <defs>
          <linearGradient id="rowavRecDot" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#CA362A" />
            <stop offset="100%" stopColor="#761913" />
          </linearGradient>
        </defs>
        {/* Minimalist geometric white lowercase "r" (3A Obsidienne Pure) */}
        <rect x="265" y="255" width="128" height="515" rx="24" fill="#FFFFFF" />
        <path
          d="M328 504 A186 186 0 0 1 514 318"
          stroke="#FFFFFF"
          strokeWidth="128"
          strokeLinecap="round"
        />
        {/* Signature Rowav #8C271E Crimson REC Dot */}
        <circle cx="652" cy="683" r="87" fill="url(#rowavRecDot)" />
      </svg>
    </div>
  );
}
