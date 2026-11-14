import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** A white box with a hairline border and 8 px corners (ADR-136: no floating shadows, no 20 px pills). */
export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-[8px] border border-line bg-surface p-4 sm:p-5", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-section text-fg">{children}</h2>
      {action}
    </div>
  );
}

/**
 * Page header (ADR-136): the title, one short meta line under it (site · count) and the actions on the right (one
 * primary, the rest outlined, rare ones in ⋯ More). Round 4 (UX re-audit C #9): on phones, when a PageIntro is shown
 * (floor roles, who have no frame "?"), the order is title → intro → buttons (globals.css "page-header").
 */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={cx("page-header mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3", actions ? "page-header--actions" : null)}>
      <div className="page-title min-w-0 max-w-full">
        <h1 className="break-words text-title text-fg lg:text-title-lg">{title}</h1>
        {subtitle && <p className="mt-0.5 text-meta text-fg-2">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * ADR-136 buttons: 6 px corners, 36 px tall for a mouse and at least 44 px on touch screens (`pointer-coarse`), so the
 * floor phones keep their big targets. `primary` and `cta` are the same green: one per page. `secondary` is outlined.
 */
const BTN = {
  primary: "bg-primary text-white hover:bg-primary-hover border-transparent shadow-[var(--shadow-card)]",
  cta: "bg-cta text-white hover:bg-primary-hover border-transparent shadow-[var(--shadow-card)]",
  secondary: "bg-surface text-fg border-line-strong hover:bg-surface-2 shadow-[var(--shadow-card)]",
  ghost: "bg-transparent text-primary-text border-transparent hover:bg-surface-3",
  danger: "bg-[var(--bad-fg)] text-white hover:brightness-90 border-transparent",
} as const;
export type ButtonVariant = keyof typeof BTN;

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "lg" | "sm" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    // Compact for a mouse, a full 44 px target (52 px for "lg") on touch screens (UX audit R2, brief: large targets).
    size === "lg" ? "min-h-[44px] px-5 text-[15px] pointer-coarse:min-h-[52px] pointer-coarse:text-[16px]" : size === "sm" ? "min-h-[32px] px-3 text-[13px] pointer-coarse:min-h-[44px]" : "min-h-[36px] px-3.5 text-[14px] pointer-coarse:min-h-[44px] pointer-coarse:px-4",
    BTN[variant],
  );
}

export function Button({ variant = "primary", size = "md", className, ...rest }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "md" | "lg" | "sm" }) {
  return <button className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function LinkButton({ variant = "primary", size = "md", className, ...rest }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "md" | "lg" | "sm" }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[8px] border border-line bg-surface px-6 py-10 text-center" data-testid="empty-state">
      <p className="font-semibold text-fg">{title}</p>
      {children && <p className="mt-1 max-w-md text-[13px] text-fg-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Desktop table that becomes a stacked card list on phones (ux-system §4). */
export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-[8px] border border-line bg-surface", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead className="border-b border-line bg-surface-2 text-[12px] text-fg-2">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="h-10 px-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ className, ...rest }: ComponentProps<"td">) {
  return <td className={cx("h-11 px-3 py-2 align-middle", className)} {...rest} />;
}

/** A compact number tile (same look as KpiTile in src/ui/kit.tsx). */
export function Kpi({ label, value, hint, tone = "neutral", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "neutral" | "good" | "warn" | "bad"; href?: string }) {
  const hintColor = tone === "good" ? "text-[var(--ok-fg)]" : tone === "warn" ? "text-[var(--warn-fg)]" : tone === "bad" ? "text-[var(--bad-fg)]" : "text-muted";
  const body = (
    <div className={cx("h-full rounded-[8px] border border-line bg-surface px-4 py-3", href && "transition-colors hover:border-line-strong hover:bg-surface-2")}>
      <p className="text-[13px] font-medium text-fg-2">{label}</p>
      <p className="mt-1 text-stat text-fg tabular">{value}</p>
      {hint && <p className={cx("mt-0.5 text-[12px]", hintColor)}>{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-[8px]">{body}</Link> : body;
}

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-[12px] text-muted">{hint}</p>}
      {error && <p className="text-[12px] text-[var(--bad-fg)]">{error}</p>}
    </div>
  );
}

/** ADR-136: 6 px corners, 36 px for a mouse, 44 px on touch screens; 15 px text on touch (no zoom jump), 14 px with a mouse. */
export const inputClass =
  "min-h-[36px] pointer-coarse:min-h-[44px] w-full min-w-0 rounded-[6px] border border-line-strong bg-surface px-3 text-[15px] pointer-fine:text-[14px] text-fg shadow-[var(--shadow-card)] placeholder:text-muted focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-[var(--primary-soft)]";

/** Utility "families" a caller may override on a field (width, height, padding, text size, corners). */
const FAMILIES: [RegExp, RegExp][] = [
  [/^w-/, /^w-/],
  [/^min-h-/, /^min-h-/],
  // A caller's own height or text size also replaces the touch/mouse variants of the base (ADR-136).
  [/^pointer-coarse:min-h-/, /^min-h-/],
  [/^px-/, /^px-/],
  [/^text-\[\d/, /^text-\[\d/],
  [/^pointer-fine:text-\[\d/, /^text-\[\d/],
  [/^rounded/, /^rounded/],
];

/**
 * Base field classes plus the caller's, where an unprefixed caller class replaces the base class of the
 * same family. Without this, `w-full` in the base beat a caller's `w-24` (whichever Tailwind emits later
 * wins), and narrow inputs grew over their labels.
 */
export function fieldClass(base: string, extra?: string) {
  if (!extra) return base;
  const mine = extra.split(/\s+/).filter(Boolean);
  const kept = base.split(/\s+/).filter((b) => !FAMILIES.some(([fb, fe]) => fb.test(b) && mine.some((m) => fe.test(m))));
  return [...kept, ...mine].join(" ");
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={fieldClass(inputClass, props.className)} />;
}
export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={fieldClass(`${inputClass} pr-9`, props.className)} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={fieldClass(`${inputClass} min-h-[80px] py-2`, props.className)} />;
}

export function Dl({ items }: { items: [string, ReactNode][] }) {
  // Desktop (≥ 1024 px, Chrome audit 2026-11): in a side panel the three columns squeezed values to one word per
  // line; the list now takes three columns only when its own box is at least 36rem wide, else two. Phone and
  // tablet keep 2 / 3 columns as before.
  return (
    <div className="lg:@container">
      {/* Harmony pass (2026-11-08): the same label/value anatomy as SummaryGrid (src/ui/summary.tsx), text values in
          body size. Labels are sentence case in the label role, never shouting capitals. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-2 lg:@xl:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-label text-muted">{k}</dt>
            <dd className="mt-0.5 break-words text-[15px] font-medium leading-snug text-fg tabular lg:text-[14px]">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
