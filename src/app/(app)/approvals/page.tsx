import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { isInternalPath, recordHref } from "@/lib/record-links";
import { type ApprovalRow, listMyApprovals, refreshActionItems } from "@/modules/action-centre";
import { registerAppHooks } from "@/modules/wiring";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { InlineDecision } from "./forms";
import { INLINE_DECISIONS } from "./inline";

registerAppHooks(); // cross-module action-item sources (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "To approve" };
export const dynamic = "force-dynamic";

function ago(minutes: number) {
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

function Row({ a, canOverride }: { a: ApprovalRow; canOverride: boolean }) {
  const href = isInternalPath(a.link) ? a.link : (recordHref(a.entityType, a.entityId) ?? "/action-centre");
  const inline = INLINE_DECISIONS[a.kind];
  const what = `${a.kindLabel.replace(/ to (approve|decide|release|review)$/i, "").toLowerCase()} ${a.recordNumber ?? ""}`.trim();
  const blockedOwn = a.ownRequest && !canOverride;
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
            {a.recordNumber && <span className="mr-1 font-mono">{a.recordNumber}</span>}
            {a.title}
          </a>
        </p>
        {a.detail && <p className="mt-0.5 break-words text-[13px] text-muted">{a.detail}</p>}
        <p className="mt-1 text-[13px] text-fg-2">
          Asked by <b>{a.requestedBy.name ?? "someone"}</b>
          {a.requestedBy.at ? <> · {fmtDateTime(a.requestedBy.at)}</> : null} · waiting {ago(a.ageMinutes)}
        </p>
        {blockedOwn && <p className="mt-1 text-[13px] text-[var(--warn-fg)]">You asked for this, so another person must decide.</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-2 md:items-end">
        <LinkButton href={href} size="sm" variant="secondary">Open</LinkButton>
        {inline && !blockedOwn && <InlineDecision kind={a.kind} entityId={a.entityId} what={what} rejectLabel={inline.reject} />}
      </div>
    </li>
  );
}

/**
 * "To approve" (ADR-075): one list of everything waiting for the signed-in user's decision across
 * modules: what, who asked, when, a direct link and, where the module allows it, Approve / Reject
 * right here. Data: the action centre's approval items (permission at the item's site; the owner
 * override of ADR-073 shows the owner everything).
 */
export default async function ApprovalsPage() {
  const ctx = await requireContext();
  const refreshed = await refreshActionItems(ctx.organizationId).catch(() => null);
  const rows = await listMyApprovals(ctx);
  const canOverride = ctx.ownerOverride;
  return (
    <div className="space-y-5">
      <PageHeader
        title="To approve"
        subtitle="Everything waiting for your decision, oldest first. Tap a row to see the full record, or approve it here."
        actions={<LinkButton href="/action-centre" variant="secondary" size="sm">Action centre</LinkButton>}
      />
      {!refreshed && <Banner tone="warn" title="Showing the last refreshed list">The list could not be refreshed just now; it may be up to 5 minutes old.</Banner>}
      {canOverride && <Banner tone="info" title="Owner override is on">You see every approval in the company and may decide your own requests. Each such decision is recorded in the audit log.</Banner>}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing waits for your approval">Purchase requests and orders, sales orders, quotations, price lists, stock adjustments and counts, production orders, QA decisions and setting changes that you may approve appear here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <Row key={a.id} a={a} canOverride={canOverride} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
