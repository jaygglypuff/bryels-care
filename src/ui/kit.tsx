import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Hourglass, Search } from "lucide-react";
import Decimal from "decimal.js";
import { buttonClass, cx } from "./core";
import { BADGE, toneClass, type BadgeTone } from "./status";

/**
 * ADR-136 building blocks for a standard business screen (docs/ux-system.md §5.30–5.37). Server-safe: no hooks, so
 * server pages render them directly; the two interactive helpers (FilterSelect, RowClicks) are in kit-client.tsx.
 *
 *   PageHeader (core.tsx) → Toolbar (search · Tabs · filters · actions) → DataTable (+ TableFooter) — list pages
 *   Panel, KpiTile — dashboards and record side columns
 *   Callout — one compact line for "what to do next" or something the person must do
 *   Badge — small square-ish status label (StatusChip/Chip in status.tsx use the same look)
 */

// ---------------------------------------------------------------- Badge

export function Badge({ tone = "neu", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cx(BADGE, toneClass(tone), className)}>{children}</span>;
}

/** A small grey count after a tab or a heading ("12"). */
export function Count({ n, className }: { n: number | string; className?: string }) {
  return <span className={cx("rounded-[4px] bg-surface-3 px-1.5 text-[12px] font-medium leading-[18px] text-fg-2 tabular", className)}>{n}</span>;
}

// ---------------------------------------------------------------- Tabs

export type TabItem = { key: string; label: string; href: string; count?: number | null };

/**
 * Underline tabs (status of a list, parts of a page). Real links, the chosen one marked `aria-current="page"`. One row
 * that scrolls sideways on a phone; 40 px tall with a mouse, 44 px on touch screens. Counts sit in a grey pill after
 * the word, so a list never repeats them in stat cards.
 */
