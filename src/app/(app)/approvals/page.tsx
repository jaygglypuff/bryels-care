import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { currentHref, isInternalPath, recordHref } from "@/lib/record-links";
import { type ApprovalRow, myApprovalInbox, refreshActionItems } from "@/modules/action-centre";
import { registerAppHooks } from "@/modules/wiring";
import Link from "next/link";
import { EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Panel } from "@/ui/kit";
import { Banner, Chip } from "@/ui/status";
import { InlineDecision } from "./forms";
import { INLINE_DECISIONS } from "./inline";

registerAppHooks(); // cross-module action-item sources and approval verdicts (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "To approve" };
export const dynamic = "force-dynamic";

/** "27 days", "5 hours", "12 minutes": how long it has been waiting (no "ago"). */
function waited(minutes: number) {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 48 * 60) {
    const h = Math.round(minutes / 60);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(minutes / 1440);
  return `${d} days`;
}

const rowHref = (a: ApprovalRow) => (isInternalPath(a.link) ? currentHref(a.link) : (recordHref(a.entityType, a.entityId) ?? "/action-centre"));

/**
 * One row. `pick` (desktop ≥ 1280 px, live check 2026-11-06): the decide buttons move to the detail panel beside the
 * list; the row shows "Show here" and is highlighted when `selected`. Below 1280 px the row keeps its buttons.
 */
function Row({ a, decidable, first = false, pick, selected = false }: { a: ApprovalRow; decidable: boolean; /** Round 4 (UX re-audit C #8): only the oldest row gets the green button. */ first?: boolean; pick?: string; selected?: boolean }) {
  const href = rowHref(a);
  const inline = INLINE_DECISIONS[a.kind];
  const showInline = decidable && !!inline;
  return (
    <li className={cx("relative flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-start md:justify-between", pick && "xl:hover:bg-surface-2", pick && selected && "xl:bg-[var(--nav-active-bg)] xl:shadow-[inset_3px_0_0_var(--primary)] xl:hover:bg-[var(--nav-active-bg)]")} aria-current={pick && selected ? "true" : undefined}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}>{a.kindLabel}</Chip>
          {a.siteCode && <span className="text-[12px] text-muted">{a.siteCode}</span>}
          {a.acknowledgedAt && <Chip tone="neu">Someone is on it</Chip>}
        </div>
        <p className="mt-1 text-[15px] font-medium lg:text-[14px]">
          <a href={href} className="text-fg hover:text-primary-text">
            {a.displayTitle}
            {a.displayNumber && <span className="ml-1 font-mono text-[12px] text-muted">{a.displayNumber}</span>}
          </a>
        </p>
        {a.amountText && <p className="mt-0.5 text-[14px] font-semibold tabular-nums">{a.amountText}</p>}
        {a.why && <p className="mt-0.5 break-words text-[13px] text-fg-2">{a.why}</p>}
        {a.detail && <p className="mt-0.5 break-words text-[13px] text-muted">{a.detail}</p>}
        <p className="mt-1 text-[13px] text-fg-2">
          {a.requestedBy.name ? (
            <>
              Asked by <b>{a.requestedBy.name}</b>
              {a.requestedBy.at ? <> · {fmtDateTime(a.requestedBy.at)}</> : null} ·{" "}
            </>
          ) : null}
          waiting {waited(a.ageMinutes)}
        </p>
        {decidable && a.selfApprovalNote && <p className="mt-1 text-[13px] font-medium text-fg-2">{a.selfApprovalNote}</p>}
        {!decidable && a.waitingFor &&<p className="mt-1 text-[13px] font-medium text-[var(--warn-fg)]">{a.waitingFor}{a.stepLabel ? ` · step: ${a.stepLabel}` : ""}</p>}
        {decidable && !inline && <p className="mt-1 text-[13px] text-muted">Open the record to decide (it needs more details than a tap).</p>}
      </div>
      <div className={cx("flex w-full shrink-0 flex-col gap-2 md:w-72 md:items-stretch", pick && "xl:hidden")}>
        {showInline && <InlineDecision kind={a.kind} entityId={a.entityId} what={a.what} rejectLabel={inline.reject} primary={first} />}
        <LinkButton href={href} variant={first && decidable && !inline ? "primary" : "secondary"} className="w-full">
          Open
        </LinkButton>
      </div>
      {pick && (
        <Link href={pick} scroll={false} className={cx("hidden min-h-[32px] shrink-0 items-center rounded-[6px] px-2.5 text-[13px] font-medium xl:inline-flex", selected ? "text-[var(--nav-active-fg)]" : "border border-line-strong bg-surface text-fg hover:bg-surface-2")}>
          {selected ? "Shown on the right" : "Show here"}
        </Link>
      )}
    </li>
  );
}

