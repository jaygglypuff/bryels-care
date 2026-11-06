import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { largestBatchesForForm, makeForSalesLine, workOrderFormOptions, type MakeForLine } from "@/modules/production";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ProductionOrderForm } from "../forms";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "New production order" };
export const dynamic = "force-dynamic";

/**
 * New order (ADR-080 V2-2). `?salesOrderLine=<id>` = "Make for this order": product, missing pieces and needed-by are
 * prefilled. `?product=<productId>` (a recipe's "Make a batch") only preselects the product when it can be made.
 */
export default async function NewProductionOrderPage({ searchParams }: { searchParams: Promise<{ salesOrderLine?: string; product?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.create")) return <Forbidden what="creating production orders" permission="production.work_order.create" />;
  const sp = await searchParams;
  const opts = await workOrderFormOptions(ctx);
  // ADR-116: only products whose recipe AND steps are approved and in use can be chosen; the others are listed below
  // with the plain reason and who approves next ("This product's recipe is waiting for approval by …").
  const formulas = opts.formulas.filter((f) => f.effectiveRevision && !f.notReady);
  const waiting = opts.formulas.filter((f) => f.notReady && !formulas.some((x) => x.productId === f.productId));
  // ADR-104 §4: the largest batch per product (mixer capacity on the routing; null = the recipe's batch size).
  const largest = await largestBatchesForForm(ctx, formulas.map((f) => f.productId), opts.today);
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
  if (prefill && !prefillError && !usable) prefillError = waiting.find((f) => f.productId === prefill!.productId)?.notReady ?? `${prefill.productName} has no approved recipe yet, so it can't be made. Ask the person who looks after recipes.`;
  const askedFor = sp.product ? waiting.find((f) => f.productId === sp.product) : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New production order" subtitle={ctx.currentSite.name} />
      <PageIntro>Choose what to make and how many pieces. The screen works out the batches; you can make it one batch or choose the sizes. A manager approves it.</PageIntro>
      {prefillError && (
        <div className="mb-4">
          <Banner tone="warn" title="Can't fill in from the customer order">{prefillError}</Banner>
        </div>
      )}
      {askedFor && (
        <div className="mb-4" data-testid="product-not-ready">
          <Banner tone="warn" title={`${askedFor.productName} can't be made yet`}>{askedFor.notReady}</Banner>
        </div>
      )}
      {formulas.length === 0 ? (
        <EmptyState title="No product is ready to make yet" action={<LinkButton href="/masterdata/recipes" variant="secondary">View recipes</LinkButton>}>
          A product needs an approved recipe and approved steps before it can be made.
        </EmptyState>
      ) : (
        <Card>
          <ProductionOrderForm
            formulas={formulas.map((f) => ({ ...f, largestG: largest[f.productId]?.grams ?? null, largestFrom: largest[f.productId]?.from ?? null, family: f.family ?? null }))}
            lines={opts.lines}
            today={opts.today}
            prefill={usable ? { salesOrderId: usable.salesOrderId, salesOrderNumber: usable.salesOrderNumber, lineNo: usable.lineNo, productId: usable.productId, missing: usable.missing, neededBy: usable.neededBy } : null}
            initialProductId={formulas.find((f) => f.productId === sp.product)?.productId ?? null}
          />
        </Card>
      )}
      {waiting.length > 0 && (
        <Card className="mt-4">
          <h2 className="text-[15px] font-semibold">Not ready to make yet</h2>
          <p className="text-[13px] text-muted">These products can be chosen once their recipe and steps are approved.</p>
          <ul className="mt-2 flex flex-col divide-y divide-line" data-testid="not-ready-products">
            {waiting.map((f) => (
              <li key={f.formulaId} className="py-2.5">
                <p className="text-[15px] font-medium">{f.productName}</p>
                <p className="text-[13px] text-fg-2">{f.notReady}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
