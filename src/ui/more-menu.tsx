import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cx } from "@/ui/core";

/**
 * "⋯ More" for rare or destructive record actions (cancel, …) so they do not take a whole card on the
 * page. A native <details> disclosure: keyboard operable, works before JavaScript loads. The actions inside
 * keep their own confirmation and reason fields; this only hides them until asked for.
 *
 * `compact` (record headers, harmony pass 2026-11-08): a 44 px round icon button on phones ("More" in words from
 * 640 px) whose panel drops down under it, right-aligned, at every width. Without `compact` the panel opens in
 * place on phones (full width) and as a dropdown from 640 px, as before.
 */
export function MoreMenu({ children, label = "More", className, compact = false }: { children: ReactNode; label?: string; className?: string; compact?: boolean }) {
  return (
    <details className={cx("group relative", className)} data-testid="more-menu">
      <summary
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
        className={cx(
          "inline-flex min-h-[44px] cursor-pointer list-none items-center justify-center gap-1.5 rounded-full border border-line bg-surface text-[14px] font-medium text-fg hover:bg-surface-2 [&::-webkit-details-marker]:hidden",
          compact ? "min-w-[44px] px-0 sm:px-4" : "px-4",
        )}
      >
        <MoreHorizontal size={18} aria-hidden /> <span className={compact ? "hidden sm:inline" : undefined}>{label}</span>
      </summary>
      <div
        className={cx(
          "rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)]",
          compact ? "absolute right-0 z-30 mt-2 w-[min(340px,calc(100vw-32px))]" : "mt-2 w-full min-w-0 sm:absolute sm:right-0 sm:z-30 sm:w-[340px]",
        )}
      >
        {children}
      </div>
    </details>
  );
}
