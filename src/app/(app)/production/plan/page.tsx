import Link from "next/link";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtQty } from "@/lib/qty";
import { listProductionPlans, manilaToday, addDays, planningOverview } from "@/modules/production";
import { Card, CardTitle, EmptyState, Field, Input, PageHeader, Select, Table, Td, Textarea } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { buildPlanAction, minStockAction } from "../work-orders/actions";
import { CommandForm } from "../work-orders/command-form";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "Production plan" };
export const dynamic = "force-dynamic";

const u = (v: string | null) => (v === null ? "—" : fmtQty(v, "", 0));

export default async function PlanPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.production_plan.view")) return <Forbidden what="production planning" />;
  const today = manilaToday();
  const end = addDays(today, 14);
  const [plans, overview] = await Promise.all([listProductionPlans(ctx), planningOverview(ctx, end)]);
  return (
    <div>
      <PageHeader title="Production plan" subtitle={`${ctx.currentSite.code} · demand from confirmed orders and minimum stock → production orders`} />
      <PageIntro>What customers ordered and what stock is low, so you can decide what to make.</PageIntro>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardTitle>Demand now (next 14 days)</CardTitle>
            {overview.demand.length === 0 ? (
              <EmptyState title="No open demand">No confirmed orders due and no minimum stock set for this site.</EmptyState>
            ) : (
              <Table head={["SKU", "Orders (open)", "Min stock", "Available", "Open WOs", "Net to make"]}>
                {overview.demand.map((d) => (
                  <tr key={d.productId}>
                    <Td>
                      <span className="font-medium">{d.product.name}</span>
                      <br />
                      <span className="text-[12px] text-muted">{d.product.skuCode}</span>
                    </Td>
                    <Td>{u(d.soDemand)}</Td>
                    <Td>{u(d.minStock)}</Td>
                    <Td>{u(d.available)}</Td>
                    <Td>{u(d.openWo)}</Td>
                    <Td className="font-semibold">{u(d.net)}</Td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-2 text-[12px] text-muted">Units (pcs). Available = released, in-date finished goods minus reservations and allocations. Forecasts are added once demand forecasting is scheduled (FR-analytics-08).</p>
          </Card>
          <Card>
            <CardTitle>Plans</CardTitle>
            {plans.length === 0 ? (
              <EmptyState title="No plans yet">Build the first plan from the demand above.</EmptyState>
            ) : (
              <Table head={["Plan", "Period", "Lines", "Production orders", "Status", "By"]}>
                {plans.map((p) => (
                  <tr key={p.p.id}>
                    <Td>
                      <Link className="font-mono font-semibold text-primary-text hover:underline" href={`/production/plan/${p.p.id}`}>{p.p.planNumber}</Link>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(p.p.periodStart)} – {fmtDate(p.p.periodEnd)}</Td>
                    <Td>{p.lines}</Td>
                    <Td>{p.converted}</Td>
                    <Td><StatusChip status={p.p.status} /></Td>
                    <Td>{p.by}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
        <aside className="space-y-4">
          {ctx.can("production.production_plan.create") && (
            <Card>
              <CardTitle>Build a plan</CardTitle>
              <CommandForm action={buildPlanAction} fields={{}} label="Build plan from demand" variant="cta" pendingText="Building…">
                <Field label="Period start" htmlFor="periodStart">
                  <Input id="periodStart" name="periodStart" type="date" defaultValue={today} required />
                </Field>
                <Field label="Period end" htmlFor="periodEnd">
                  <Input id="periodEnd" name="periodEnd" type="date" defaultValue={end} required />
                </Field>
                <Field label="Notes" htmlFor="notes">
                  <Textarea id="notes" name="notes" maxLength={500} className="min-h-[56px]" />
                </Field>
              </CommandForm>
            </Card>
          )}
          {ctx.can("production.production_plan.edit") && overview.products.length > 0 && (
            <Card>
              <CardTitle>Minimum stock</CardTitle>
              <p className="mb-2 text-[12px] text-muted">
                Current: {overview.products.map((p) => `${p.sku} ${p.minStockUnits ? fmtQty(p.minStockUnits, "", 0) : "—"}`).join(" · ")}
              </p>
              <CommandForm action={minStockAction} fields={{}} label="Save minimum" variant="secondary" size="sm">
                <Field label="SKU" htmlFor="productId">
                  <Select id="productId" name="productId">
                    {overview.products.map((p) => (
                      <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Minimum units" htmlFor="minStockUnits">
                  <Input id="minStockUnits" name="minStockUnits" inputMode="numeric" required />
                </Field>
              </CommandForm>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
