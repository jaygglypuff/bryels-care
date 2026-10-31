import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "./core";

/**
 * Grade-5 record list (ADR-088): one row per record, the name or product first, the record number small and
 * grey, the status as a chip with an icon, one line of plain facts. The same list on a 390 px phone and on a
 * desktop (no wide table, no sideways scroll); the whole row is the link (≥ 56 px tall).
 */
export function PlainList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
      {children}
    </ul>
  );
}

export function PlainRow({
  href,
  title,
  code,
  status,
  facts,
  aside,
  tone,
  testId,
}: {
  href: string;
  /** What it is, in words: the product, the customer, what went wrong. */
  title: ReactNode;
  /** The record number, shown small and grey after the name. */
  code?: string | null;
  status?: ReactNode;
  /** One line of plain facts ("Sari Glow Online · 2 Oct"). */
  facts?: ReactNode;
  /** Right side (a date or a count). */
  aside?: ReactNode;
  tone?: "warn" | "bad";
  testId?: string;
}) {
  return (
    <li data-testid={testId}>
      <Link
        href={href}
        className={cx(
          "flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-2 focus-visible:bg-surface-2",
          tone === "bad" && "border-l-4 border-l-[var(--bad-bd)]",
          tone === "warn" && "border-l-4 border-l-[var(--warn-bd)]",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-[15px] font-semibold text-fg">{title}</span>
            {status}
          </div>
          {(facts || code) && (
            <p className="mt-0.5 break-words text-[13px] text-fg-2">
              {facts}
              {code && <span className="ml-1 font-mono text-[12px] text-muted">{facts ? "· " : ""}{code}</span>}
            </p>
          )}
        </div>
        {aside && <div className="shrink-0 text-right text-[13px] text-fg-2">{aside}</div>}
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

/** Filter chips above a list: real links, 44 px tall, the chosen one marked for screen readers. */
export function FilterTabs({ tabs, active, label }: { tabs: readonly (readonly [string, string, string])[]; active: string; label: string }) {
  return (
    <nav className="mb-3 flex flex-wrap gap-2" aria-label={label}>
      {tabs.map(([value, text, href]) => (
        <Link
          key={value}
          href={href}
          aria-current={active === value ? "page" : undefined}
          className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[14px]", active === value ? "border-ring bg-primary-soft font-semibold" : "border-line hover:bg-surface-2")}
        >
          {text}
        </Link>
      ))}
    </nav>
  );
}

/** The record number shown small and grey (record pages keep it for search, phone calls and paper). */
export function RecordNo({ children }: { children: ReactNode }) {
  return (
    <span data-testid="record-number" className="font-mono text-[13px] text-muted">
      {children}
    </span>
  );
}
