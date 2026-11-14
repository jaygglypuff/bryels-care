import Link from "next/link";
import type { ReactNode } from "react";
import { ClipboardList, FlaskConical, GitBranch, PackagePlus, ScanLine, ShoppingCart } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { ACTIVE_BATCH_LIMIT, getOperationsCenter, listRecentActivity } from "@/modules/analytics";
import { RecentActivity } from "../dashboard/simple-home";
import { Card, EmptyState, PageHeader, Table, Td, cx } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PipelineStrip } from "@/ui/pipeline";
import { StatusChip } from "@/ui/status";
import { QUICK_ACTIONS } from "../nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations Center" };

const ICONS: Record<string, ReactNode> = {
  scan: <ScanLine size={20} />, receive: <PackagePlus size={20} />, batch: <FlaskConical size={20} />, qa: <ClipboardList size={20} />, order: <ShoppingCart size={20} />, trace: <GitBranch size={20} />,
};

function Progress({ done, total }: { done: number; total: number }) {
  if (total === 0) return <span className="text-muted">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-[6px] bg-[var(--lime-100)]" role="img" aria-label={`${done} of ${total} steps done`}>
        <i className="block h-full rounded-[6px] bg-[var(--brand-600)]" style={{ width: `${((done / total) * 100).toFixed(0)}%` }} />
      </span>
      <span className="tabular text-[12px] text-fg-2">{done}/{total}</span>
    </span>
  );
}

/**
 * Operations Center (ADR-081; brief Part II §9, Part IV §3): the whole pipeline at one site (or all of
 * the user's sites), then the batches being made, furthest along first. Counts are live queries.
 */
export default async function OperationsCenterPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const oc = await getOperationsCenter(ctx, { all: sp.scope === "all" });
  const quick = QUICK_ACTIONS.filter((q) => !q.permission || ctx.can(q.permission));
  const multi = ctx.allowedSites.length > 1;
  // Mockup panel "Operations Center": recent activity under the batches (people who may read the history only).
  const activity = ctx.can("platform.audit.view") ? await listRecentActivity(ctx, oc.scope, 6).catch(() => null) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations Center"
        subtitle={oc.scope.label}
        actions={
          multi ? (
            <div className="flex rounded-[6px] border border-line bg-surface p-1 text-[13px]" role="group" aria-label="Sites shown">
              <Link href="/operations" aria-current={!oc.scope.all ? "page" : undefined} className={cx("inline-flex min-h-[44px] items-center rounded-[6px] px-3.5", !oc.scope.all ? "bg-cta text-white" : "text-fg-2")}>
                This site
              </Link>
              <Link href="/operations?scope=all" aria-current={oc.scope.all ? "page" : undefined} className={cx("inline-flex min-h-[44px] items-center rounded-[6px] px-3.5", oc.scope.all ? "bg-cta text-white" : "text-fg-2")}>
                All my sites
              </Link>
            </div>
          ) : undefined
        }
      />

      <PageIntro>This screen is for everyone who runs the plant: every step from a supplier delivery to sending the customer order, with how many things are at each step right now. Tap a step to see them; red means late or stopped.</PageIntro>
      {oc.stages.length === 0 ? (
        <EmptyState title="Nothing to show for your role">Your role does not give access to receiving, stock, production or customer orders at this site. Ask your site manager if you need it.</EmptyState>
      ) : (
        <section aria-labelledby="pipeline-h" className="space-y-3">
          <h2 id="pipeline-h" className="font-display text-[18px] font-semibold">From delivery to dispatch</h2>
          <PipelineStrip stages={oc.stages} />
        </section>
      )}

      {(ctx.can("production.batch.view") || ctx.can("production.work_order.view")) && (
        <section aria-labelledby="batches-h" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="batches-h" className="font-display text-[18px] font-semibold">Batches being made</h2>
            <Link href="/production/orders" className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline">All production orders</Link>
          </div>
          {oc.batches.length === 0 ? (
            <EmptyState title="No batches in progress">Batches appear here when a production order is approved, and leave when QA releases or rejects them.</EmptyState>
          ) : (
            <>
              {/* Phones: one card per batch */}
              <ul className="space-y-2 md:hidden">
                {oc.batches.map((b) => (
                  <li key={b.id}>
                    <Link href={b.href} className="block rounded-[8px] border border-line bg-surface p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 font-medium text-fg">{b.productName}</p>
                        <StatusChip status={b.status} />
                      </div>
                      <p className="text-[13px] text-fg-2">
                        {b.currentStep ? `Now: ${b.currentStep}` : b.stepsTotal ? "All steps done" : ""}
                        {b.dueOn ? ` · due ${fmtDate(b.dueOn)}` : ""}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
                        <Progress done={b.stepsDone} total={b.stepsTotal} />
                        <span className={cx(b.late && "font-medium text-[var(--warn-fg)]")}>{b.plannedStartOn ? `${b.late ? "Late · " : ""}Start ${fmtDate(b.plannedStartOn)}` : ""}</span>
                      </div>
                      <span className="font-mono text-[12px] text-muted">{b.batchNumber}{oc.scope.all && ` · ${b.siteCode}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* UX audit C #6: product first, the batch number small and grey after it; current step and due date as in the mockup. */}
              <Table className="hidden md:block" head={["Product", ...(oc.scope.all ? ["Site"] : []), "Step now", "Steps", "Status", "Due", "Planned start"]}>
                {oc.batches.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <Td>
                      <Link href={b.href} className="font-medium text-primary-text hover:underline">{b.productName}</Link>
                      <span className="block font-mono text-[12px] text-muted">{b.batchNumber}{b.orderNumber ? ` · ${b.orderNumber}` : ""}</span>
                    </Td>
                    {oc.scope.all && <Td>{b.siteCode}</Td>}
                    <Td>{b.currentStep ?? (b.stepsTotal ? "All done" : "—")}</Td>
                    <Td><Progress done={b.stepsDone} total={b.stepsTotal} /></Td>
                    <Td><StatusChip status={b.status} /></Td>
                    <Td>{b.dueOn ? fmtDate(b.dueOn) : "—"}</Td>
                    <Td className={cx(b.late && "font-medium text-[var(--warn-fg)]")}>{b.plannedStartOn ? `${fmtDate(b.plannedStartOn)}${b.late ? " · late" : ""}` : "—"}</Td>
                  </tr>
                ))}
              </Table>
              {oc.batches.length >= ACTIVE_BATCH_LIMIT && <p className="text-[13px] text-muted">Showing the first {ACTIVE_BATCH_LIMIT}. Open “All production orders” for the rest.</p>}
            </>
          )}
        </section>
      )}

      {activity && <RecentActivity rows={activity} showSite={oc.scope.all} />}

      {quick.length > 0 && (
        <Card aria-labelledby="quick-h">
          <h2 id="quick-h" className="mb-3 font-display text-[16px] font-semibold">Start something</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {quick.map((q) => (
              <li key={q.href}>
                <Link href={q.href} className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-[8px] border border-line bg-surface p-3 text-center text-[13px] font-medium text-fg-2 hover:border-line-strong hover:text-fg">
                  <span className="grid size-10 place-items-center rounded-[6px] bg-primary-soft text-primary-text">{ICONS[q.icon]}</span>
                  {q.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
