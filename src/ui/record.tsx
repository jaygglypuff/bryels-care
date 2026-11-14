import Link from "next/link";
import { ArrowRight, Ban, CheckCircle2, ChevronLeft, Circle, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./core";
import { Callout } from "./kit";
import { type RecordStep, shortStepLabel } from "./record-steps";
import { StatusChip } from "./status";

/**
 * The record page template (harmony pass, owner 2026-11-08; replaces the R3 card header of ADR-082 §5). Server-safe:
 * no hooks; interactive children (forms, Help, ⋯ More) are passed in as nodes. docs/ux-system.md §5.2.
 *
 * Anatomy, top to bottom (the same on every record page):
 *   1. `back`: one small text link to the list ("‹ Customer orders"), optional.
 *   2. eyebrow: the kind of record in words and the site ("Batch · NFD").
 *   3. hero row: the identifier (`reference`, e.g. "B-26-0002": large, tabular, dark, not mono-grey) with the status
 *      chip beside it; `actions` (Help "?", ⋯ More as compact icon buttons) on the right of the same row at every width.
 *   4. `title`: the name it is about (product, customer, supplier) as the subtitle.
 *   5. `meta`: one small line of facts ("Order WO-26-00002 · made 6 Nov").
 *   6. `secondary`: rare extra links as small buttons (never a row of big buttons).
 *   7. `steps`: the progress strip from the record's state machine.
 *   8. `next` / `primary`: "What to do next" as one compact line (ADR-136 Callout), with the one green button.
 * Setup records (materials, products, suppliers…) have no number people use: leave `reference` out and the name is
 * the hero (ADR-103/108 names before codes); the code goes in `meta`.
 *
 * Rules for callers (no fake buttons): `primary` is the page's existing next-step control; commands that need typed
 * input stay in their card and the caller passes `next` (a sentence) instead. Step states are never colour alone.
 * The H1 holds the identifier alone (or the name when there is none), so it reads as the record's own name.
 */
export function RecordHeader({
  reference,
  typeLabel,
  title,
  siteCode,
  status,
  statusLabel,
  chip,
  meta,
  steps = [],
  primary,
  next,
  waitingFor,
  secondary,
  actions,
  back,
}: {
  /** The identifier people say on the phone and see on paper (batch, order, lot number). */
  reference?: string | null;
  /** What kind of record, in words ("Batch", "Customer order"). */
  typeLabel: string;
  /** The name it is about (product, customer, supplier). The hero when there is no `reference`. */
  title?: ReactNode;
  siteCode?: string | null;
  /** A state-machine status for the standard chip … */
  status?: string;
  /** … with its word for this record type ("Waiting for approval"). */
  statusLabel?: string;
  /** Or the module's own chip(s) instead of `status`. */
  chip?: ReactNode;
  /** One small line: [label, value] pairs or plain facts. Empty values are left out. */
  meta?: (readonly [string, ReactNode] | ReactNode)[];
  steps?: RecordStep[];
  /** The one next action (existing control). */
  primary?: ReactNode;
  /** One sentence telling what happens next. */
  next?: ReactNode;
  /** Who we wait for, under `next`. */
  waitingFor?: ReactNode;
  /** Rare extra links or buttons (small). */
  secondary?: ReactNode;
  /** Compact icon buttons on the identifier row: <Help/>, <MoreMenu compact>. */
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  const facts = (meta ?? []).filter((m) => {
    if (m === null || m === undefined || m === false || m === "") return false;
    if (Array.isArray(m)) return m[1] !== null && m[1] !== undefined && m[1] !== "" && m[1] !== false;
    return true;
  });
  const hero = reference ?? null;
  return (
    <header className="mb-4 sm:mb-6" data-testid="record-header">
      {back && (
        <Link href={back.href} className="-ml-1.5 mb-1 inline-flex min-h-[32px] lg:hidden items-center gap-0.5 rounded-[6px] px-1.5 text-meta font-medium text-fg-2 hover:bg-surface-3 hover:text-fg pointer-coarse:min-h-[44px]">
          <ChevronLeft size={16} aria-hidden /> {back.label}
        </Link>
      )}
      <p className="text-[13px] font-medium text-fg-2">
        {typeLabel}
        {siteCode && (
          <>
            <span aria-hidden> · </span>
            <span className="sr-only">site </span>
            {siteCode}
          </>
        )}
      </p>
      <div className="mt-0.5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {hero ? (
            <h1 className="min-w-0 break-all font-sans text-id tracking-[-0.011em] text-fg lg:text-id-lg" data-testid="record-reference">
              <span data-testid="record-number">{hero}</span>
            </h1>
          ) : (
            <h1 className="min-w-0 break-words text-title text-fg lg:text-title-lg" data-testid="record-reference">
              {title}
            </h1>
          )}
          {chip ?? (status ? <StatusChip status={status} label={statusLabel} /> : null)}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 [&_a]:min-h-[36px] [&_button]:min-h-[36px] pointer-coarse:[&_a]:min-h-[44px] pointer-coarse:[&_button]:min-h-[44px]">{actions}</div>}
      </div>
      {hero && title && <p className="mt-0.5 break-words text-subtitle text-fg-2">{title}</p>}
      {facts.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-muted">
          {facts.map((m, i) => (
            // The dot goes after each fact, so a wrapped line never starts with "·".
            <span key={i} className="min-w-0">
              {Array.isArray(m) ? (
                <>
                  {m[0]} <span className="text-fg-2">{m[1]}</span>
                </>
              ) : (
                (m as ReactNode)
              )}
              {i < facts.length - 1 && (
                <span aria-hidden className="ml-1.5">
                  ·
                </span>
              )}
            </span>
          ))}
        </p>
      )}
      {secondary && <div className="mt-3 flex max-w-full flex-wrap items-center gap-2 [&_a]:min-h-[44px] [&_button]:min-h-[44px] pointer-fine:[&_a]:min-h-[36px] pointer-fine:[&_button]:min-h-[36px]">{secondary}</div>}

      {steps.length > 0 && <RecordProgress steps={steps} />}

      {(primary || next) && (
        // ADR-136: one compact line (Callout) instead of the big green box; div content: callers may pass block
        // content (a warning line, WhoCanHelp) — ADR-123.
        next ? (
          <Callout className="mb-0 mt-4" waitingFor={waitingFor} action={primary}>
            {next}
          </Callout>
        ) : (
          <div className="mt-4">{primary}</div>
        )
      )}
    </header>
  );
}