export function Tabs({ items, active, label, className, testId, bare = false }: { items: readonly TabItem[]; active: string; label: string; className?: string; testId?: string; /** No line under the row (ListToolbar draws it). */ bare?: boolean }) {
  return (
    <nav aria-label={label} className={cx("scroll-x-hidden -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)} data-testid={testId}>
      <ul className={cx("flex min-w-max gap-5", !bare && "border-b border-line")}>
        {items.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key || "all"}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "-mb-px flex min-h-[40px] items-center gap-1.5 whitespace-nowrap border-b-2 text-[14px] font-medium pointer-coarse:min-h-[44px]",
                  on ? "border-primary text-fg" : "border-transparent text-fg-2 hover:border-line-strong hover:text-fg",
                )}
              >
                {t.label}
                {t.count !== undefined && t.count !== null && <Count n={t.count} className={on ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]" : undefined} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------- Toolbar

/**
 * The list toolbar (ADR-136): the status tabs on the left and the search box, filter dropdowns and actions on the
 * right, on one line with one rule under it from 1024 px; on a phone the controls come first and the tabs scroll
 * under them.
 */
export function ListToolbar({ tabs, children, testId }: { tabs?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="mb-4 flex flex-col-reverse gap-2 border-line lg:flex-row lg:items-end lg:justify-between lg:gap-6 lg:border-b" data-testid={testId}>
      {tabs && <div className="min-w-0 lg:-mb-px lg:[&_ul]:border-b-0">{tabs}</div>}
      {children && <div className="flex min-w-0 flex-wrap items-center gap-2 lg:ml-auto lg:flex-nowrap lg:pb-2">{children}</div>}
    </div>
  );
}

/** One row above a list: search box, filters and actions; wraps on a phone. */
export function Toolbar({ children, className, label = "Filters" }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div role="group" aria-label={label} className={cx("mb-3 flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}

/**
 * The toolbar's search box: a GET form (works before JavaScript loads), Enter searches. `keep` carries the other
 * filters of the page. A "Clear" link shows while there are words.
 */
export function ToolbarSearch({ action, defaultValue, placeholder, label, keep = {}, name = "q", clearHref, className }: { action: string; defaultValue?: string; placeholder: string; label: string; keep?: Record<string, string | undefined>; name?: string; clearHref?: string; className?: string }) {
  return (
    <form role="search" action={action} method="get" className={cx("flex min-w-0 flex-1 basis-[220px] items-center gap-2 sm:max-w-[340px]", className)}>
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative min-w-0 flex-1">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-label={label}
          enterKeyHint="search"
          className="min-h-[36px] w-full min-w-0 rounded-[6px] border border-line-strong bg-surface pl-9 pr-3 text-[15px] text-fg shadow-[var(--shadow-card)] placeholder:text-muted focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-[var(--primary-soft)] pointer-coarse:min-h-[44px] pointer-fine:text-[14px]"
        />
      </div>
      {defaultValue && clearHref && (
        <Link href={clearHref} className={buttonClass("ghost", "sm")}>
          Clear
        </Link>
      )}
    </form>
  );
}

// ---------------------------------------------------------------- DataTable

export type SortDir = "asc" | "desc";
export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Numbers and money: right-aligned, tabular figures. */
  align?: "left" | "right";
  /** The column that names the record: its cell is the row's link (keyboard and screen readers). */
  primary?: boolean;
  /** Sortable on the server (the page reads `sort`/`dir`). */
  sortable?: boolean;
  /** Hide on narrow screens. */
  hideBelow?: "md" | "lg" | "xl";
  className?: string;
  headClassName?: string;
};

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = { md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

/**
 * A data table (ADR-136 list pattern): sticky header under the top bar, sortable columns where the data allows,
 * numbers right-aligned with tabular figures, 48 px rows, the whole row opens the record (RowClicks in the shell; the
 * primary cell is also a real link), an optional muted meta line inside a cell, and a footer with the count.
 * `mobile` renders the same rows as cards below 768 px (production orders); without it the table scrolls sideways
 * inside its box on a phone.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  sort,
  label,
  footer,
  mobile,
  rowTone,
  rowTestId,
  rowProps,
  testId,
  minWidth = 640,
}: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string | null | undefined;
  sort?: { key: string; dir: SortDir; href: (key: string, dir: SortDir) => string };
  label: string;
  footer?: ReactNode;
  mobile?: (row: T) => ReactNode;
  /** A red or amber bar at the start of the row (late, blocked); the cell text says why. */
  rowTone?: (row: T) => "bad" | "warn" | null | undefined;
  rowTestId?: string;
  rowProps?: (row: T) => Record<string, string | undefined>;
  testId?: string;
  minWidth?: number;
}) {
  const table = (
    <div className={cx("rounded-[8px] border border-line bg-surface max-lg:overflow-x-auto", mobile && "hidden md:block")} data-testid={testId}>
      <table className="w-full border-collapse text-left text-[14px]" style={{ minWidth }} aria-label={label}>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const sorted = sort && sort.key === c.key ? sort.dir : null;
              const next: SortDir = sorted === "asc" ? "desc" : "asc";
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}
                  className={cx(
                    "sticky top-[calc(3.5rem+var(--demo-h,0px))] z-[1] h-10 whitespace-nowrap border-b border-line bg-surface-2 px-3 text-[12px] font-medium text-fg-2 first:pl-4 last:pr-4",
                    i === 0 && "rounded-tl-[8px]",
                    i === columns.length - 1 && "rounded-tr-[8px]",
                    c.align === "right" && "text-right",
                    c.hideBelow && HIDE[c.hideBelow],
                    c.headClassName,
                  )}
                >
                  {c.sortable && sort ? (
                    <Link href={sort.href(c.key, next)} scroll={false} className={cx("inline-flex items-center gap-1 hover:text-fg", sorted && "text-fg", c.align === "right" && "flex-row-reverse")}>
                      {c.header}
                      {sorted === "asc" ? <ArrowUp size={13} aria-hidden /> : sorted === "desc" ? <ArrowDown size={13} aria-hidden /> : <ArrowUpDown size={13} aria-hidden className="opacity-40" />}
                    </Link>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const href = rowHref?.(r) ?? undefined;
            const tone = rowTone?.(r);
            return (
              <tr key={rowKey(r)} data-href={href} data-testid={rowTestId} {...(rowProps?.(r) ?? {})} className={cx(href && "cursor-pointer", "hover:bg-surface-2")}>
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cx(
                      "h-12 px-3 py-2 align-middle first:pl-4 last:pr-4",
                      c.align === "right" && "whitespace-nowrap text-right tabular",
                      i === 0 && tone === "bad" && "shadow-[inset_3px_0_0_var(--bad-fg)]",
                      i === 0 && tone === "warn" && "shadow-[inset_3px_0_0_var(--warn-fg)]",
                      c.hideBelow && HIDE[c.hideBelow],
                      c.className,
                    )}
                  >
                    {c.primary && href ? (
                      <Link href={href} className="font-medium text-fg hover:text-primary-text">
                        {c.cell(r)}
                      </Link>
                    ) : (
                      c.cell(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer && <div className="border-t border-line px-4 py-2.5 text-[13px] text-fg-2">{footer}</div>}
    </div>
  );
  if (!mobile) return table;
  return (
    <>
      {/* The table first in the page (desktop), the phone cards after it. */}
      {table}
      <div className="md:hidden">
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[8px] border border-line bg-surface" aria-label={label}>
          {rows.map((r) => (
            <li key={rowKey(r)} data-testid={rowTestId}>
              {mobile(r)}
            </li>
          ))}
        </ul>
        {footer && <div className="px-1 pt-2 text-[13px] text-fg-2">{footer}</div>}
      </div>
    </>
  );
}

/** A phone row of a DataTable (`mobile`): the whole row a link, title + status, one muted line, a value on the right. */
export function MobileRow({ href, title, status, meta, aside, tone }: { href: string; title: ReactNode; status?: ReactNode; meta?: ReactNode; aside?: ReactNode; tone?: "bad" | "warn" | null }) {
  return (
    <Link href={href} className={cx("flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-2", tone === "bad" && "shadow-[inset_3px_0_0_var(--bad-fg)]", tone === "warn" && "shadow-[inset_3px_0_0_var(--warn-fg)]")}>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-[15px] font-medium text-fg">{title}</span>
          {status}
        </span>
        {meta && <span className="mt-0.5 block break-words text-[13px] text-fg-2">{meta}</span>}
      </span>
      {aside && <span className="shrink-0 text-right text-[14px] font-medium tabular text-fg">{aside}</span>}
      <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
    </Link>
  );
}

/** A muted second line inside a table cell ("Aloe Hand Lotion × 48"). */
export function CellMeta({ children }: { children: ReactNode }) {
  return <span className="mt-0.5 block text-[13px] font-normal leading-snug text-muted">{children}</span>;
}

/** The record number in a table: small, tabular, grey (not a link of its own; the row opens). */
export function CellCode({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap font-mono text-[12.5px] text-fg-2">{children}</span>;
}

/** Sort helper for lists that are already loaded on the server (at most a few hundred rows). */
const DECIMAL = /^-?\d+(\.\d+)?$/;
/** Quantities and money arrive as decimal strings: they are compared with decimal.js, never as floats. */
export function sortRows<T>(rows: readonly T[], dir: SortDir, by: (r: T) => string | number | null | undefined): T[] {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = by(a);
    const y = by(b);
    if (x === y) return 0;
    if (x === null || x === undefined || x === "") return 1;
    if (y === null || y === undefined || y === "") return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * m;
    if (typeof x === "string" && typeof y === "string" && DECIMAL.test(x) && DECIMAL.test(y)) return new Decimal(x).cmp(y) * m;
    return String(x).localeCompare(String(y), "en", { numeric: true }) * m;
  });
}

/** Reads `sort`/`dir` from the search params, falling back to the page's default. */
export function readSort(sp: { sort?: string; dir?: string }, allowed: readonly string[], fallback: { key: string; dir: SortDir }): { key: string; dir: SortDir } {
  const key = sp.sort && allowed.includes(sp.sort) ? sp.sort : fallback.key;
  const dir: SortDir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : key === fallback.key ? fallback.dir : "asc";
  return { key, dir };
}

/** "2 orders" on the left; page links on the right when there is more than one page. */
export function TableFooter({ count, noun, note, page, pageCount, pageHref }: { count: number; noun: [string, string]; note?: ReactNode; page?: number; pageCount?: number; pageHref?: (p: number) => string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="tabular">
        {count.toLocaleString("en-PH")} {count === 1 ? noun[0] : noun[1]}
        {note ? <span className="text-muted"> · {note}</span> : null}
      </span>
      {page && pageCount && pageCount > 1 && pageHref && (
        <span className="flex items-center gap-1">
          <span className="mr-1 text-muted">
            Page {page} of {pageCount}
          </span>
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")} aria-label="Previous page">
              <ChevronLeft size={14} aria-hidden />
            </Link>
          ) : null}
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className={buttonClass("secondary", "sm")} aria-label="Next page">
              <ChevronRight size={14} aria-hidden />
            </Link>
          ) : null}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Panel and KpiTile

/** A titled box of a dashboard or a record's side column: header row (title, count, action), body, optional footer. */
export function Panel({ title, count, action, children, footer, flush = false, className, testId, id }: { title: ReactNode; count?: number | null; action?: ReactNode; children: ReactNode; footer?: ReactNode; flush?: boolean; className?: string; testId?: string; id?: string }) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section aria-labelledby={hid} className={cx("min-w-0 rounded-[8px] border border-line bg-surface", className)} data-testid={testId} id={id}>
      <header className="flex min-h-[48px] items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 id={hid} className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          {title}
          {count !== undefined && count !== null && <Count n={count} />}
        </h2>
        {action && <div className="flex shrink-0 items-center gap-2 text-[13px]">{action}</div>}
      </header>
      <div className={flush ? undefined : "p-4"}>{children}</div>
      {footer && <div className="border-t border-line px-4 py-2.5 text-[13px]">{footer}</div>}
    </section>
  );
}

/** A link in a panel header ("See all"). */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-[32px] items-center gap-1 font-medium text-primary-text hover:underline pointer-coarse:min-h-[44px]">
      {children}
    </Link>
  );
}

/** One row of a panel list: text, a muted line under it, the whole row a link. */
export function PanelRow({ href, title, meta, icon, aside }: { href: string; title: ReactNode; meta?: ReactNode; icon?: ReactNode; aside?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="group flex min-h-[52px] items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        {icon && <span className="shrink-0 text-fg-2" aria-hidden>{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-fg">{title}</span>
          {meta && <span className="block text-[13px] text-fg-2">{meta}</span>}
        </span>
        {aside}
        <ChevronRight size={16} className="shrink-0 text-muted group-hover:text-fg-2" aria-hidden />
      </Link>
    </li>
  );
}

/** A compact KPI tile: label, number, one short line; the whole tile opens what is behind the number. */
export function KpiTile({ label, value, sub, href, attention = false, icon, testId }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; attention?: boolean; icon?: ReactNode; testId?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
        {icon && <span className="text-muted [&_svg]:size-4" aria-hidden>{icon}</span>}
        {label}
        {attention && <span className="ml-auto size-2 shrink-0 rounded-full bg-[var(--warn-fg)]" aria-hidden />}
      </span>
      <span className="mt-1 block break-words text-stat text-fg tabular">{value}</span>
      {sub && <span className={cx("mt-0.5 block text-[12.5px] leading-snug", attention ? "font-medium text-[var(--warn-fg)]" : "text-fg-2")}>{sub}</span>}
    </>
  );
  const cls = cx("block h-full min-w-0 rounded-[8px] border bg-surface px-4 py-3", attention ? "border-[var(--warn-bd)]" : "border-line", href && "transition-colors hover:border-line-strong hover:bg-surface-2");
  return href ? (
    <Link href={href} className={cls} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------- Callout

/**
 * One compact line for the next step of a record or something the person must do (ADR-136; replaces the big green
 * "What to do next" box). Neutral surface, a 3 px green bar at the start, the sentence, an optional "waiting for" line
 * and the action on the right (wraps under the text on a phone). Labelled "What to do next" for screen readers.
 */
export function Callout({
  children,
  waitingFor,
  action,
  tone = "next",
  label = "What to do next",
  className,
  id,
  testId,
  body,
}: {
  children: ReactNode;
  waitingFor?: ReactNode;
  action?: ReactNode;
  tone?: "next" | "warn" | "bad" | "info";
  label?: string;
  className?: string;
  id?: string;
  testId?: string;
  /** Block content under the line (a form that is the next step). */
  body?: ReactNode;
}) {
  const bar = tone === "warn" ? "border-l-[var(--warn-fg)]" : tone === "bad" ? "border-l-[var(--bad-fg)]" : tone === "info" ? "border-l-[var(--info-fg)]" : "border-l-primary";
  return (
    <section aria-label={label} id={id} data-testid={testId} className={cx("next-callout mb-4 scroll-mt-24 rounded-[8px] border border-l-[3px] border-line bg-surface px-3.5 py-2.5", bar, className)}>
      <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-center">
        <div className="min-w-0 min-[480px]:flex-[1_1_16rem]">
          <div className="flex items-start gap-2 text-[14px] font-medium leading-snug text-fg">
            {tone === "next" && <ArrowRight size={16} aria-hidden className="mt-0.5 shrink-0 text-primary-text" />}
            <div className="min-w-0">{children}</div>
          </div>
          {waitingFor && (
            <div className="mt-0.5 flex items-start gap-1.5 pl-6 text-[13px] text-fg-2">
              <Hourglass size={13} aria-hidden className="mt-0.5 shrink-0" />
              <div className="min-w-0">{waitingFor}</div>
            </div>
          )}
        </div>
        {action && <div className="min-w-0 shrink-0 min-[480px]:ml-auto [&_a]:w-full [&_button]:w-full min-[480px]:[&_a]:w-auto min-[480px]:[&_button]:w-auto">{action}</div>}
      </div>
      {body && <div className="mt-3 flex flex-col gap-3">{body}</div>}
    </section>
  );
}
