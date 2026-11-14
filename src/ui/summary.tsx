import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./core";

/**
 * Record summary (harmony pass, owner 2026-11-08: "the summary is ugly"): label/value pairs in a grid instead of a
 * run-on sentence. Two columns on a phone, three or four when the box is wide (container query, so it also works in a
 * side column). Values are bold numbers with their unit; one small line under the value says the rest
 * ("expected 96", "OK 95–102 %"). A value outside its range is marked with an icon and a word, never colour alone.
 * Server-safe. docs/ux-system.md §5.26.
 */
export type SummaryItem = {
  label: string;
  value: ReactNode;
  /** Unit after the number, smaller ("pcs", "%", "kg"). */
  unit?: ReactNode;
  /** One small line under the value. */
  sub?: ReactNode;
  /** `warn`/`bad` add an icon and colour the value; `ok` adds a check. */
  tone?: "ok" | "warn" | "bad";
  /** Spans two columns (a long text value such as a lot with its expiry). */
  wide?: boolean;
  testId?: string;
};

const TONE_ICON = {
  ok: <CheckCircle2 size={16} aria-hidden className="shrink-0 text-[var(--ok-fg)]" />,
  warn: <AlertTriangle size={16} aria-hidden className="shrink-0 text-[var(--warn-fg)]" />,
  bad: <XCircle size={16} aria-hidden className="shrink-0 text-[var(--bad-fg)]" />,
} as const;
const TONE_WORD = { ok: "within range", warn: "check this", bad: "not OK" } as const;

export function SummaryGrid({ items, footer, className, label }: { items: (SummaryItem | null | false | undefined)[]; footer?: ReactNode; className?: string; label?: string }) {
  const shown = items.filter(Boolean) as SummaryItem[];
  return (
    <div className={cx("@container", className)}>
      <dl aria-label={label} className="grid grid-cols-2 gap-x-4 gap-y-4 @md:grid-cols-3 @2xl:grid-cols-4">
        {shown.map((it) => (
          <div key={it.label} className={cx("min-w-0", it.wide && "col-span-2")} data-testid={it.testId}>
            <dt className="text-label text-muted">{it.label}</dt>
            <dd className="mt-1">
              <span className={cx("flex items-baseline gap-1.5", it.tone === "warn" && "text-[var(--warn-fg)]", it.tone === "bad" && "text-[var(--bad-fg)]")}>
                {it.tone && <span className="self-center">{TONE_ICON[it.tone]}</span>}
                <span className={cx("min-w-0 break-words text-value tabular", it.tone === "warn" || it.tone === "bad" ? "" : "text-fg")}>{it.value}</span>
                {it.unit && <span className="text-[14px] font-medium text-fg-2">{it.unit}</span>}
                {it.tone && it.tone !== "ok" && <span className="sr-only">({TONE_WORD[it.tone]})</span>}
              </span>
              {it.sub && <span className="mt-0.5 block break-words text-meta text-muted">{it.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {footer && <div className="mt-4 border-t border-line pt-3">{footer}</div>}
    </div>
  );
}

/**
 * "Nothing went wrong" as one quiet line instead of a card (owner 2026-11-08). The full sentence of what was checked
 * opens under it when tapped, so the information is kept.
 */
export function QuietLine({ children, detail, tone = "ok", testId }: { children: ReactNode; detail?: ReactNode; tone?: "ok" | "neutral"; testId?: string }) {
  const icon = tone === "ok" ? <CheckCircle2 size={16} aria-hidden className="shrink-0 text-[var(--ok-fg)]" /> : null;
  if (!detail)
    return (
      <p className="flex min-h-[40px] items-center gap-2 px-1 text-[14px] text-fg-2" data-testid={testId}>
        {icon}
        {children}
      </p>
    );
  return (
    <details className="px-1" data-testid={testId}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[14px] text-fg-2 [&::-webkit-details-marker]:hidden">
        {icon}
        <span>{children}</span>
        <span className="text-meta font-medium text-primary-text">what was checked</span>
      </summary>
      <p className="pb-2 pl-6 text-meta text-muted">{detail}</p>
    </details>
  );
}
