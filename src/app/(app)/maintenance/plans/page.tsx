import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listMaintenancePlans } from "@/modules/maintenance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { DueChip } from "../_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["live", "In use and paused"],
  ["active", "In use"],
  ["retired", "No longer used"],
  ["all", "All"],
] as const;

/** PM plans (US-6-19): time- or usage-based, most urgent first. */
export default async function PlansPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.plan.view")) return <Forbidden what="regular maintenance" />;
  const { status = "live" } = await searchParams;
  const rows = await listMaintenancePlans(ctx, { status });
  return (
    <>
      <PageHeader title="Regular maintenance" actions={ctx.can("maintenance.plan.create") ? <LinkButton href="/maintenance/plans/new" variant="cta">Plan new regular maintenance</LinkButton> : undefined} />
      <PageIntro>This screen is for the technician: maintenance that is done every few days or after so many batches, so machines do not break. Late maintenance can block a machine.</PageIntro>
      <Card>
        <FilterTabs label="Filter" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/maintenance/plans?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="No regular maintenance here" action={ctx.can("maintenance.plan.create") ? <LinkButton href="/maintenance/plans/new" variant="secondary">Plan new regular maintenance</LinkButton> : undefined}>
            Plan it for each machine that needs it. How often comes from the machine&apos;s manual or the maintenance lead.
          </EmptyState>
        ) : (
          <PlainList label="Regular maintenance">
            {rows.map((p) => (
              <PlainRow
                key={p.id}
                href={`/maintenance/plans/${p.id}`}
                title={`${p.equipmentName}: ${p.title}`}
                code={p.planNumber}
                tone={p.status === "active" && p.dueState === "overdue" ? "bad" : undefined}
                status={p.status === "active" ? <DueChip state={p.dueState} /> : <Chip tone="neu">{p.status === "paused" ? "Paused" : "No longer used"}</Chip>}
                facts={
                  <>
                    {p.triggerKind === "time" ? `every ${p.intervalDays} days · next ${fmtDate(p.nextDueOn)}` : `every ${Number(p.usageInterval)} ${p.usageUnit} · ${p.usage ?? 0} used`} · {p.siteCode}
                    {p.liveWorkOrder ? ` · job ${p.liveWorkOrder.number}` : ""}
                  </>
                }
              />
            ))}
          </PlainList>
        )}
      </Card>
    </>
  );
}
