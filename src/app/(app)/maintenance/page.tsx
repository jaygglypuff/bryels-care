import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listMaintenancePlans, listMaintenanceWorkOrders, listSpareParts } from "@/modules/maintenance";
import { Card, CardTitle, EmptyState, Kpi, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../forbidden";
import { DueChip, EQUIPMENT_WORD, PriorityChip, WoStatusChip } from "./_ui";

export const dynamic = "force-dynamic";

/** Maintenance overview (US-6-19): PM plans due or overdue, live work orders, spare parts below minimum. */
export default async function MaintenancePage() {
  const ctx = await requireContext();
  const canPlans = ctx.can("maintenance.plan.view");
  const canWos = ctx.can("maintenance.work_order.view");
  if (!canPlans && !canWos) return <Forbidden what="maintenance" />;
  const due = canPlans ? await listMaintenancePlans(ctx, { due: true }) : [];
  const wos = canWos ? await listMaintenanceWorkOrders(ctx, { status: "live" }) : [];
  const parts = ctx.can("maintenance.spare_part.view") ? (await listSpareParts(ctx)).filter((p) => p.belowMin) : [];
  const overdue = due.filter((p) => p.dueState === "overdue").length;
  return (
    <>
      <PageHeader
        title="Maintenance"
        actions={
          <>
            {ctx.can("maintenance.work_order.create") && (
              <LinkButton href="/maintenance/work-orders/new" variant="cta">
                Report a broken machine
              </LinkButton>
            )}
            <MoreMenu>
              <div className="flex flex-col gap-2">
                {canWos && (
                  <LinkButton href="/maintenance/work-orders" variant="secondary">
                    All repair jobs
                  </LinkButton>
                )}
                {canPlans && (
                  <LinkButton href="/maintenance/plans" variant="secondary">
                    All regular maintenance
                  </LinkButton>
                )}
                {ctx.can("maintenance.plan.create") && (
                  <LinkButton href="/maintenance/plans/new" variant="secondary">
                    Plan new regular maintenance
                  </LinkButton>
                )}
                {ctx.can("maintenance.spare_part.view") && (
                  <LinkButton href="/maintenance/spare-parts" variant="secondary">
                    Spare parts
                  </LinkButton>
                )}
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for the technician and the supervisor: what maintenance is late or due, and which machines are being repaired.</PageIntro>
      {due[0] ? (
        <NextStep text={`Next: regular maintenance of ${due[0].equipmentName}${due[0].dueState === "overdue" ? " (late)" : ""}: ${due[0].title}.`} action={{ label: due[0].liveWorkOrder ? "Open the job" : "Open", href: due[0].liveWorkOrder ? `/maintenance/work-orders/${due[0].liveWorkOrder.id}` : `/maintenance/plans/${due[0].id}` }} />
      ) : wos[0] ? (
        <NextStep text={`Next: ${wos[0].title} (${wos[0].equipmentName}).`} action={{ label: "Open the job", href: `/maintenance/work-orders/${wos[0].id}` }} />
      ) : (
        <NextStep text="Nothing is late and no machine is being repaired." />
      )}

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {canPlans && <Kpi label="Maintenance late" value={overdue} tone={overdue ? "bad" : "good"} hint={overdue ? "The machine may be blocked" : "Nothing late"} href="/maintenance/plans" />}
          {canPlans && <Kpi label="Maintenance due soon" value={due.length - overdue} tone={due.length - overdue ? "warn" : "neutral"} href="/maintenance/plans" />}
          {canWos && <Kpi label="Repair jobs open" value={wos.length} href="/maintenance/work-orders" />}
          {canWos && <Kpi label="Machines not working" value={new Set(wos.filter((w) => w.equipmentStatus !== "in_service").map((w) => w.equipmentId)).size} tone="neutral" href="/maintenance/work-orders" />}
        </div>

        {canPlans && (
          <Card>
            <CardTitle action={<Link className="inline-flex min-h-[44px] items-center text-[13px] text-primary-text hover:underline" href="/maintenance/plans">See all</Link>}>Regular maintenance due</CardTitle>
            {due.length === 0 ? (
              <EmptyState title="Nothing due">All regular maintenance is up to date.</EmptyState>
            ) : (
              <PlainList label="Regular maintenance due">
                {due.map((p) => (
                  <PlainRow
                    key={p.id}
                    href={`/maintenance/plans/${p.id}`}
                    title={`${p.equipmentName}: ${p.title}`}
                    code={p.planNumber}
                    tone={p.dueState === "overdue" ? "bad" : undefined}
                    status={<DueChip state={p.dueState} />}
                    facts={
                      <>
                        {p.triggerKind === "time" ? `due ${fmtDate(p.nextDueOn)}` : `${p.usage ?? 0} of ${Number(p.usageInterval)} ${p.usageUnit} used`} · {p.liveWorkOrder ? `job ${p.liveWorkOrder.number}` : "no job yet"}
                      </>
                    }
                  />
                ))}
              </PlainList>
            )}
          </Card>
        )}

        {canWos && (
          <Card>
            <CardTitle action={<Link className="inline-flex min-h-[44px] items-center text-[13px] text-primary-text hover:underline" href="/maintenance/work-orders">See all</Link>}>Repair jobs open</CardTitle>
            {wos.length === 0 ? (
              <EmptyState title="No repair job is open">When a machine breaks, press “Report a broken machine”. Regular maintenance jobs are made from the maintenance that is due.</EmptyState>
            ) : (
              <PlainList label="Repair jobs open">
                {wos.map((w) => (
                  <PlainRow
                    key={w.id}
                    href={`/maintenance/work-orders/${w.id}`}
                    title={`${w.equipmentName}: ${w.title}`}
                    code={w.workOrderNumber}
                    tone={w.overdue ? "bad" : undefined}
                    status={
                      <>
                        <WoStatusChip status={w.status} />
                        <PriorityChip priority={w.priority} />
                        {w.equipmentStatus !== "in_service" && <Chip tone="bad">{EQUIPMENT_WORD[w.equipmentStatus] ?? w.equipmentStatus.replace(/_/g, " ")}</Chip>}
                        {w.overdue && <Chip tone="bad">Late</Chip>}
                      </>
                    }
                    facts={
                      <>
                        {w.assigneeName ?? "Nobody yet"}
                        {w.dueDate ? ` · by ${fmtDate(w.dueDate)}` : ""}
                      </>
                    }
                  />
                ))}
              </PlainList>
            )}
          </Card>
        )}

        {parts.length > 0 && (
          <Card>
            <CardTitle action={<Link className="inline-flex min-h-[44px] items-center text-[13px] text-primary-text hover:underline" href="/maintenance/spare-parts">Spare parts</Link>}>Spare parts running low</CardTitle>
            <ul className="flex flex-col gap-1 text-[14px]">
              {parts.map((p) => (
                <li key={p.id}>
                  {p.materialName} <span className="font-mono text-[12px] text-muted">{p.materialCode}</span>: {Number(p.onHand)} {p.baseUom} left, keep at least {Number(p.minQtyBase)}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
