import { Ban, CheckCircle2, Circle, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./core";
import type { RecordStep } from "./record-steps";
import { StatusChip } from "./status";

/**
 * Shared record header (slice R3, UX-21; docs/WORKFLOW_ARCHITECTURE.md §5). Server-safe: no hooks,
 * no "use client"; interactive children (forms) are passed in as nodes.
 *
 * One layout for purchase order, goods receipt, sales order and shipment pages, modelled on the
 * production order hub (ADR-080): what it is (type, reference, site), who it is for (title), where it
 * stands (status chip + progress strip) and the ONE next action.
 *
 * Rules for callers (no fake buttons):
 * - `primary` is the page's existing next-step control (a link or a single-click server-action form).
 *   Commands that need typed input (reasons, notes, driver details) stay in their card below; the
 *   caller may then pass `next` (a short sentence) instead of a button.
 * - `secondary` holds the other existing links (print, back to list) in a quiet style.
 * - Step states are never shown by colour alone: each has an icon and a screen-reader word.
 */
export function RecordHeader({
  reference,
  typeLabel,
  title,
  siteCode,
  status,
  statusLabel,
  meta,
  steps,
  primary,
  next,
  secondary,
}: {
  reference: string;
  typeLabel: string;
  title: string;
  siteCode?: string | null;
  status: string;
  /** Overrides the chip's default word for this status (e.g. "Waiting for approval"). */
  statusLabel?: string;
  meta?: [string, ReactNode][];
  steps: RecordStep[];
  /** The one next action (existing control). */
  primary?: ReactNode;
  /** One sentence telling what happens next when the action lives further down or belongs to someone else. */
  next?: ReactNode;
  secondary?: ReactNode;
}) {
  const items = (meta ?? []).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <header className="mb-4 rounded-[24px] bg-surface p-4 shadow-[var(--shadow-card)] sm:p-6" data-testid="record-header">
      {/* The title never shares a phone-width row with the buttons: it takes the full row (below 640 px always;
          above that whenever the buttons would leave it under 18rem), so names never break one word per line. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_100%] sm:flex-[1_1_18rem]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
            <span>{typeLabel}</span>
            <span aria-hidden>·</span>
            <span className="font-mono normal-case tracking-normal text-fg" data-testid="record-reference">{reference}</span>
            {siteCode && (
              <>
                <span aria-hidden>·</span>
                <span>
                  <span className="sr-only">Site </span>
                  {siteCode}
                </span>
              </>
            )}
          </p>
          <h1 className="mt-1 break-words font-display text-[24px] font-semibold leading-tight tracking-tight text-fg sm:text-[30px]">
            <span className="sr-only">
              {typeLabel} {reference}:{" "}
            </span>
            {title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-fg-2">
            <StatusChip status={status} label={statusLabel} />
            {items.map(([k, v]) => (
              <span key={k} className="min-w-0">
                <span className="text-muted">{k}</span> <span className="text-fg">{v}</span>
              </span>
            ))}
          </div>
        </div>
        {secondary && <div className="flex max-w-full flex-wrap items-center gap-2 [&_a]:min-h-[44px] [&_button]:min-h-[44px] [&_summary]:min-h-[44px]">{secondary}</div>}
      </div>

      {steps.length > 0 && <RecordProgress steps={steps} />}

      {(primary || next) && (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          {next && <p className="min-w-0 text-[14px] text-fg-2">{next}</p>}
          {primary && <div className="min-w-0 sm:ml-auto [&_a]:w-full [&_button]:w-full sm:[&_a]:w-auto sm:[&_button]:w-auto">{primary}</div>}
        </div>
      )}
    </header>
  );
}

const STEP_WORD: Record<RecordStep["state"], string> = { done: "done", current: "current step", blocked: "stopped", upcoming: "not yet" };

/** Compact horizontal progress strip: wraps on phones, icon + text per step, never colour alone. */
export function RecordProgress({ steps }: { steps: RecordStep[] }) {
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={`${i}-${s.label}`} aria-current={s.state === "current" ? "step" : undefined} className="flex min-w-0 items-center gap-1">
          {i > 0 && <span aria-hidden className={cx("h-px w-3 sm:w-5", s.state === "upcoming" ? "bg-line-strong" : "bg-[var(--ok-fg)]")} />}
          <span
            className={cx(
              "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] leading-tight",
              s.state === "done" && "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]",
              s.state === "current" && "border-primary bg-primary-soft font-semibold text-fg",
              s.state === "blocked" && "border-[var(--rej-bd)] bg-[var(--rej-bg)] font-semibold text-[var(--rej-fg)]",
              s.state === "upcoming" && "border-line bg-surface text-muted",
            )}
          >
            {s.state === "done" ? (
              <CheckCircle2 size={14} aria-hidden className="shrink-0" />
            ) : s.state === "current" ? (
              <CircleDot size={14} aria-hidden className="shrink-0" />
            ) : s.state === "blocked" ? (
              <Ban size={14} aria-hidden className="shrink-0" />
            ) : (
              <Circle size={14} aria-hidden className="shrink-0" />
            )}
            <span className="break-words">{s.label}</span>
            <span className="sr-only">({STEP_WORD[s.state]})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
