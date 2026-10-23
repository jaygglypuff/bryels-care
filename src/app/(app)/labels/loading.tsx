export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading labels">
      <div className="h-10 w-64 animate-pulse rounded-full bg-surface-2" />
      <div className="h-40 animate-pulse rounded-[24px] bg-surface-2" />
      <div className="h-24 animate-pulse rounded-[24px] bg-surface-2" />
    </div>
  );
}
