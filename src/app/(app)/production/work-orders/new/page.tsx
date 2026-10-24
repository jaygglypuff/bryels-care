import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { workOrderFormOptions } from "@/modules/production";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { WorkOrderForm } from "../wo-form";

export const metadata: Metadata = { title: "New work order" };
export const dynamic = "force-dynamic";

export default async function NewWorkOrderPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.create")) return <Forbidden what="creating work orders" />;
  const opts = await workOrderFormOptions(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New work order" subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name}`} />
      {opts.formulas.length === 0 ? (
        <EmptyState title="No product has a formula yet" action={<LinkButton href="/masterdata/formulas" variant="secondary">View formulas</LinkButton>}>
          A work order makes a product from its formula. Ask the process owner to create and approve one.
        </EmptyState>
      ) : (
        <WorkOrderForm mode="create" options={opts} />
      )}
    </div>
  );
}
