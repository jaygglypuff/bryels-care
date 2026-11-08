import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSupplierBill } from "@/modules/finance";
import { Card, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { ChangeBillForm } from "./change-form";

export const metadata = { title: "Change the supplier bill" };

/** ADR-131 (C-office problem 7, bug B12): change the lines of a draft or a "does not match" bill instead of cancelling it. */
export default async function ChangeBillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fixing?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.supplier_bill.edit")) return <Forbidden what="changing supplier bills" permission="finance.supplier_bill.edit" />;
  const { id } = await params;
  const { fixing } = await searchParams;
  let d: Awaited<ReturnType<typeof getSupplierBill>>;
  try {
    d = await getSupplierBill(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = d.bill;
  const back = <LinkButton href={`/finance/bills/${b.id}`} variant="secondary">Back to the bill</LinkButton>;
  if (!["draft", "disputed"].includes(b.status)) {
    return (
      <>
        <PageHeader title="Change the supplier bill" actions={back} />
        <Banner tone="info" title="This bill can no longer be changed here">A bill in the books is fixed with “Fix a mistake” in ⋯ More on the bill.</Banner>
      </>
    );
  }
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Change the bill from ${d.supplier.name}`} subtitle={`Their bill ${b.supplierReference} · ${b.billNumber}`} actions={back} />
      <PageIntro>This screen is for fixing what was typed wrong on a supplier bill. It is checked against the order and the delivery again when you send it.</PageIntro>
      {fixing && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title={`Bill ${fixing} was undone (kept on record).`}>This is its copy. Change what was wrong, then save it to the books again.</Banner>
        </div>
      )}
      <Card>
        <ChangeBillForm
          billId={b.id}
          lines={d.lines.map((l) => ({ chargeKind: l.chargeKind, goodsReceiptLineId: l.goodsReceiptLineId, purchaseOrderLineId: l.purchaseOrderLineId, materialId: l.materialId, description: l.description, baseUom: l.uom, qtyBase: l.qty, unitAmountBase: new Decimal(l.qty).gt(0) ? new Decimal(l.lineAmount).div(l.qty).toString() : l.unitAmount, taxCode: l.taxCode }))}
        />
      </Card>
    </div>
  );
}
