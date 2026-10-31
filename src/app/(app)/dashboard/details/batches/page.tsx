import Link from "next/link";
import { PageIntro } from "@/ui/guide";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate } from "@/lib/qty";
import { listWeekBatches } from "@/modules/analytics";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Batches this week" };

/**
 * The list behind Home's "Production progress" card: the batches planned to start this week; done =
 * QA released. Same function (`listWeekBatches`) as the card (one source per label).
 */
export default async function WeekBatchesPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("analytics.dashboard.view") || !ctx.can("production.batch.view")) return <Forbidden what="production progress" />;
  const { scope } = await searchParams;
  const all = scope === "all" && ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view");
  let w;
  try {
    w = await listWeekBatches(ctx, { all });
  } catch (e) {
    if (e instanceof DomainError && e.code === "forbidden") return <Forbidden what="production progress" />;
    throw e;
  }
  const done = w.rows.filter((r) => r.done).length;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Batches this week"
        subtitle={`${w.scope.label} · ${fmtDate(w.weekStart)} to ${fmtDate(w.weekEnd)} · ${done} of ${w.rows.length} done`}
        actions={<LinkButton href={all ? "/dashboard?scope=all" : "/dashboard"} variant="secondary">Back to Home</LinkButton>}
      />
      <PageIntro>This screen is for the owner and the site manager: the batches planned to start this week. “Done” means QA checked the batch and said OK. Tap a batch to open it.</PageIntro>
      <Card>
        {w.rows.length === 0 ? (
          <EmptyState title="No batches planned this week">Batches planned to start between Monday and Sunday appear here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {w.rows.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-[14px]">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{b.productName}</span>
                  <span className="block text-[12px] text-muted">
                    <Link href={b.href} className="font-mono text-primary-text hover:underline">
                      {b.batchNumber}
                    </Link>
                    {b.plannedStartOn ? ` · planned ${fmtDate(b.plannedStartOn)}` : ""}
                    {w.scope.all ? ` · ${b.siteCode}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {b.done && <span className="text-[12px] font-medium text-[var(--ok-fg)]">Done</span>}
                  <StatusChip status={b.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
