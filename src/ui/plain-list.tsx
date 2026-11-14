import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "./core";
import { Tabs } from "./kit";

/**
 * Grade-5 record list (ADR-088): one row per record, the name or product first, the record number small and
 * grey, the status as a chip with an icon, one line of plain facts. The same list on a 390 px phone and on a
 * desktop (no wide table, no sideways scroll); the whole row is the link (≥ 56 px tall).
 */
export function PlainList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-line overflow-hidden rounded-[8px] border border-line bg-surface">
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
          "flex min-h-[52px] items-center gap-3 px-4 py-2.5 hover:bg-surface-2 focus-visible:bg-surface-2",
          tone === "bad" && "shadow-[inset_3px_0_0_var(--bad-fg)]",
          tone === "warn" && "shadow-[inset_3px_0_0_var(--warn-fg)]",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-[15px] font-medium text-fg lg:text-[14px]">{title}</span>
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
        <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

/**
 * Filters above a list as underline tabs (ADR-136; were pill chips): real links, the chosen one marked for screen
 * readers. A "(3)" count at the end of a label becomes the grey count pill.
 */
export function FilterTabs({ tabs, active, label }: { tabs: readonly (readonly [string, string, string])[]; active: string; label: string }) {
  return (
    <Tabs
      className="mb-3"
      label={label}
      active={active}
      items={tabs.map(([value, text, href]) => {
        const m = text.match(/^(.*?)\s*\((\d[\d,]*)\)$/);
        return m ? { key: value, label: m[1], href, count: Number(m[2].replace(/,/g, "")) } : { key: value, label: text, href };
      })}
    />
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
