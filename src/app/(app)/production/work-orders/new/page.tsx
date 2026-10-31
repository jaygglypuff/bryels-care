import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { workOrderFormOptions } from "@/modules/production";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { WorkOrderForm } from "../wo-form";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "New production order" };
export const dynamic = "force-dynamic";

export default async function NewWorkOrderPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.create")) return <Forbidden what="creating production orders" />;
  const opts = await workOrderFormOptions(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New production order" subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name}`} />
      <PageIntro>Older form for a production order. Use New production order for daily work.</PageIntro>
      {opts.formulas.length === 0 ? (
        <EmptyState title="No product has a formula yet" action={<LinkButton href="/masterdata/formulas" variant="secondary">View formulas</LinkButton>}>
          A production order makes a product from its formula. Ask the process owner to create and approve one.
        </EmptyState>
      ) : (
        <WorkOrderForm mode="create" options={opts} />
      )}
    </div>
  );
}
