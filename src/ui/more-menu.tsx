import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cx } from "@/ui/core";

/**
 * "⋯ More" for rare or destructive record actions (cancel, …) so they do not take a whole card on the
 * page. A native <details> disclosure: keyboard operable, works before JavaScript loads, and the panel
 * opens in place on phones (no off-screen popover) and as a dropdown from 640 px. The actions inside
 * keep their own confirmation and reason fields; this only hides them until asked for.
 */
export function MoreMenu({ children, label = "More", className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <details className={cx("group relative", className)} data-testid="more-menu">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-fg hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <MoreHorizontal size={16} aria-hidden /> {label}
      </summary>
      <div className="mt-2 w-full min-w-0 rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)] sm:absolute sm:right-0 sm:z-30 sm:w-[340px]">{children}</div>
    </details>
  );
}
