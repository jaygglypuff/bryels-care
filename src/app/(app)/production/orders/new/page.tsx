import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { workOrderFormOptions } from "@/modules/production";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { ProductionOrderForm } from "../forms";

export const metadata: Metadata = { title: "New production order" };
export const dynamic = "force-dynamic";

export default async function NewProductionOrderPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.create")) return <Forbidden what="creating production orders" />;
  const opts = await workOrderFormOptions(ctx);
  const formulas = opts.formulas.filter((f) => f.effectiveRevision);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New production order" subtitle={`${ctx.currentSite.name} · it starts as a draft; a manager approves it`} />
      {formulas.length === 0 ? (
        <EmptyState title="No product is ready to make yet" action={<LinkButton href="/masterdata/formulas" variant="secondary">View formulas</LinkButton>}>
          A product needs an approved formula before it can be made. Ask the person who looks after formulas.
        </EmptyState>
      ) : (
        <Card>
          <ProductionOrderForm formulas={formulas} lines={opts.lines} today={opts.today} />
        </Card>
      )}
    </div>
  );
}
