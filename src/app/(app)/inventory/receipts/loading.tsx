/** Skeleton while receipts load (loading state). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading receipts…</span>
      <div className="h-8 w-56 animate-pulse rounded-[10px] bg-surface-2" />
      <div className="h-[88px] animate-pulse rounded-[16px] border border-line bg-surface" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[64px] animate-pulse rounded-[16px] border border-line bg-surface" />
      ))}
    </div>
  );
}
