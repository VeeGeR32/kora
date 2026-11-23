export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rowav-skeleton rounded-xl ${className}`} aria-hidden="true" />;
}

export function TrackCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="tempo-card rounded-2xl p-3.5 space-y-3"
          aria-hidden="true"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="h-14 w-14 rounded-xl shrink-0" />
            <div className="flex-1 min-w-0 space-y-2 pt-0.5">
              <Skeleton className="h-3.5 w-3/4 rounded-lg" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-4 w-12 rounded-full" />
                <Skeleton className="h-4 w-16 rounded-full" />
                <Skeleton className="h-4 w-10 rounded-full" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800/70">
            <Skeleton className="h-3 w-24 rounded-md" />
            <Skeleton className="h-3 w-16 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SocialFeedSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      {/* Artists Strip Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="tempo-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-2/3 rounded-md" />
                <Skeleton className="h-2.5 w-1/2 rounded-md" />
              </div>
            </div>
            <Skeleton className="h-3 w-full rounded-md" />
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-2.5 w-20 rounded-md" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>

      {/* Shared Projects Feed Skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, idx) => (
          <div key={idx} className="tempo-card rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1">
                <Skeleton className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-32 rounded-full" />
                  <Skeleton className="h-5 w-48 rounded-lg" />
                  <Skeleton className="h-3 w-72 max-w-full rounded-md" />
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <Skeleton className="h-8 w-20 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-full" />
              </div>
            </div>
            <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-zinc-800/80">
              {Array.from({ length: 3 }).map((__, r) => (
                <div
                  key={r}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 dark:border-zinc-800/60 p-3"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <Skeleton className="h-11 w-11 rounded-xl shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-3.5 w-40 rounded-md" />
                      <Skeleton className="h-2.5 w-24 rounded-md" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-14 rounded-full" />
                    <Skeleton className="h-6 w-12 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PublicShareSkeleton() {
  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] p-4 sm:p-8 flex items-center justify-center">
      <div className="w-full max-w-2xl tempo-card rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <Skeleton className="h-40 w-40 rounded-[24px] shrink-0" />
          <div className="flex-1 w-full space-y-3">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-7 w-56 rounded-lg" />
            <Skeleton className="h-3.5 w-40 rounded-md" />
            <div className="flex items-center gap-2 pt-1">
              <Skeleton className="h-9 w-28 rounded-full" />
              <Skeleton className="h-9 w-24 rounded-full" />
            </div>
          </div>
        </div>
        <Skeleton className="h-16 w-full rounded-2xl" />
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export function AppBootSkeleton() {
  return (
    <div className="min-h-[100dvh] flex bg-[var(--bg)] text-[var(--text)]">
      {/* Desktop Sidebar Skeleton */}
      <div className="hidden md:flex flex-col w-60 shrink-0 border-r border-slate-200/70 dark:border-zinc-800/80 p-4 justify-between">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 px-1.5">
            <Skeleton className="h-8 w-8 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-16 rounded-md" />
              <Skeleton className="h-2.5 w-20 rounded-md" />
            </div>
          </div>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-2.5 pt-4 border-t border-slate-100 dark:border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-xl" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3 w-24 rounded-md" />
              <Skeleton className="h-2.5 w-16 rounded-md" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="flex-1 p-5 sm:p-8 max-w-7xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-36 rounded-xl" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <TrackCardSkeletonGrid count={6} />
      </div>
    </div>
  );
}
