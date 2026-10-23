/** Skeleton while the overview queries run (loading state). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading overview…</span>
      <div className="h-8 w-56 animate-pulse rounded-[10px] bg-surface-2" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[190px] animate-pulse rounded-[16px] border border-line bg-surface" />
        ))}
      </div>
      <div className="h-[260px] animate-pulse rounded-[16px] border border-line bg-surface" />
    </div>
  );
}
