export function KoraLogo({ size = 32 }: { size?: number }) {
  const radius = Math.max(8, Math.round(size * 0.28));
  const svgSize = Math.round(size * 0.66);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(145deg, #A32E24 0%, #8C271E 55%, #661A13 100%)',
      }}
      className="text-white flex items-center justify-center shadow-sm shadow-[#8C271E]/30 border border-white/15 shrink-0 select-none"
      aria-label="Rowav"
    >
      <svg
        viewBox="0 0 32 32"
        width={svgSize}
        height={svgSize}
        fill="none"
      >
        {/* Minimalist 5-bar sculpted .WAV acoustic wave (SoundCloud x Apple aesthetic) */}
        <line
          x1="5.5"
          y1="13"
          x2="5.5"
          y2="19"
          stroke="#FFFFFF"
          strokeOpacity="0.72"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <line
          x1="10.75"
          y1="8.5"
          x2="10.75"
          y2="23.5"
          stroke="#FFFFFF"
          strokeOpacity="0.92"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <line
          x1="16"
          y1="5"
          x2="16"
          y2="27"
          stroke="#FFFFFF"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <line
          x1="21.25"
          y1="9.5"
          x2="21.25"
          y2="22.5"
          stroke="#FFFFFF"
          strokeOpacity="0.92"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <line
          x1="26.5"
          y1="12.5"
          x2="26.5"
          y2="19.5"
          stroke="#FFFFFF"
          strokeOpacity="0.72"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