/** Desktop detail panel: everything about the selected item, with Approve / Reject and Open (same controls as the row). */
function Detail({ a, first }: { a: ApprovalRow; first: boolean }) {
  const href = rowHref(a);
  const inline = INLINE_DECISIONS[a.kind];
  return (
    <aside aria-label="The selected item" data-testid="approval-detail" className="hidden xl:sticky xl:top-[72px] xl:block">
      <div className="rounded-[8px] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}>{a.kindLabel}</Chip>
          {a.siteCode && <span className="text-[12px] text-muted">{a.siteCode}</span>}
        </div>
        <h2 className="mt-2 text-[17px] font-semibold leading-snug">
          {a.displayTitle}
          {a.displayNumber && <span className="ml-1 font-mono text-[12px] font-normal text-muted">{a.displayNumber}</span>}
        </h2>
        {a.amountText && <p className="mt-1 text-[18px] font-semibold tabular-nums">{a.amountText}</p>}
        <dl className="mt-3 flex flex-col gap-2 text-[14px]">
          {a.why && (
            <div>
              <dt className="text-[12px] font-medium text-muted">Why it waits</dt>
              <dd className="break-words text-fg-2">{a.why}</dd>
            </div>
          )}
          {a.detail && (
            <div>
              <dt className="text-[12px] font-medium text-muted">Details</dt>
              <dd className="break-words text-fg-2">{a.detail}</dd>
            </div>
          )}
          <div>
            <dt className="text-[12px] font-medium text-muted">Asked</dt>
            <dd className="text-fg-2">
              {a.requestedBy.name ? <>by <b>{a.requestedBy.name}</b>{a.requestedBy.at ? <> · {fmtDateTime(a.requestedBy.at)}</> : null} · </> : null}
              waiting {waited(a.ageMinutes)}
            </dd>
          </div>
        </dl>
        {a.selfApprovalNote && <p className="mt-2 text-[13px] font-medium text-fg-2">{a.selfApprovalNote}</p>}
        <div className="mt-4 flex flex-col gap-2">
          {inline ? <InlineDecision kind={a.kind} entityId={a.entityId} what={a.what} rejectLabel={inline.reject} primary={first} /> : <p className="text-[13px] text-muted">Open the record to decide (it needs more details than a tap).</p>}
          <LinkButton href={href} variant={first && !inline ? "primary" : "secondary"} className="w-full">
            Open
          </LinkButton>
        </div>
      </div>
    </aside>
  );
}

/**
 * "To approve" (ADR-075, ADR-082 §4): what waits for the signed-in user's decision now, oldest first,
 * with what, who asked, how long it has waited, a direct link and, where the module allows it, Approve /
 * Reject right here. Items the user may see but someone else must decide now (another approval step,
 * their own request) are in a collapsed "Waiting for others" section without decision buttons. The
 * header badge counts exactly the first list (myApprovalCount). Data: src/modules/action-centre/approvals.ts.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const refreshed = await refreshActionItems(ctx.organizationId).catch(() => null);
  const { decidable, waiting } = await myApprovalInbox(ctx);
  // Live check 2026-11-06 (desktop ≥ 1280 px): the list and the selected item side by side (default: the oldest).
  const selected = decidable.find((a) => a.id === sp.item) ?? decidable[0] ?? null;
  return (
    <div className="space-y-4">
      <PageHeader
        title="To approve"
        subtitle={decidable.length ? `${decidable.length} waiting for your decision · oldest first` : "Nothing waits for you"}
        actions={
          <MoreMenu>
            <LinkButton href="/action-centre" variant="secondary" size="sm">Problems & alerts</LinkButton>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for the owner, managers and QA: things that wait for your yes or no, oldest first. Press Approve to decide here, or Open to read everything first.</PageIntro>
      {!refreshed && <Banner tone="warn" title="This list may be a few minutes old">It could not be updated just now. Open the page again in a minute.</Banner>}
      <div className={cx(selected && "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] xl:items-start xl:gap-5")}>
        <Panel
          title="Waiting for your decision"
          count={decidable.length}
          flush
          testId="approval-list"
          // ADR-136: the owner's note is a quiet line in the list's header, not a banner (nothing to do about it).
          action={ctx.ownerOverride ? <span className="hidden text-[12.5px] text-fg-2 md:inline" title="Each decision is kept in the history of changes.">As the owner you may decide any step</span> : undefined}
        >
          {decidable.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Nothing waits for your decision">
                {waiting.length
                  ? "Everything open is waiting for someone else; see below."
                  : "Purchase requests and orders, sales orders, quotations, price lists, expense claims, invoices, stock adjustments and counts, production orders, QA decisions and setting changes that you may approve appear here, oldest first."}
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {decidable.map((a, n) => (
                <Row key={a.id} a={a} decidable first={n === 0} pick={`/approvals?item=${encodeURIComponent(a.id)}`} selected={a.id === selected?.id} />
              ))}
            </ul>
          )}
        </Panel>
        {selected && <Detail a={selected} first={selected.id === decidable[0]?.id} />}
      </div>
      {waiting.length > 0 && (
        <details className="rounded-[8px] border border-line bg-surface">
          <summary className="flex min-h-[48px] cursor-pointer items-center justify-between gap-2 px-4 text-[14px] font-semibold">
            <span>Waiting for others ({waiting.length})</span>
            <span className="text-[13px] font-normal text-muted">Show</span>
          </summary>
          <div className="border-t border-line">
            <p className="px-4 pt-3 text-[13px] text-muted">You can see these, but another person must decide them now. Open one to follow its progress.</p>
            <ul className="divide-y divide-line">
              {waiting.map((a) => (
                <Row key={a.id} a={a} decidable={false} />
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
