"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { cx } from "./core";

/**
 * A filter of a list as a dropdown in the toolbar ("Everyone's" / "Mine and unassigned"), ADR-136. Each choice is a
 * page address; choosing one opens it. The label is read by screen readers and shown as the first word when `show`.
 */
export function FilterSelect({ id, label, value, options, showLabel = false, className }: { id: string; label: string; value: string; options: readonly { value: string; label: string; href: string }[]; showLabel?: boolean; className?: string }) {
  const router = useRouter();
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <label htmlFor={id} className={showLabel ? "text-[13px] font-medium text-fg-2" : "sr-only"}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const o = options.find((x) => x.value === e.target.value);
          if (o) router.push(o.href, { scroll: false });
        }}
        className="min-h-[36px] cursor-pointer rounded-[6px] border border-line-strong bg-surface pl-3 text-[14px] font-medium text-fg shadow-[var(--shadow-card)] focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-[var(--primary-soft)] pointer-coarse:min-h-[44px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const INTERACTIVE = "a, button, input, select, textarea, label, summary, details, [role=button], [data-no-row-click]";

/**
 * Whole-row click for DataTable (ADR-136): a click on a `tr[data-href]` that is not on a link, button or field opens
 * the row's record; Ctrl/⌘-click or a middle click opens it in a new tab. The row's primary cell stays a real link
 * for the keyboard and screen readers. Mounted once by the shell.
 */
export function RowClicks() {
  const router = useRouter();
  useEffect(() => {
    const open = (e: MouseEvent) => {
      if (e.defaultPrevented || (e.button !== 0 && e.button !== 1)) return;
      const t = e.target as Element | null;
      if (!t || t.closest(INTERACTIVE)) return;
      const row = t.closest<HTMLElement>("tr[data-href]");
      if (!row) return;
      if (window.getSelection()?.toString()) return; // selecting text is not a click
      const href = row.dataset.href!;
      if (e.button === 1 || e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
      else router.push(href);
    };
    document.addEventListener("click", open);
    document.addEventListener("auxclick", open);
    return () => {
      document.removeEventListener("click", open);
      document.removeEventListener("auxclick", open);
    };
  }, [router]);
  return null;
}
