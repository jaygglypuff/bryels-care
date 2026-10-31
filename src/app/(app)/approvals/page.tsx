import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { isInternalPath, recordHref } from "@/lib/record-links";
import { type ApprovalRow, myApprovalInbox, refreshActionItems } from "@/modules/action-centre";
import { registerAppHooks } from "@/modules/wiring";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
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

function Row({ a, decidable }: { a: ApprovalRow; decidable: boolean }) {
  const href = isInternalPath(a.link) ? a.link : (recordHref(a.entityType, a.entityId) ?? "/action-centre");
  const inline = INLINE_DECISIONS[a.kind];
  const showInline = decidable && !!inline;
  return (
    <li className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}>{a.kindLabel}</Chip>
          {a.siteCode && <span className="text-[12px] text-muted">{a.siteCode}</span>}
          {a.acknowledgedAt && <Chip tone="neu">Someone is on it</Chip>}
        </div>
        <p className="mt-1 text-[15px] font-medium">
          <a href={href} className="text-primary-text hover:underline">
            {a.displayNumber && <span className="mr-1 font-mono">{a.displayNumber}</span>}
            {a.displayTitle}
          </a>
        </p>
        {a.amountText && <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{a.amountText}</p>}
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
      <div className="flex w-full shrink-0 flex-col gap-2 md:w-72 md:items-stretch">
        {showInline && <InlineDecision kind={a.kind} entityId={a.entityId} what={a.what} rejectLabel={inline.reject} />}
        <LinkButton href={href} variant={decidable && !inline ? "primary" : "secondary"} className="w-full">
          Open
        </LinkButton>
      </div>
    </li>
  );
}

/**
 * "To approve" (ADR-075, ADR-082 §4): what waits for the signed-in user's decision now, oldest first,
 * with what, who asked, how long it has waited, a direct link and, where the module allows it, Approve /
 * Reject right here. Items the user may see but someone else must decide now (another approval step,
 * their own request) are in a collapsed "Waiting for others" section without decision buttons. The
 * header badge counts exactly the first list (myApprovalCount). Data: src/modules/action-centre/approvals.ts.
 */
export default async function ApprovalsPage() {
  const ctx = await requireContext();
  const refreshed = await refreshActionItems(ctx.organizationId).catch(() => null);
  const { decidable, waiting } = await myApprovalInbox(ctx);
  return (
    <div className="space-y-5">
      <PageHeader
        title="To approve"
        subtitle="What waits for your decision, oldest first. Tap Approve to decide here, or Open to see the full record."
        actions={<LinkButton href="/action-centre" variant="secondary" size="sm">Action centre</LinkButton>}
      />
      {!refreshed && <Banner tone="warn" title="Showing the last refreshed list">The list could not be refreshed just now; it may be up to 5 minutes old.</Banner>}
      {ctx.ownerOverride && <Banner tone="info" title="Owner override is on">You may decide any step and your own requests. Each such decision is recorded in the audit log.</Banner>}
      <Card>
        {decidable.length === 0 ? (
          <EmptyState title="Nothing waits for your decision">
            {waiting.length
              ? "Everything open is waiting for someone else; see below."
              : "Purchase requests and orders, sales orders, quotations, price lists, expense claims, invoices, stock adjustments and counts, production orders, QA decisions and setting changes that you may approve appear here."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {decidable.map((a) => (
              <Row key={a.id} a={a} decidable />
            ))}
          </ul>
        )}
      </Card>
      {waiting.length > 0 && (
        <details className="rounded-[14px] border border-line bg-surface">
          <summary className="flex min-h-[48px] cursor-pointer items-center justify-between gap-2 px-4 text-[15px] font-medium">
            <span>Waiting for others ({waiting.length})</span>
            <span className="text-[13px] font-normal text-muted">Show</span>
          </summary>
          <div className="border-t border-line px-4">
            <p className="pt-3 text-[13px] text-muted">You can see these, but another person must decide them now. Open one to follow its progress.</p>
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
