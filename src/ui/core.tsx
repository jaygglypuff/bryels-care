import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-[17px] font-semibold text-fg">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-fg sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const BTN = {
  primary: "bg-primary text-white hover:bg-primary-hover border-transparent",
  cta: "bg-cta text-white hover:bg-black border-transparent",
  secondary: "bg-surface text-fg border-line hover:bg-surface-2 hover:border-line-strong",
  ghost: "bg-transparent text-primary-text border-transparent hover:bg-primary-soft",
  danger: "bg-[#c62828] text-white hover:bg-[#8a1c1c] border-transparent",
} as const;
export type ButtonVariant = keyof typeof BTN;

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "lg" | "sm" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-full border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "lg" ? "min-h-[52px] px-6 text-[16px]" : size === "sm" ? "min-h-[34px] px-3.5 text-[13px]" : "min-h-[44px] px-5 text-[14px]",
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
    <div className="flex flex-col items-center justify-center rounded-[20px] border border-dashed border-line-strong bg-surface-2/60 px-6 py-10 text-center">
      <p className="font-medium text-fg">{title}</p>
      {children && <p className="mt-1 max-w-md text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Desktop table that becomes a stacked card list on phones (ux-system §4). */
export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-[16px] border border-line bg-surface", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 font-semibold">
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
  return <td className={cx("px-3 py-2.5 align-middle", className)} {...rest} />;
}

export function Kpi({ label, value, hint, tone = "neutral", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "neutral" | "good" | "warn" | "bad"; href?: string }) {
  const hintColor = tone === "good" ? "text-[var(--ok-fg)]" : tone === "warn" ? "text-[var(--warn-fg)]" : tone === "bad" ? "text-[var(--bad-fg)]" : "text-muted";
  const body = (
    <Card className="h-full transition-shadow hover:shadow-[var(--shadow-pop)]">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-3 font-display text-[34px] font-semibold leading-none text-fg tabular">{value}</p>
      {hint && <p className={cx("mt-2 text-[12px]", hintColor)}>{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
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

export const inputClass =
  "min-h-[44px] w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-[14px] text-fg placeholder:text-muted focus:border-ring focus:outline-none focus:ring-2 focus:ring-[var(--lime-200)]";

/** Utility "families" a caller may override on a field (width, height, padding, text size, corners). */
const FAMILIES: [RegExp, RegExp][] = [
  [/^w-/, /^w-/],
  [/^min-h-/, /^min-h-/],
  [/^px-/, /^px-/],
  [/^text-\[\d/, /^text-\[\d/],
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
  return <select {...props} className={fieldClass(inputClass, props.className)} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={fieldClass(`${inputClass} min-h-[80px] py-2`, props.className)} />;
}

export function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-[14px] text-fg tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
