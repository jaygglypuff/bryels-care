import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { getPeriodChecklist, listPeriods } from "@/modules/finance";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { FinanceStatus } from "../finance-ui";
import { PeriodCommand } from "./forms";

export const metadata = { title: "Close the month" };

const monthName = (code: string) => {
  const [y, m] = code.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * US-6-13 as "Close the month": calendar-month periods. Finance closes (locks) a month after the accountant's
 * month-end; nothing can be saved to the books or cancelled into a closed month. Opening it again needs two
 * people: finance asks, the owner approves. Password re-entry and the open-papers check are unchanged.
 */
export default async function PeriodsPage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.period_lock.view")) return <Forbidden what="closing the month" />;
  const periods = await listPeriods(ctx);
  const canLock = ctx.can("finance.period_lock.post");
  const canUnlock = ctx.can("finance.period_lock.void");
  const checklists = new Map<string, number>();
  if (canLock) for (const p of periods.filter((x) => x.status === "open").slice(0, 4)) checklists.set(p.periodCode, (await getPeriodChecklist(ctx, p.periodCode)).length);
  const pending = periods.filter((p) => p.pendingUnlock);
  const toDecide = canUnlock ? pending.filter((p) => p.pendingUnlock!.requestedBy !== ctx.userId) : [];
  const toClose = canLock ? periods.find((p) => p.status === "open" && !p.isCurrent) : undefined;
  const keep = (p: (typeof periods)[number], i: number) => i < 4 || p.status === "locked" || !!p.pendingUnlock || p.periodCode === toClose?.periodCode;
  const recent = periods.filter(keep);
  const older = periods.filter((p, i) => !keep(p, i));
  const card = (p: (typeof periods)[number]) => (
            <Card key={p.periodCode} id={`m-${p.periodCode}`} className="flex scroll-mt-24 flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[17px] font-semibold">{monthName(p.periodCode)}</h2>
                <span className="inline-flex flex-wrap gap-1">
                  {p.isCurrent && <FinanceStatus status="issued" label="This month" />}
                  <FinanceStatus status={p.status} />
                </span>
              </div>
              {p.status === "locked" && (
                <p className="text-[14px] text-fg-2">
                  Closed by {p.lockedByName ?? "—"} · {fmtDateTime(p.lockedAt)}
                  {p.lockReason ? ` · ${p.lockReason}` : ""}
                </p>
              )}
              {p.status === "open" && checklists.has(p.periodCode) && <p className="text-[14px] text-fg-2">{checklists.get(p.periodCode) ? `${checklists.get(p.periodCode)} paper(s) dated this month are not finished.` : "All papers dated this month are finished."}</p>}
              {p.pendingUnlock && (
                <p className="text-[14px]">
                  {p.pendingUnlock.requestedByName} asks to open it again ({fmtDateTime(p.pendingUnlock.requestedAt)}): {p.pendingUnlock.reason}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {p.status === "open" && canLock && <PeriodCommand command="lock" periodCode={p.periodCode} label="Close this month" openItems={checklists.get(p.periodCode) ?? 0} variant={toClose?.periodCode === p.periodCode ? "cta" : "secondary"} />}
                {p.status === "locked" && !p.pendingUnlock && canLock && <PeriodCommand command="request_unlock" periodCode={p.periodCode} label="Ask to open it again" />}
                {p.pendingUnlock && canUnlock && p.pendingUnlock.requestedBy !== ctx.userId && (
                  <>
                    <PeriodCommand command="approve_unlock" periodCode={p.periodCode} requestId={p.pendingUnlock.id} label="Yes, open it again" variant="cta" />
                    <PeriodCommand command="reject_unlock" periodCode={p.periodCode} requestId={p.pendingUnlock.id} label="No, keep it closed" variant="danger" />
                  </>
                )}
                {p.pendingUnlock && p.pendingUnlock.requestedBy === ctx.userId && <PeriodCommand command="cancel_unlock" periodCode={p.periodCode} requestId={p.pendingUnlock.id} label="Take back my request" />}
              </div>
            </Card>
  );
  return (
    <>
      <PageHeader title="Close the month" />
      <PageIntro>This screen is for closing a finished month after the accountant is done, so nobody can add or change money papers dated in it. Reading and downloading still work.</PageIntro>
      {toDecide.length > 0 ? (
        <NextStep text={`Next: ${toDecide[0].pendingUnlock!.requestedByName} asks to open ${monthName(toDecide[0].periodCode)} again.`} action={{ label: "Decide", href: `#m-${toDecide[0].periodCode}` }} />
      ) : toClose ? (
        <NextStep text={`Next: close ${monthName(toClose.periodCode)} when the accountant is done.`} action={{ label: "Close it", href: `#m-${toClose.periodCode}` }} />
      ) : pending.length > 0 ? (
        <NextStep text={`${pending.length} request(s) to open a month again.`} waitingFor="Waiting for the owner to approve." />
      ) : null}
      {pending.length > 0 && !canUnlock && (
        <div className="mb-4">
          <Banner tone="warn" title={`${pending.length} request(s) to open a month again`}>The owner approves them.</Banner>
        </div>
      )}
      {periods.length === 0 ? (
        <EmptyState title="No months yet">Months appear once money papers are saved to the books. Questions? Ask finance.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{recent.map(card)}</div>
          {older.length > 0 && (
            <div className="mt-4">
              <MoreDetails title={`Older months (${older.length})`}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{older.map(card)}</div>
              </MoreDetails>
            </div>
          )}
        </>
      )}
    </>
  );
}
