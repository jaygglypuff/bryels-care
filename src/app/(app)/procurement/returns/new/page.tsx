import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { supplierOptions } from "@/modules/masterdata";
import { recentReceiptsOfSupplier, returnReasonOptions, returnableLots } from "@/modules/procurement";
import { Card, CardTitle, Field, Input, LinkButton, PageHeader, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Forbidden } from "../../../forbidden";
import { createReturnAction } from "../../actions";
import { SubNav, fmtBase } from "../../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "New supplier return" };

/** New supplier return (W04-09): choose the supplier, see its rejected lots here, then open the draft. */
export default async function NewSupplierReturnPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.supplier_return.create")) return <Forbidden what="creating supplier returns" />;
  const { supplier } = await searchParams;
  const sups = await supplierOptions(ctx);
  const chosen = sups.find((s) => s.id === supplier) ?? null;
  const [reasons, receipts, lots] = chosen ? await Promise.all([returnReasonOptions(ctx), recentReceiptsOfSupplier(ctx, chosen.id), returnableLots(ctx, chosen.id)]) : [[], [], []];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New supplier return" subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name}`} actions={<LinkButton href="/procurement/returns" variant="secondary">Supplier returns</LinkButton>} />
      <SubNav />
      <Card>
        <CardTitle>1. Supplier</CardTitle>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Supplier" htmlFor="supplier">
            <Select id="supplier" name="supplier" defaultValue={chosen?.id ?? ""} required>
              <option value="" disabled>
                Choose…
              </option>
              {sups.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </Select>
          </Field>
          <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2">
            Show its lots
          </button>
        </form>
      </Card>
      {chosen && (
        <Card className="mt-5">
          <CardTitle>2. Return to {chosen.name}</CardTitle>
          {lots.length === 0 ? (
            <p className="mb-3 text-[13px] text-muted">This supplier has no lots with stock in a receiving, quarantine, hold or rejected location at this site.</p>
          ) : (
            <ul className="mb-3 text-[13px]">
              {lots.map((l) => (
                <li key={`${l.lotId}-${l.locationId}`}>
                  {l.lotNumber} · {l.materialCode} · {fmtBase(l.qty, l.baseUom)} at {l.locationCode} · <strong>{l.status}</strong>
                  {!l.returnable && " (QA must reject it before it can be returned)"}
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={createReturnAction} hidden={{ supplierId: chosen.id }} submit="Open draft return" pending="Opening…" variant="cta">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Reason" htmlFor="reasonCode">
                <Select id="reasonCode" name="reasonCode" defaultValue="rejected_at_inspection" required>
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                      {r.requiresNote ? " (explain)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From receipt (optional)" htmlFor="goodsReceiptId">
                <Select id="goodsReceiptId" name="goodsReceiptId" defaultValue="">
                  <option value="">—</option>
                  {receipts.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.receiptNumber} · {fmtDate(r.receivedAt)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" htmlFor="reasonNote">
                <Input id="reasonNote" name="reasonNote" />
              </Field>
              <Field label="Supplier RMA reference" htmlFor="supplierRmaReference">
                <Input id="supplierRmaReference" name="supplierRmaReference" />
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