/** A tiny link-arrow used by callers that want "Open …" as a tertiary text action in `secondary`. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-[36px] items-center gap-1 rounded-[6px] px-2 text-[14px] font-medium text-primary-text hover:bg-surface-3 pointer-coarse:min-h-[44px]">
      {children} <ArrowRight size={14} aria-hidden />
    </Link>
  );
}

const STEP_WORD: Record<RecordStep["state"], string> = { done: "done", current: "current step", blocked: "stopped", upcoming: "not yet" };

/** Compact horizontal progress strip: wraps on phones, icon + text per step, never colour alone. */
function RecordProgress({ steps }: { steps: RecordStep[] }) {
  return (
    <>
      <CompactProgress steps={steps} />
      <div className="hidden sm:block">
        <FullProgress steps={steps} />
      </div>
    </>
  );
}

/**
 * Phones (harmony pass 2026-11-08): "Step 3 of 10 · Confirmed" and a thin bar, the next step named, instead of ten
 * pills that pushed the task below the first screen (ux-system 5.14). Stopped records say so with an icon.
 */
function CompactProgress({ steps }: { steps: RecordStep[] }) {
  const idx = steps.findIndex((s) => s.state === "current" || s.state === "blocked");
  const at = idx >= 0 ? idx : steps.filter((s) => s.state === "done").length - 1;
  const here = steps[at];
  const blocked = here?.state === "blocked";
  const following = steps.slice(at + 1).find((s) => s.state === "upcoming");
  return (
    <div className="mt-3 sm:hidden" data-testid="record-progress-compact">
      <p className="flex flex-wrap items-center gap-x-1.5 text-meta text-fg-2">
        {blocked ? <Ban size={14} aria-hidden className="text-[var(--rej-fg)]" /> : <CircleDot size={14} aria-hidden className="text-primary" />}
        <span>
          Step {at + 1} of {steps.length}: <span className="font-semibold text-fg">{here?.label ?? "—"}</span>
        </span>
        {following && !blocked && <span className="text-muted">· then {following.label.toLowerCase()}</span>}
      </p>
      <div aria-hidden className="mt-1.5 flex gap-1">
        {steps.map((s, i) => (
          <span key={i} className={cx("h-1 flex-1 rounded-[2px]", s.state === "done" ? "bg-[var(--ok-fg)]" : s.state === "current" ? "bg-primary" : s.state === "blocked" ? "bg-[var(--rej-fg)]" : "bg-line-strong")} />
        ))}
      </div>
    </div>
  );
}

function FullProgress({ steps }: { steps: RecordStep[] }) {
  return (
    // Desktop (≥ 1024 px, live check 2026-11-06): one row. Steps other than the current one use shorter words
    // (shortStepLabel, full words in the tooltip) and, if still too long, shrink with an ellipsis; phones wrap as before.
    <ol className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 lg:flex-nowrap" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={`${i}-${s.label}`} aria-current={s.state === "current" ? "step" : undefined} className={cx("flex min-w-0 items-center gap-1", s.state === "current" && "lg:shrink-0")} title={s.label}>
          {i > 0 && <span aria-hidden className={cx("h-px w-3 shrink-0 sm:w-5 lg:w-3 2xl:w-5", s.state === "upcoming" ? "bg-line-strong" : "bg-[var(--ok-fg)]")} />}
          <span
            className={cx(
              "inline-flex min-h-[28px] min-w-0 items-center gap-1.5 rounded-[6px] border px-2 py-0.5 text-[13px] leading-tight",
              s.state === "done" && "border-transparent text-[var(--ok-fg)]",
              s.state === "current" && "border-primary bg-[var(--nav-active-bg)] font-semibold text-fg",
              s.state === "blocked" && "border-[var(--rej-bd)] bg-[var(--rej-bg)] font-semibold text-[var(--rej-fg)]",
              s.state === "upcoming" && "border-transparent text-muted",
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
            {s.state === "current" || shortStepLabel(s.label) === s.label ? (
              <span className="break-words lg:truncate">{s.label}</span>
            ) : (
              <>
                <span className="break-words lg:hidden">{s.label}</span>
                <span className="hidden truncate lg:inline" aria-hidden>
                  {shortStepLabel(s.label)}
                </span>
                <span className="sr-only hidden lg:inline">{s.label}</span>
              </>
            )}
            <span className="sr-only">({STEP_WORD[s.state]})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
