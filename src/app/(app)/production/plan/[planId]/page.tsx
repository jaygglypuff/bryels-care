import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtMass, fmtQty } from "@/lib/qty";
import { addDays, getProductionPlan, manilaToday, type ProductionPlanDetail } from "@/modules/production";
import { Card, Field, Input, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { planCommandAction } from "../../work-orders/actions";
import { CommandForm } from "../../work-orders/command-form";

export const metadata: Metadata = { title: "Production plan" };
export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { sales_order: "Sales orders", min_stock: "Minimum stock", manual: "Manual" };

export default async function PlanDetailPage({ params }: { params: Promise<{ planId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.production_plan.view")) return <Forbidden what="production planning" />;
  const { planId } = await params;
  let d: ProductionPlanDetail;
  try {
    d = await getProductionPlan(ctx, planId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const p = d.plan;
  const u = (v: string | null) => (v === null ? "—" : fmtQty(v, "", 0));
  return (
    <div>
      <PageHeader
        title={p.planNumber}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={p.status} />
            <span>{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</span>
          </span>
        }
        actions={<LinkButton href="/production/plan" variant="secondary">All plans</LinkButton>}
      />
      {d.approvalRequired && p.status === "draft" && (
        <div className="mb-4">
          <Banner tone="info" title="Approval required">Lines become work orders after a site manager approves this plan (another person than its author).</Banner>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-3">
        {d.actions.canApprove && <CommandForm action={planCommandAction} fields={{ planId: p.id, command: "approve" }} label="Approve plan" variant="cta" />}
        {d.actions.canClose && <CommandForm action={planCommandAction} fields={{ planId: p.id, command: "close" }} label="Close plan" variant="secondary" confirm="Close this plan? Its lines can no longer become work orders." />}
      </div>
      {d.lines.length === 0 ? (
        <Card>
          <p className="text-[14px]">Nothing to make: demand in this period is covered by available stock and open work orders.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {d.lines.map((l) => (
            <Card key={l.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {l.lineNo}. {l.productName} <span className="text-[12px] text-muted">({l.productSku})</span>
                  </p>
                  <p className="text-[12px] text-muted">
                    {SOURCE[l.source]}
                    {l.salesOrderNumber ? ` · ${l.salesOrderNumber}` : ""} · target {fmtDate(l.targetDate)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip tone="info">Make {u(l.qtyUnits)} units</Chip>
                  {l.hasShortage && <Chip tone="warn">Material shortage</Chip>}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-5">
                {[["Orders (open)", l.demandUnits], ["Min stock", l.minStockUnits], ["On hand", l.onHandUnits], ["Available", l.availableUnits], ["Open WOs", l.openWorkOrderUnits]].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
                    <dd className="tabular">{u(v)}</dd>
                  </div>
                ))}
              </dl>
              {l.materials.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-[12px]">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 pr-2 font-semibold">Material ({l.batchCount} batch{l.batchCount === 1 ? "" : "es"}, {l.formulaLabel})</th>
                        <th className="py-1 pr-2 font-semibold">Needed</th>
                        <th className="py-1 pr-2 font-semibold">Free</th>
                        <th className="py-1 font-semibold">Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.materials.map((m) => (
                        <tr key={m.materialCode} className="border-t border-line">
                          <td className="py-1 pr-2">{m.materialName}</td>
                          <td className="py-1 pr-2 tabular">{fmtMass(m.required)}</td>
                          <td className="py-1 pr-2 tabular">{fmtMass(m.free)}</td>
                          <td className={`py-1 tabular ${D(m.short).gt(0) ? "font-semibold text-[var(--warn-fg)]" : ""}`}>{D(m.short).gt(0) ? fmtMass(m.short) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[11px] text-muted">Free = released, in-date stock not reserved or allocated, counted cumulatively down the plan. Shortages link to purchasing once procurement is live (W04).</p>
                </div>
              )}
              <div className="mt-3">
                {l.workOrder ? (
                  <p className="text-[13px]">
                    Work order{" "}
                    <Link className="font-mono font-semibold text-primary-text underline" href={`/production/work-orders/${l.workOrder.id}`}>
                      {l.workOrder.number}
                    </Link>{" "}
                    <StatusChip status={l.workOrder.status} />
                  </p>
                ) : d.actions.canConvert ? (
                  <CommandForm action={planCommandAction} fields={{ planId: p.id, command: "convert", planLineId: l.id }} label="Create work order" variant="secondary" size="sm">
                    <Field label="Planned start" htmlFor={`start-${l.id}`}>
                      <Input id={`start-${l.id}`} name="plannedStart" type="date" defaultValue={addDays(manilaToday(), 1)} />
                    </Field>
                  </CommandForm>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
