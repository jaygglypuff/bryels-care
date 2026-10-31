import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { makeForSalesLine, workOrderFormOptions, type MakeForLine } from "@/modules/production";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ProductionOrderForm } from "../forms";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "New production order" };
export const dynamic = "force-dynamic";

/** New order (ADR-080 V2-2). `?salesOrderLine=<id>` = "Make for this order": product, missing pieces and needed-by are prefilled. */
export default async function NewProductionOrderPage({ searchParams }: { searchParams: Promise<{ salesOrderLine?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.create")) return <Forbidden what="creating production orders" />;
  const sp = await searchParams;
  const opts = await workOrderFormOptions(ctx);
  const formulas = opts.formulas.filter((f) => f.effectiveRevision);
  let prefill: MakeForLine | null = null;
  let prefillError: string | null = null;
  if (sp.salesOrderLine) {
    if (!ctx.can("sales.sales_order.view")) prefillError = "You can't see customer orders, so the order can't be filled in for you.";
    else {
      try {
        prefill = await makeForSalesLine(ctx, sp.salesOrderLine);
        if (prefill.missing === "0") prefillError = `Nothing is missing on ${prefill.salesOrderNumber} line ${prefill.lineNo}: stock or open production orders already cover it.`;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        prefillError = e.message;
      }
    }
  }
  const usable = prefill && !prefillError && formulas.some((f) => f.productId === prefill!.productId) ? prefill : null;
  if (prefill && !prefillError && !usable) prefillError = `${prefill.productName} has no approved formula yet, so it can't be made. Ask the person who looks after formulas.`;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New production order" subtitle={ctx.currentSite.name} />
      <PageIntro>Choose what to make and how many pieces. The system numbers the order; a manager approves it.</PageIntro>
      {prefillError && (
        <div className="mb-4">
          <Banner tone="warn" title="Can't fill in from the customer order">{prefillError}</Banner>
        </div>
      )}
      {formulas.length === 0 ? (
        <EmptyState title="No product is ready to make yet" action={<LinkButton href="/masterdata/formulas" variant="secondary">View formulas</LinkButton>}>
          A product needs an approved formula before it can be made. Ask the person who looks after formulas.
        </EmptyState>
      ) : (
        <Card>
          <ProductionOrderForm
            formulas={formulas}
            lines={opts.lines}
            today={opts.today}
            prefill={usable ? { salesOrderId: usable.salesOrderId, salesOrderNumber: usable.salesOrderNumber, lineNo: usable.lineNo, productId: usable.productId, missing: usable.missing, neededBy: usable.neededBy } : null}
          />
        </Card>
      )}
    </div>
  );
}
