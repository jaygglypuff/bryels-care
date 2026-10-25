import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { getPeriodChecklist, listPeriods } from "@/modules/finance";
import { Card, CardTitle, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { FinanceStatus } from "../finance-ui";
import { PeriodCommand } from "./forms";

export const metadata = { title: "Accounting periods" };

/**
 * US-6-13: calendar-month periods. Finance locks a period after the accountant's month-end; nothing can be
 * posted or reversed into a locked period. Unlocking needs two approvals: finance requests, the owner approves.
 */
export default async function PeriodsPage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.period_lock.view")) return <Forbidden what="accounting periods" />;
  const periods = await listPeriods(ctx);
  const canLock = ctx.can("finance.period_lock.post");
  const canUnlock = ctx.can("finance.period_lock.void");
  const checklists = new Map<string, number>();
  if (canLock) for (const p of periods.filter((x) => x.status === "open").slice(0, 4)) checklists.set(p.periodCode, (await getPeriodChecklist(ctx, p.periodCode)).length);
  const pending = periods.filter((p) => p.pendingUnlock);
  return (
    <>
      <PageHeader title="Accounting periods" subtitle="Lock a month after the accountant's close. Postings and reversals dated in a locked month are refused; reads and exports still work." />
      {pending.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title={`${pending.length} unlock request(s) waiting`}>{canUnlock ? "Review them below: the period opens when you approve." : "The owner approves unlock requests."}</Banner>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {periods.map((p) => (
          <Card key={p.periodCode} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{p.periodCode}</CardTitle>
              <span className="inline-flex gap-1">
                {p.isCurrent && <FinanceStatus status="issued" label="Current" />}
                <FinanceStatus status={p.status} />
              </span>
            </div>
            {p.status === "locked" && (
              <p className="text-[13px] text-muted">
                Locked by {p.lockedByName ?? "—"} · {fmtDateTime(p.lockedAt)}
                {p.lockReason ? ` · ${p.lockReason}` : ""}
              </p>
            )}
            {p.status === "open" && checklists.has(p.periodCode) && <p className="text-[13px] text-muted">{checklists.get(p.periodCode) ? `${checklists.get(p.periodCode)} document(s) dated here are still open.` : "Nothing open dated in this month."}</p>}
            {p.pendingUnlock && (
              <p className="text-[13px]">
                Unlock requested by {p.pendingUnlock.requestedByName} · {fmtDateTime(p.pendingUnlock.requestedAt)}: {p.pendingUnlock.reason}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {p.status === "open" && canLock && <PeriodCommand command="lock" periodCode={p.periodCode} label="Lock period" openItems={checklists.get(p.periodCode) ?? 0} />}
              {p.status === "locked" && !p.pendingUnlock && canLock && <PeriodCommand command="request_unlock" periodCode={p.periodCode} label="Request unlock" />}
              {p.pendingUnlock && canUnlock && p.pendingUnlock.requestedBy !== ctx.userId && (
                <>
                  <PeriodCommand command="approve_unlock" periodCode={p.periodCode} requestId={p.pendingUnlock.id} label="Approve unlock" variant="cta" />
                  <PeriodCommand command="reject_unlock" periodCode={p.periodCode} requestId={p.pendingUnlock.id} label="Reject" variant="danger" />
                </>
              )}
              {p.pendingUnlock && p.pendingUnlock.requestedBy === ctx.userId && <PeriodCommand command="cancel_unlock" periodCode={p.periodCode} requestId={p.pendingUnlock.id} label="Withdraw request" />}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
