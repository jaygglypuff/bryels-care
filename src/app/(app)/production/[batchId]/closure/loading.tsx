/** Skeleton while the closure checks load (loading state). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto flex max-w-3xl flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-64 animate-pulse rounded-[10px] bg-surface-2" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[120px] animate-pulse rounded-[16px] border border-line bg-surface" />
      ))}
    </div>
  );
}
